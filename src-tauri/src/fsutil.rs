use std::path::Path;

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
}
