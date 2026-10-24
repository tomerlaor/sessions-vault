use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u16>,
    pub channels: Option<u16>,
    pub duration_secs: Option<f64>,
    pub peak_db: Option<f64>,
    pub clipped: bool,
    pub lossy: bool,
}

const LOSSY_EXTENSIONS: [&str; 5] = ["mp3", "m4a", "aac", "ogg", "opus"];
const CLIP_THRESHOLD: f64 = 0.9999;
const CLIP_RUN_LENGTH: u32 = 3;

struct WavFormat {
    tag: u16,
    channels: u16,
    sample_rate: u32,
    bits: u16,
}

pub fn inspect_audio(path: &str) -> Result<AudioInfo, String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    if LOSSY_EXTENSIONS.contains(&ext.as_str()) {
        return Ok(AudioInfo {
            sample_rate: None,
            bit_depth: None,
            channels: None,
            duration_secs: None,
            peak_db: None,
            clipped: false,
            lossy: true,
        });
    }
    if ext != "wav" {
        return Err(format!("Unsupported audio format: .{ext}"));
    }
    inspect_wav(path)
}

fn read_u16(buf: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([buf[at], buf[at + 1]])
}

fn read_u32(buf: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]])
}

fn inspect_wav(path: &str) -> Result<AudioInfo, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let file_len = file.metadata().map_err(|e| e.to_string())?.len();

    let mut riff = [0u8; 12];
    file.read_exact(&mut riff)
        .map_err(|_| "Not a WAV file: header too short".to_string())?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err("Not a WAV file: missing RIFF/WAVE header".into());
    }

    let mut format: Option<WavFormat> = None;
    let mut pos: u64 = 12;
    loop {
        let mut head = [0u8; 8];
        file.read_exact(&mut head)
            .map_err(|_| "WAV file has no data chunk".to_string())?;
        pos += 8;
        let id = [head[0], head[1], head[2], head[3]];
        let size = read_u32(&head, 4) as u64;

        if &id == b"fmt " {
            if size < 16 {
                return Err("WAV fmt chunk too short".into());
            }
            let mut buf = vec![0u8; size.min(64) as usize];
            file.read_exact(&mut buf)
                .map_err(|_| "WAV fmt chunk truncated".to_string())?;
            let mut tag = read_u16(&buf, 0);
            if tag == 0xFFFE && buf.len() >= 26 {
                tag = read_u16(&buf, 24);
            }
            format = Some(WavFormat {
                tag,
                channels: read_u16(&buf, 2),
                sample_rate: read_u32(&buf, 4),
                bits: read_u16(&buf, 14),
            });
            let rest = size - buf.len() as u64 + (size & 1);
            file.seek(SeekFrom::Current(rest as i64))
                .map_err(|e| e.to_string())?;
            pos += size + (size & 1);
        } else if &id == b"data" {
            let fmt = format.ok_or("WAV data chunk before fmt chunk")?;
            let available = file_len.saturating_sub(pos);
            // Streamed or unfinalised files may report 0 or 0xFFFFFFFF.
            let data_len = if size == 0 || size > available {
                available
            } else {
                size
            };
            return analyse_samples(&mut file, &fmt, data_len);
        } else {
            let skip = size + (size & 1);
            file.seek(SeekFrom::Current(skip as i64))
                .map_err(|e| e.to_string())?;
            pos += skip;
        }
    }
}

