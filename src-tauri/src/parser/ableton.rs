use crate::scanner::ProjectMetadata;
use flate2::read::GzDecoder;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use std::io::Read;
use std::path::Path;

#[derive(Default)]
struct AlsFields {
    bpm: Option<f64>,
    key: Option<String>,
    time_signature_numerator: Option<u32>,
    time_signature_denominator: Option<u32>,
    track_count: u32,
    daw_version: Option<String>,
    arrangement_end_beats: f64,
}

const MAX_XML_BYTES: u64 = 256 * 1024 * 1024; // 256 MB

pub fn parse(path: &Path) -> Option<ProjectMetadata> {
    let file = std::fs::File::open(path).ok()?;
    let gz = GzDecoder::new(file);
    let mut xml_bytes = Vec::new();
    gz.take(MAX_XML_BYTES).read_to_end(&mut xml_bytes).ok()?;
    let xml = String::from_utf8_lossy(&xml_bytes);

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);

    let mut fields = AlsFields::default();
    let mut in_tempo_manual = false;
    let mut in_time_sig = false;
    let mut in_arrangement_clip = false;
    let mut in_scale_info = false;
    let mut scale_root: Option<i32> = None;
    let mut scale_name: Option<String> = None;
    // Holds the key built from the most recent </ScaleInformation>.
    // Adopted into fields.key on <InKey> (global); discarded on <IsInKey> (per-clip).
    let mut pending_key: Option<String> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let name_bytes = e.name();
                let tag = std::str::from_utf8(name_bytes.as_ref()).unwrap_or("");
                match tag {
                    "Ableton" => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"MajorVersion" {
                                fields.daw_version =
                                    Some(String::from_utf8_lossy(&attr.value).into_owned());
                            }
                        }
                    }
                    "Tempo" => {
                        in_tempo_manual = true;
                    }
                    "TimeSignature" => {
                        in_time_sig = true;
                    }
                    "MidiClip" | "AudioClip" => {
                        // Session clips use Time="-63072000"; arrangement clips have real positions
                        let is_arrangement = e.attributes().flatten().any(|a| {
                            a.key.as_ref() == b"Time"
                                && std::str::from_utf8(&a.value)
                                    .map(|v| v.parse::<f64>().map(|t| t >= 0.0).unwrap_or(false))
                                    .unwrap_or(false)
                        });
                        in_arrangement_clip = is_arrangement;
                    }
                    "ScaleInformation" => {
                        in_scale_info = true;
                        scale_root = None;
                        scale_name = None;
                    }
                    "AudioTrack" | "MidiTrack" | "GroupTrack" => {
                        fields.track_count += 1;
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let name_bytes = e.name();
                let tag = std::str::from_utf8(name_bytes.as_ref()).unwrap_or("");
                match tag {
                    "Manual" if in_tempo_manual => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Value" {
                                if let Ok(v) = std::str::from_utf8(&attr.value) {
                                    fields.bpm = v.parse().ok();
                                }
                            }
                        }
                        in_tempo_manual = false;
                    }
                    "TimeSignatureNumerator" if in_time_sig => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Value" {
                                if let Ok(v) = std::str::from_utf8(&attr.value) {
                                    fields.time_signature_numerator = v.parse().ok();
                                }
                            }
                        }
                    }
                    "TimeSignatureDenominator" if in_time_sig => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Value" {
                                if let Ok(v) = std::str::from_utf8(&attr.value) {
                                    // Stored as a power-of-2 exponent: 2 → 4 (quarter note)
                                    fields.time_signature_denominator =
                                        v.parse::<u32>().ok().map(|n| 1u32 << n);
                                }
                            }
                        }
                        in_time_sig = false;
                    }
                    "RootNote" if in_scale_info => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Value" {
                                scale_root = std::str::from_utf8(&attr.value)
                                    .ok()
                                    .and_then(|v| v.parse().ok());
                            }
                        }
                    }
                    "Name" if in_scale_info => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Value" {
                                scale_name =
                                    Some(String::from_utf8_lossy(&attr.value).into_owned());
                            }
                        }
                    }
                    "CurrentEnd" if in_arrangement_clip => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Value" {
                                if let Ok(v) = std::str::from_utf8(&attr.value) {
                                    if let Ok(end) = v.parse::<f64>() {
                                        if end > fields.arrangement_end_beats {
                                            fields.arrangement_end_beats = end;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // Global ScaleInformation → followed by <InKey>
                    // Per-clip ScaleInformation → followed by <IsInKey>
                    "InKey" => {
                        fields.key = pending_key.take();
                    }
                    "IsInKey" => {
                        pending_key = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let name_bytes = e.name();
                let tag = std::str::from_utf8(name_bytes.as_ref()).unwrap_or("");
                match tag {
                    "MidiClip" | "AudioClip" => {
                        in_arrangement_clip = false;
                    }
                    "ScaleInformation" if in_scale_info => {
                        pending_key = build_key_string(scale_root, scale_name.as_deref());
                        in_scale_info = false;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    let time_signature = match (
        fields.time_signature_numerator,
        fields.time_signature_denominator,
    ) {
        (Some(n), Some(d)) => Some(format!("{n}/{d}")),
        _ => None,
    };

    let duration_secs = match (fields.bpm, fields.arrangement_end_beats) {
        (Some(bpm), end) if bpm > 0.0 && end > 0.0 => Some((end / bpm) * 60.0),
        _ => None,
    };

    Some(ProjectMetadata {
        file_path: String::new(),
        file_hash: String::new(),
        daw: "ableton".to_string(),
        daw_version: fields.daw_version,
        bpm: fields.bpm,
        key: fields.key,
        time_signature,
        track_count: if fields.track_count > 0 {
            Some(fields.track_count)
        } else {
            None
        },
        duration_secs,
        size_bytes: 0,
        created_at: 0,
        modified_at: 0,
    })
}

const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

fn build_key_string(root: Option<i32>, scale: Option<&str>) -> Option<String> {
    let note = NOTE_NAMES.get(root? as usize)?;
    let scale = scale?;
    if scale.is_empty() {
        Some(note.to_string())
    } else {
        Some(format!("{note} {scale}"))
    }
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaReport {
    pub total: u32,
    pub missing: u32,
    pub external: u32,
}

/// Counts the distinct samples a Live Set references, how many can't be found
/// on disk, and how many live outside the Set's own project folder.
pub fn inspect_media(path: &Path) -> Option<MediaReport> {
    let file = std::fs::File::open(path).ok()?;
    let mut xml_bytes = Vec::new();
    GzDecoder::new(file)
        .take(MAX_XML_BYTES)
        .read_to_end(&mut xml_bytes)
        .ok()?;
    let xml = String::from_utf8_lossy(&xml_bytes);

    let project_dir = path.parent()?;
    let project_root = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.to_path_buf());

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);

    // Element names from the root down to the current position.
    let mut stack: Vec<String> = Vec::new();
    // Stack depth of the FileRef directly under a SampleRef, while inside one.
    let mut capture_depth: Option<usize> = None;
    let mut abs_path = String::new();
    let mut rel_path = String::new();
    let mut seen = std::collections::HashSet::new();
    let mut report = MediaReport::default();

    let note_value =
        |name: &str, e: &quick_xml::events::BytesStart, abs: &mut String, rel: &mut String| {
            let target = match name {
                "Path" => abs,
                "RelativePath" => rel,
                _ => return,
            };
            if let Some(v) = e
                .attributes()
                .flatten()
                .find(|a| a.key.as_ref() == b"Value")
            {
                *target = String::from_utf8_lossy(&v.value).into_owned();
            }
        };

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                if name == "FileRef"
                    && capture_depth.is_none()
                    && stack.last().map(String::as_str) == Some("SampleRef")
                {
                    capture_depth = Some(stack.len() + 1);
                    abs_path.clear();
                    rel_path.clear();
                } else if capture_depth == Some(stack.len()) {
                    note_value(&name, e, &mut abs_path, &mut rel_path);
                }
                stack.push(name);
            }
            Ok(Event::Empty(ref e)) => {
                if capture_depth == Some(stack.len()) {
                    let name = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                    note_value(&name, e, &mut abs_path, &mut rel_path);
                }
            }
            Ok(Event::End(_)) => {
                if capture_depth == Some(stack.len()) {
                    capture_depth = None;
                    let key = if abs_path.is_empty() {
                        rel_path.clone()
                    } else {
                        abs_path.clone()
                    };
                    if !key.is_empty() && seen.insert(key) {
                        report.total += 1;
                        if is_network_path(&abs_path) || is_network_path(&rel_path) {
                            report.external += 1;
                            stack.pop();
                            continue;
                        }
                        let candidates = [
                            (!abs_path.is_empty()).then(|| std::path::PathBuf::from(&abs_path)),
                            (!rel_path.is_empty()).then(|| project_dir.join(&rel_path)),
                        ];
                        match candidates.into_iter().flatten().find(|c| c.exists()) {
                            None => report.missing += 1,
                            Some(found) => {
                                let found = found.canonicalize().unwrap_or(found);
                                if !found.starts_with(&project_root) {
                                    report.external += 1;
                                }
                            }
                        }
                    }
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
    }
    Some(report)
}

/// UNC and device paths (`\\host\share`, `//host/share`, `\\?\...`). Probing one
/// makes Windows authenticate to that host, so paths read from an untrusted
/// `.als` are never touched on disk.
fn is_network_path(p: &str) -> bool {
    p.starts_with("\\\\") || p.starts_with("//")
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn make_als_file(xml: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.als");
        let file = std::fs::File::create(&path).unwrap();
        let mut enc = GzEncoder::new(file, Compression::default());
        enc.write_all(xml.as_bytes()).unwrap();
        enc.finish().unwrap();
        (dir, path)
    }

    #[test]
    fn parses_bpm_from_als() {
        let xml = r#"<?xml version="1.0"?><Ableton MajorVersion="11"><LiveSet><MasterTrack><DeviceChain><Mixer><Tempo><LomId Value="0" /><Manual Value="128.0" /></Tempo></Mixer></DeviceChain></MasterTrack></LiveSet></Ableton>"#;
        let (_dir, path) = make_als_file(xml);
        let result = parse(&path).unwrap();
        assert_eq!(result.bpm, Some(128.0));
    }

    #[test]
    fn parses_key_from_als() {
        // Real Live 11 format: ScaleInformation with RootNote + Name children,
        // global instance followed by <InKey>, per-clip by <IsInKey>.
        let xml = r#"<?xml version="1.0"?><Ableton MajorVersion="11"><LiveSet><ScaleInformation><RootNote Value="5" /><Name Value="Minor" /></ScaleInformation><InKey Value="false" /></LiveSet></Ableton>"#;
        let (_dir, path) = make_als_file(xml);
        let result = parse(&path).unwrap();
        assert_eq!(result.key, Some("F Minor".to_string()));
    }

    #[test]
    fn ignores_per_clip_scale_information() {
        // Per-clip ScaleInformation (IsInKey) must not pollute fields.key.
        // Global ScaleInformation (InKey) should win.
        let xml = r#"<?xml version="1.0"?><Ableton MajorVersion="11"><LiveSet><MidiTrack><ScaleInformation><RootNote Value="0" /><Name Value="Major" /></ScaleInformation><IsInKey Value="false" /></MidiTrack><ScaleInformation><RootNote Value="9" /><Name Value="Minor" /></ScaleInformation><InKey Value="true" /></LiveSet></Ableton>"#;
        let (_dir, path) = make_als_file(xml);
        let result = parse(&path).unwrap();
        assert_eq!(result.key, Some("A Minor".to_string()));
    }

    #[test]
    fn parses_time_signature_from_als() {
        // Denominator stored as power-of-2 exponent: Value="2" means 2^2=4 → 4/4
        let xml = r#"<?xml version="1.0"?><Ableton MajorVersion="11"><LiveSet><MasterTrack><DeviceChain><Mixer><TimeSignature><TimeSignatureNumerator Value="4" /><TimeSignatureDenominator Value="2" /></TimeSignature></Mixer></DeviceChain></MasterTrack></LiveSet></Ableton>"#;
        let (_dir, path) = make_als_file(xml);
        let result = parse(&path).unwrap();
        assert_eq!(result.time_signature, Some("4/4".to_string()));
    }

    #[test]
    fn parses_six_eight_time_signature() {
        // Value="3" means 2^3=8 → 6/8
        let xml = r#"<?xml version="1.0"?><Ableton MajorVersion="11"><LiveSet><MasterTrack><DeviceChain><Mixer><TimeSignature><TimeSignatureNumerator Value="6" /><TimeSignatureDenominator Value="3" /></TimeSignature></Mixer></DeviceChain></MasterTrack></LiveSet></Ableton>"#;
        let (_dir, path) = make_als_file(xml);
        let result = parse(&path).unwrap();
        assert_eq!(result.time_signature, Some("6/8".to_string()));
    }

    #[test]
    fn parses_arrangement_duration() {
        // Two arrangement clips at 120 BPM: ends at beat 8 and beat 16 → 16 beats / 120 BPM * 60 = 8s
        let xml = r#"<?xml version="1.0"?><Ableton MajorVersion="11"><LiveSet><MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="120.0" /></Tempo></Mixer></DeviceChain></MasterTrack><Tracks><MidiTrack><DeviceChain><ClipSlotList><MidiClip Id="0" Time="0"><CurrentStart Value="0" /><CurrentEnd Value="8" /></MidiClip><MidiClip Id="1" Time="8"><CurrentStart Value="8" /><CurrentEnd Value="16" /></MidiClip></ClipSlotList></DeviceChain></MidiTrack></Tracks></LiveSet></Ableton>"#;
        let (_dir, path) = make_als_file(xml);
        let result = parse(&path).unwrap();
        let dur = result.duration_secs.unwrap();
        assert!((dur - 8.0).abs() < 0.01, "expected ~8s, got {dur}");
    }

    #[test]
    fn ignores_session_clips_for_duration() {
        // Session clips have Time=-63072000 and must not affect duration
        let xml = r#"<?xml version="1.0"?><Ableton MajorVersion="11"><LiveSet><MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="120.0" /></Tempo></Mixer></DeviceChain></MasterTrack><Tracks><MidiTrack><DeviceChain><ClipSlotList><MidiClip Id="0" Time="-63072000"><CurrentStart Value="0" /><CurrentEnd Value="9999" /></MidiClip></ClipSlotList></DeviceChain></MidiTrack></Tracks></LiveSet></Ableton>"#;
        let (_dir, path) = make_als_file(xml);
        let result = parse(&path).unwrap();
        assert!(result.duration_secs.is_none());
    }

    #[test]
    fn returns_none_for_non_gzip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.als");
        std::fs::write(&path, b"not gzip").unwrap();
        assert!(parse(&path).is_none());
    }

    fn sample_ref(abs: &str, rel: &str) -> String {
        format!(
            r#"<AudioClip><SampleRef><FileRef><RelativePathType Value="3" /><RelativePath Value="{rel}" /><Name Value="x.wav" /><Path Value="{abs}" /><SourceContext><SourceContext><OriginalFileRef><FileRef><Path Value="/original/never/counted.wav" /></FileRef></OriginalFileRef></SourceContext></SourceContext></FileRef></SampleRef></AudioClip>"#
        )
    }

    fn als_with(refs: &[String]) -> String {
        format!(
            r#"<?xml version="1.0"?><Ableton MajorVersion="11"><LiveSet>{}</LiveSet></Ableton>"#,
            refs.join("")
        )
    }

    #[test]
    fn media_counts_internal_missing_and_external_samples() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("Samples/Imported")).unwrap();
        std::fs::write(project.path().join("Samples/Imported/in.wav"), b"x").unwrap();
        let outside = tempfile::tempdir().unwrap();
        let outside_file = outside.path().join("out.wav");
        std::fs::write(&outside_file, b"x").unwrap();

        let xml = als_with(&[
            sample_ref("/gone/elsewhere.wav", "Samples/Imported/in.wav"),
            sample_ref(outside_file.to_str().unwrap(), ""),
            sample_ref("/definitely/missing.wav", ""),
        ]);
        let als = project.path().join("song.als");
        let mut enc = GzEncoder::new(std::fs::File::create(&als).unwrap(), Compression::default());
        enc.write_all(xml.as_bytes()).unwrap();
        enc.finish().unwrap();

        assert_eq!(
            inspect_media(&als),
            Some(MediaReport {
                total: 3,
                missing: 1,
                external: 1
            })
        );
    }

    #[test]
    fn media_counts_a_repeated_sample_once() {
        let (dir, path) = make_als_file(&als_with(&[
            sample_ref("/missing/a.wav", ""),
            sample_ref("/missing/a.wav", ""),
        ]));
        let _keep = dir;
        assert_eq!(
            inspect_media(&path),
            Some(MediaReport {
                total: 1,
                missing: 1,
                external: 0
            })
        );
    }

    #[test]
    fn media_is_zero_for_a_set_without_samples() {
        let (dir, path) = make_als_file(&als_with(&[]));
        let _keep = dir;
        assert_eq!(inspect_media(&path), Some(MediaReport::default()));
    }

    #[test]
    fn media_is_none_for_non_gzip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bad.als");
        std::fs::write(&path, b"not gzip").unwrap();
        assert_eq!(inspect_media(&path), None);
    }

    #[test]
    fn network_paths_are_never_probed_and_count_as_external() {
        assert!(is_network_path(r"\\server\share\a.wav"));
        assert!(is_network_path("//server/share/a.wav"));
        assert!(is_network_path(r"\\?\UNC\server\share\a.wav"));
        assert!(!is_network_path("/Users/me/a.wav"));
        assert!(!is_network_path(r"C:\Users\me\a.wav"));

        let (dir, path) = make_als_file(&als_with(&[
            sample_ref(r"\\attacker\share\a.wav", ""),
            sample_ref("//attacker/share/b.wav", ""),
        ]));
        let _keep = dir;
        assert_eq!(
            inspect_media(&path),
            Some(MediaReport {
                total: 2,
                missing: 0,
                external: 2
            })
        );
    }
}
