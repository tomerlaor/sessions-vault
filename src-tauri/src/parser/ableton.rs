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
                                fields.daw_version = Some(
                                    String::from_utf8_lossy(&attr.value).into_owned()
                                );
                            }
                        }
                    }
                    "Tempo" => { in_tempo_manual = true; }
                    "TimeSignature" => { in_time_sig = true; }
                    "MidiClip" | "AudioClip" => {
                        // Session clips use Time="-63072000"; arrangement clips have real positions
                        let is_arrangement = e.attributes().flatten().any(|a| {
                            a.key.as_ref() == b"Time" &&
                            std::str::from_utf8(&a.value)
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
                                scale_root = std::str::from_utf8(&attr.value).ok()
                                    .and_then(|v| v.parse().ok());
                            }
                        }
                    }
                    "Name" if in_scale_info => {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"Value" {
                                scale_name = Some(
                                    String::from_utf8_lossy(&attr.value).into_owned()
                                );
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
                    "InKey"   => { fields.key = pending_key.take(); }
                    "IsInKey" => { pending_key = None; }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let name_bytes = e.name();
                let tag = std::str::from_utf8(name_bytes.as_ref()).unwrap_or("");
                match tag {
                    "MidiClip" | "AudioClip" => { in_arrangement_clip = false; }
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

    let time_signature = match (fields.time_signature_numerator, fields.time_signature_denominator) {
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
        track_count: if fields.track_count > 0 { Some(fields.track_count) } else { None },
        duration_secs,
        size_bytes: 0,
        created_at: 0,
        modified_at: 0,
    })
}

const NOTE_NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

fn build_key_string(root: Option<i32>, scale: Option<&str>) -> Option<String> {
    let note = NOTE_NAMES.get(root? as usize)?;
    let scale = scale?;
    if scale.is_empty() {
        Some(note.to_string())
    } else {
        Some(format!("{note} {scale}"))
    }
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
}