fn analyse_samples(file: &mut File, fmt: &WavFormat, data_len: u64) -> Result<AudioInfo, String> {
    let lossy = fmt.tag != 1 && fmt.tag != 3;
    let base = |peak_db, clipped, duration| AudioInfo {
        sample_rate: Some(fmt.sample_rate),
        bit_depth: Some(fmt.bits),
        channels: Some(fmt.channels),
        duration_secs: duration,
        peak_db,
        clipped,
        lossy,
    };
    if fmt.channels == 0 || fmt.bits == 0 || fmt.sample_rate == 0 {
        return Err("WAV fmt chunk has zero channels, bit depth or sample rate".into());
    }
    if lossy {
        return Ok(base(None, false, None));
    }

    let bytes_per_sample = (fmt.bits / 8) as usize;
    let supported = matches!(
        (fmt.tag, fmt.bits),
        (1, 16) | (1, 24) | (1, 32) | (3, 32) | (3, 64)
    );
    if !supported || bytes_per_sample == 0 {
        return Err(format!(
            "Unsupported WAV encoding: tag {} at {} bits",
            fmt.tag, fmt.bits
        ));
    }
    let frame_bytes = bytes_per_sample * fmt.channels as usize;

    let mut peak: f64 = 0.0;
    let mut runs = vec![0u32; fmt.channels as usize];
    let mut clipped = false;
    let mut total_frames: u64 = 0;
    let mut remaining = data_len;
    let mut buf = vec![0u8; frame_bytes * 4096];
    let mut filled = 0usize;

    while remaining > 0 {
        let want = (buf.len() - filled).min(remaining as usize);
        let n = file
            .read(&mut buf[filled..filled + want])
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        remaining -= n as u64;
        filled += n;
        let whole = filled / frame_bytes * frame_bytes;
        for frame in buf[..whole].chunks_exact(frame_bytes) {
            for (ch, sample) in frame.chunks_exact(bytes_per_sample).enumerate() {
                let v = decode(fmt.tag, fmt.bits, sample).abs();
                if v > peak {
                    peak = v;
                }
                if v >= CLIP_THRESHOLD {
                    runs[ch] += 1;
                    if runs[ch] >= CLIP_RUN_LENGTH {
                        clipped = true;
                    }
                } else {
                    runs[ch] = 0;
                }
            }
        }
        total_frames += (whole / frame_bytes) as u64;
        buf.copy_within(whole..filled, 0);
        filled -= whole;
    }

    let peak_db = if peak > 0.0 {
        Some(20.0 * peak.log10())
    } else {
        None
    };
    Ok(base(
        peak_db,
        clipped,
        Some(total_frames as f64 / fmt.sample_rate as f64),
    ))
}

