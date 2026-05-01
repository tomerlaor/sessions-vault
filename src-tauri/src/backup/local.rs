use std::path::Path;

pub fn backup_to_local(
    file_path: &str,
    title: &str,
    dest_dir: &str,
    lyrics: Option<&str>,
    tabs: Option<&str>,
    todos: Option<&str>,
) -> Result<super::BackupResult, String> {
    let als_path = Path::new(file_path);
    let zip_tmp = super::zip_project(als_path, title, lyrics, tabs, todos)?;

    let dest_dir = Path::new(dest_dir);
    if !dest_dir.exists() {
        std::fs::create_dir_all(dest_dir).map_err(|e| format!("dest dir: {e}"))?;
    }

    let zip_name = zip_tmp.file_name().unwrap().to_string_lossy();
    let dest_path = dest_dir.join(zip_name.as_ref());

    let checksum = super::checksum_file(&zip_tmp)?;
    let size_bytes = std::fs::metadata(&zip_tmp)
        .map_err(|e| e.to_string())?
        .len();

    std::fs::copy(&zip_tmp, &dest_path)
        .map_err(|e| format!("copy to dest: {e}"))?;
    let _ = std::fs::remove_file(&zip_tmp);

    Ok(super::BackupResult {
        provider: "local".to_string(),
        destination: dest_path.to_string_lossy().into_owned(),
        size_bytes,
        checksum,
    })
}
