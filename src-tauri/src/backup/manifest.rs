use serde::{Deserialize, Serialize};

/// `manifest.json`, written at the root of every backup archive.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub schema: u32,
    pub project: ManifestProject,
    pub created_at: i64,
    pub app_version: String,
    pub files: Vec<ManifestFile>,
    pub missing: Vec<ManifestMissing>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestProject {
    pub id: String,
    pub title: String,
    pub als_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    pub archive_path: String,
    pub original_path: String,
    pub stage: Option<String>,
    pub export_type: Option<String>,
    pub version_label: Option<String>,
    pub is_final: bool,
    pub size_bytes: u64,
    pub sha256: String,
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManifestMissing {
    pub original_path: String,
    pub stage: Option<String>,
    pub reason: String,
}

impl Manifest {
    pub fn is_partial(&self) -> bool {
        !self.missing.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_round_trips_through_json() {
        let manifest = Manifest {
            schema: 1,
            project: ManifestProject {
                id: "proj-1".into(),
                title: "My Song".into(),
                als_path: "/songs/my-song.als".into(),
            },
            created_at: 1_735_500_000,
            app_version: "0.2.0".into(),
            files: vec![ManifestFile {
                archive_path: "stages/export/final.wav".into(),
                original_path: "/songs/exports/final.wav".into(),
                stage: Some("export".into()),
                export_type: Some("mix".into()),
                version_label: Some("v3".into()),
                is_final: true,
                size_bytes: 48_213_990,
                sha256: "a".repeat(64),
                mtime: 1_735_400_000,
            }],
            missing: vec![ManifestMissing {
                original_path: "/songs/stems/kick.wav".into(),
                stage: Some("export".into()),
                reason: "not found on disk".into(),
            }],
        };

        let json = serde_json::to_string(&manifest).unwrap();
        let parsed: Manifest = serde_json::from_str(&json).unwrap();
        assert_eq!(manifest, parsed);
        assert!(parsed.is_partial());
    }

    #[test]
    fn manifest_with_no_missing_is_not_partial() {
        let manifest = Manifest {
            schema: 1,
            project: ManifestProject {
                id: "proj-1".into(),
                title: "My Song".into(),
                als_path: "/songs/my-song.als".into(),
            },
            created_at: 0,
            app_version: "0.2.0".into(),
            files: vec![],
            missing: vec![],
        };
        assert!(!manifest.is_partial());
    }
}