fn decode(tag: u16, bits: u16, b: &[u8]) -> f64 {
    match (tag, bits) {
        (1, 16) => i16::from_le_bytes([b[0], b[1]]) as f64 / 32768.0,
        (1, 24) => {
            let v = ((b[2] as i32) << 24 | (b[1] as i32) << 16 | (b[0] as i32) << 8) >> 8;
            v as f64 / 8388608.0
        }
        (1, 32) => i32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64 / 2147483648.0,
        (3, 32) => f32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
        _ => f64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    /// Encodes `samples` (interleaved, normalized -1.0..=1.0) as a WAV file.
    fn write_wav(
        dir: &TempDir,
        name: &str,
        rate: u32,
        bits: u16,
        channels: u16,
        float: bool,
        samples: &[f64],
    ) -> String {
        let mut data: Vec<u8> = Vec::new();
        for &s in samples {
            match (bits, float) {
                (16, false) => data.extend_from_slice(
                    &((s * 32768.0).clamp(-32768.0, 32767.0) as i16).to_le_bytes(),
                ),
                (24, false) => {
                    let v = (s * 8388608.0).clamp(-8388608.0, 8388607.0) as i32;
                    data.extend_from_slice(&v.to_le_bytes()[..3]);
                }
                (32, true) => data.extend_from_slice(&(s as f32).to_le_bytes()),
                _ => panic!("unsupported test encoding"),
            }
        }
        let block_align = channels * bits / 8;
        let mut out: Vec<u8> = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&(if float { 3u16 } else { 1u16 }).to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * block_align as u32).to_le_bytes());
        out.extend_from_slice(&block_align.to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        let path = dir.path().join(name);
        std::fs::File::create(&path)
            .unwrap()
            .write_all(&out)
            .unwrap();
        path.to_string_lossy().into_owned()
    }

    fn sine(amplitude: f64, frames: usize) -> Vec<f64> {
        (0..frames)
            .map(|i| amplitude * (i as f64 * 0.05).sin())
            .collect()
    }

    #[test]
    fn reads_format_fields_for_24_bit_stereo() {
        let dir = TempDir::new().unwrap();
        let mut samples = Vec::new();
        for s in sine(0.5, 48000) {
            samples.push(s);
            samples.push(s);
        }
        let path = write_wav(&dir, "a.wav", 48000, 24, 2, false, &samples);
        let info = inspect_audio(&path).unwrap();
        assert_eq!(info.sample_rate, Some(48000));
        assert_eq!(info.bit_depth, Some(24));
        assert_eq!(info.channels, Some(2));
        assert!((info.duration_secs.unwrap() - 1.0).abs() < 1e-6);
        assert!(!info.lossy);
    }

    #[test]
    fn peak_of_half_scale_sine_is_about_minus_six_db() {
        let dir = TempDir::new().unwrap();
        let path = write_wav(&dir, "b.wav", 44100, 16, 1, false, &sine(0.5, 44100));
        let info = inspect_audio(&path).unwrap();
        let peak = info.peak_db.unwrap();
        assert!((peak - (-6.02)).abs() < 0.1, "peak was {peak}");
        assert!(!info.clipped);
    }

    #[test]
    fn reads_32_bit_float() {
        let dir = TempDir::new().unwrap();
        let path = write_wav(&dir, "c.wav", 96000, 32, 1, true, &sine(0.25, 1000));
        let info = inspect_audio(&path).unwrap();
        assert_eq!(info.bit_depth, Some(32));
        assert!((info.peak_db.unwrap() - (-12.04)).abs() < 0.1);
    }

    #[test]
    fn flags_clipping_on_a_run_of_full_scale_samples() {
        let dir = TempDir::new().unwrap();
        let mut samples = sine(0.3, 1000);
        samples.extend(std::iter::repeat(1.0).take(10));
        let path = write_wav(&dir, "d.wav", 44100, 16, 1, false, &samples);
        let info = inspect_audio(&path).unwrap();
        assert!(info.clipped);
        assert!(info.peak_db.unwrap() > -0.01);
    }

    #[test]
    fn isolated_full_scale_samples_are_not_clipping() {
        let dir = TempDir::new().unwrap();
        let mut samples = sine(0.3, 1000);
        samples.push(1.0);
        samples.extend(sine(0.3, 1000));
        let path = write_wav(&dir, "e.wav", 44100, 16, 1, false, &samples);
        assert!(!inspect_audio(&path).unwrap().clipped);
    }

    #[test]
    fn silence_has_no_peak() {
        let dir = TempDir::new().unwrap();
        let path = write_wav(&dir, "f.wav", 44100, 16, 1, false, &vec![0.0; 100]);
        assert_eq!(inspect_audio(&path).unwrap().peak_db, None);
    }

    #[test]
    fn truncated_header_is_an_error_not_a_panic() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("g.wav");
        std::fs::write(&path, b"RIFF\x00\x00").unwrap();
        assert!(inspect_audio(path.to_str().unwrap()).is_err());
    }

    #[test]
    fn truncated_data_reports_what_is_present() {
        let dir = TempDir::new().unwrap();
        let path = write_wav(&dir, "h.wav", 44100, 16, 1, false, &sine(0.5, 1000));
        let bytes = std::fs::read(&path).unwrap();
        std::fs::write(&path, &bytes[..bytes.len() - 500]).unwrap();
        let info = inspect_audio(&path).unwrap();
        assert!(info.duration_secs.unwrap() < 1000.0 / 44100.0);
    }

    #[test]
    fn mp3_is_flagged_lossy_without_decoding() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("i.mp3");
        std::fs::write(&path, b"ID3").unwrap();
        let info = inspect_audio(path.to_str().unwrap()).unwrap();
        assert!(info.lossy);
        assert_eq!(info.sample_rate, None);
    }

    #[test]
    fn unsupported_extension_is_an_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("j.xyz");
        std::fs::write(&path, b"data").unwrap();
        assert!(inspect_audio(path.to_str().unwrap()).is_err());
    }
}
