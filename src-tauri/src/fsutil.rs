use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub size_bytes: u64,
    /// Unix seconds.
    pub modified_at: i64,
}

pub fn stat(path: &str) -> Result<FileStat, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok(FileStat {
        size_bytes: meta.len(),
        modified_at,
    })
}

pub fn exists_many(paths: &[String]) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).exists()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_existence_in_input_order() {
        let dir = tempfile::tempdir().unwrap();
        let present = dir.path().join("a.wav");
        std::fs::write(&present, b"x").unwrap();
        let paths = vec![
            dir.path().join("nope.wav").to_string_lossy().into_owned(),
            present.to_string_lossy().into_owned(),
        ];
        assert_eq!(exists_many(&paths), vec![false, true]);
    }

    #[test]
    fn stat_reports_size_and_a_recent_modified_time() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.wav");
        std::fs::write(&file, b"12345").unwrap();
        let st = stat(file.to_str().unwrap()).unwrap();
        assert_eq!(st.size_bytes, 5);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!((now - st.modified_at).abs() < 60);
    }

    #[test]
    fn stat_errors_for_a_missing_file() {
        assert!(stat("/definitely/not/here.wav").is_err());
    }
}
