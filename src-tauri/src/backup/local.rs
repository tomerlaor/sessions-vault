use super::StageFileInput;
use std::path::Path;

#[allow(clippy::too_many_arguments)]
pub fn backup_to_local(
    file_path: &str,
    title: &str,
    project_id: &str,
    dest_dir: &str,
    lyrics: Option<&str>,
    tabs: Option<&str>,
    todos: Option<&str>,
    stage_files: &[StageFileInput],
) -> Result<super::BackupResult, String> {
    let als_path = Path::new(file_path);
    let (zip_tmp, manifest) = super::zip_project(
        als_path,
        title,
        project_id,
        lyrics,
        tabs,
        todos,
        stage_files,
    )?;

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

    std::fs::copy(&zip_tmp, &dest_path).map_err(|e| format!("copy to dest: {e}"))?;
    let _ = std::fs::remove_file(&zip_tmp);

    let missing_count = manifest.missing.len() as u32;
    let status = if manifest.is_partial() {
        "partial"
    } else {
        "ok"
    };
    let manifest_json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;

    Ok(super::BackupResult {
        provider: "local".to_string(),
        destination: dest_path.to_string_lossy().into_owned(),
        size_bytes,
        checksum,
        status: status.to_string(),
        missing_count,
        manifest_json,
    })
}
