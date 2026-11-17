use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;

// ── PKCE helpers ─────────────────────────────────────────────────────────────

fn generate_pkce() -> (String, String) {
    let bytes: Vec<u8> = (0..32).map(|_| rand::thread_rng().gen::<u8>()).collect();
    let verifier = URL_SAFE_NO_PAD.encode(&bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn build_auth_url(client_id: &str, redirect_uri: &str, challenge: &str) -> String {
    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "https://www.googleapis.com/auth/drive.file")
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    url.to_string()
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

/// Starts the PKCE OAuth flow: opens a browser and waits for the redirect.
/// Blocks (run via spawn_blocking) until the user completes the flow.
pub fn start_auth_sync(
    client_id: &str,
    client_secret: &str,
) -> Result<super::GDriveTokens, String> {
    let (verifier, challenge) = generate_pkce();

    // Find a free port
    let (server, port) = (7238u16..7300)
        .find_map(|p| {
            tiny_http::Server::http(format!("127.0.0.1:{p}"))
                .ok()
                .map(|s| (s, p))
        })
        .ok_or("could not bind OAuth redirect port")?;

    let redirect_uri = format!("http://127.0.0.1:{port}");
    let auth_url = build_auth_url(client_id, &redirect_uri, &challenge);

    open::that(&auth_url).map_err(|e| format!("failed to open browser: {e}"))?;

    // Wait for redirect
    let request = server.recv().map_err(|e| format!("OAuth server: {e}"))?;
    let url =
        Url::parse(&format!("http://localhost{}", request.url())).map_err(|e| e.to_string())?;

    let code = url
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.into_owned())
        .ok_or_else(|| {
            url.query_pairs()
                .find(|(k, _)| k == "error_description" || k == "error")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_else(|| "OAuth cancelled or failed".to_string())
        })?;

    let html = "<html><body style='font-family:sans-serif;text-align:center;padding:60px'>\
        <h2 style='color:#22c55e'>&#10003; Connected to Google Drive!</h2>\
        <p>You can close this tab and return to the app.</p></body></html>";
    let _ = request.respond(tiny_http::Response::from_string(html));

    // Exchange code — use blocking reqwest here (we're already in a blocking thread)
    exchange_code_blocking(client_id, client_secret, &redirect_uri, &code, &verifier)
}

fn exchange_code_blocking(
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Result<super::GDriveTokens, String> {
    let client = reqwest::blocking::Client::new();
    let resp: serde_json::Value = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
            ("code_verifier", verifier),
        ])
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    if let Some(err) = resp.get("error") {
        return Err(format!(
            "token exchange: {} — {}",
            err,
            resp.get("error_description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
        ));
    }

    Ok(super::GDriveTokens {
        access_token: resp["access_token"]
            .as_str()
            .ok_or("no access_token")?
            .to_string(),
        refresh_token: resp["refresh_token"]
            .as_str()
            .ok_or("no refresh_token")?
            .to_string(),
        expires_in: resp["expires_in"].as_i64().unwrap_or(3600),
    })
}

/// Gets a new access token from a stored refresh token.
pub async fn refresh_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<super::GDriveTokens, String> {
    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(err) = resp.get("error") {
        return Err(format!("token refresh: {err}"));
    }

    Ok(super::GDriveTokens {
        access_token: resp["access_token"]
            .as_str()
            .ok_or("no access_token")?
            .to_string(),
        refresh_token: refresh_token.to_string(), // refresh tokens are long-lived
        expires_in: resp["expires_in"].as_i64().unwrap_or(3600),
    })
}

// ── Session (tokens never leave Rust) ────────────────────────────────────────
//
// The client secret and refresh token live only in the secret store, and the
// access token only in memory. The webview never sees any of them: it can only
// connect, disconnect, ask whether Drive is connected, and request a backup.

const K_CLIENT_SECRET: &str = "gdrive.client_secret";
const K_REFRESH_TOKEN: &str = "gdrive.refresh_token";
// Older builds stored the access token too; it is only ever deleted now.
const K_LEGACY_ACCESS_TOKEN: &str = "gdrive.access_token";

/// Refresh this long before Google's stated expiry.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

struct CachedToken {
    token: String,
    expires_at: Instant,
}

static ACCESS_TOKEN: Mutex<Option<CachedToken>> = Mutex::new(None);

fn cache_access_token(tokens: &super::GDriveTokens) {
    let lifetime = Duration::from_secs(tokens.expires_in.max(0) as u64);
    *ACCESS_TOKEN.lock().unwrap_or_else(|p| p.into_inner()) = Some(CachedToken {
        token: tokens.access_token.clone(),
        expires_at: Instant::now() + lifetime,
    });
}

fn cached_access_token() -> Option<String> {
    let guard = ACCESS_TOKEN.lock().unwrap_or_else(|p| p.into_inner());
    guard
        .as_ref()
        .filter(|c| c.expires_at > Instant::now() + EXPIRY_MARGIN)
        .map(|c| c.token.clone())
}

fn clear_access_token() {
    *ACCESS_TOKEN.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

/// Runs the OAuth flow and stores the resulting credentials. Blocking.
pub fn connect(client_id: &str, client_secret: &str) -> Result<(), String> {
    let tokens = start_auth_sync(client_id, client_secret)?;
    crate::secrets::store(K_CLIENT_SECRET, client_secret)?;
    crate::secrets::store(K_REFRESH_TOKEN, &tokens.refresh_token)?;
    let _ = crate::secrets::delete(K_LEGACY_ACCESS_TOKEN);
    cache_access_token(&tokens);
    Ok(())
}

/// Forgets every stored Google credential. Blocking.
pub fn disconnect() -> Result<(), String> {
    clear_access_token();
    crate::secrets::delete(K_CLIENT_SECRET)?;
    crate::secrets::delete(K_REFRESH_TOKEN)?;
    crate::secrets::delete(K_LEGACY_ACCESS_TOKEN)
}

/// Whether a refresh token is stored, without reading it (no keychain prompt).
pub fn is_connected() -> Result<bool, String> {
    crate::secrets::exists(K_REFRESH_TOKEN)
}

/// Returns a valid access token, refreshing it from the stored credentials
/// when the cached one is missing or about to expire.
pub async fn access_token(client_id: &str) -> Result<String, String> {
    if let Some(token) = cached_access_token() {
        return Ok(token);
    }
    // Keychain reads can block on an OS prompt, so keep them off the runtime.
    let (secret, refresh) = tauri::async_runtime::spawn_blocking(|| {
        let not_connected = || "Not connected to Google Drive".to_string();
        let secret = crate::secrets::get(K_CLIENT_SECRET)?.ok_or_else(not_connected)?;
        let refresh = crate::secrets::get(K_REFRESH_TOKEN)?.ok_or_else(not_connected)?;
        Ok::<_, String>((secret, refresh))
    })
    .await
    .map_err(|e| e.to_string())??;

    let tokens = refresh_token(client_id, &secret, &refresh).await?;
    cache_access_token(&tokens);
    Ok(tokens.access_token)
}

// ── Upload ────────────────────────────────────────────────────────────────────

/// Uploads the zip to Google Drive. Returns the Drive file ID.
pub async fn upload(
    zip_path: &Path,
    file_name: &str,
    access_token: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let folder_id = ensure_folder(&client, access_token).await?;
    upload_file(&client, access_token, zip_path, file_name, &folder_id).await
}

async fn ensure_folder(client: &reqwest::Client, access_token: &str) -> Result<String, String> {
    let q = "name='DAW Manager Backups' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    let search: serde_json::Value = client
        .get("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(access_token)
        .query(&[("q", q), ("fields", "files(id)")])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(id) = search["files"]
        .as_array()
        .and_then(|f| f.first())
        .and_then(|f| f["id"].as_str())
    {
        return Ok(id.to_string());
    }

    let created: serde_json::Value = client
        .post("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "name": "DAW Manager Backups",
            "mimeType": "application/vnd.google-apps.folder"
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    created["id"]
        .as_str()
        .ok_or("no folder id in response")?
        .pipe(|s| Ok(s.to_string()))
}

async fn upload_file(
    client: &reqwest::Client,
    access_token: &str,
    zip_path: &Path,
    file_name: &str,
    folder_id: &str,
) -> Result<String, String> {
    let file_bytes = std::fs::read(zip_path).map_err(|e| format!("read zip: {e}"))?;
    let file_size = file_bytes.len();

    // 1. Initiate resumable upload session
    let init = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable")
        .bearer_auth(access_token)
        .header("X-Upload-Content-Type", "application/zip")
        .header("X-Upload-Content-Length", file_size.to_string())
        .json(&serde_json::json!({
            "name": file_name,
            "parents": [folder_id]
        }))
        .send()
        .await
        .map_err(|e| format!("initiate upload: {e}"))?;

    let upload_url = init
        .headers()
        .get("location")
        .or_else(|| init.headers().get("Location"))
        .ok_or("no Location header from Drive")?
        .to_str()
        .map_err(|e| e.to_string())?
        .to_string();

    // 2. Upload the bytes
    let result: serde_json::Value = client
        .put(&upload_url)
        .header("Content-Type", "application/zip")
        .body(file_bytes)
        .send()
        .await
        .map_err(|e| format!("upload: {e}"))?
        .json()
        .await
        .map_err(|e| format!("upload response: {e}"))?;

    result["id"]
        .as_str()
        .ok_or("no file id in upload response")?
        .pipe(|s| Ok(s.to_string()))
}

// ── Download (for restore) ──────────────────────────────────────────────────

/// A Drive file ID is an opaque token; Google's documented alphabet is
/// alphanumerics plus `-` and `_`. Rejecting anything else keeps a malformed
/// or hostile ID (e.g. one containing `/` or `..`) from being interpreted as
/// something other than a single URL path segment.
pub fn is_valid_file_id(file_id: &str) -> bool {
    !file_id.is_empty()
        && file_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Percent-encodes a string for use as one URL path segment. Defense in depth
/// alongside `is_valid_file_id`: even if validation is ever loosened, the
/// literal bytes can't smuggle a `/`, `?`, or `#` into the request path.
fn percent_encode_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// A path under the OS temp dir that nothing else could have predicted or
/// pre-created, so the download below can safely use `create_new`.
fn unique_temp_zip_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let rand_suffix: u64 = rand::thread_rng().gen();
    std::env::temp_dir().join(format!("dawmgr-restore-{nanos:x}-{rand_suffix:x}.zip"))
}

/// Removes the temp file on drop unless `keep()` was called — so a download
/// that fails partway through never leaves a partial file behind.
struct TempFileGuard(Option<PathBuf>);

impl TempFileGuard {
    fn keep(mut self) -> PathBuf {
        self.0.take().expect("guard already consumed")
    }
}

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Downloads a Drive file to a freshly created temp file and returns its
/// path, streaming the response instead of buffering it whole in memory.
/// Used by restore when a backup's `destination` is a bare Drive file ID
/// rather than an already-local path (see `HistoryTab.tsx`'s `gdrive-folder`
/// vs `gdrive-api` distinction). Callers are responsible for deleting the
/// returned path once they're done restoring from it (success or error) —
/// see `delete_temp_download`.
pub async fn download(file_id: &str, access_token: &str) -> Result<PathBuf, String> {
    if !is_valid_file_id(file_id) {
        return Err(format!("invalid Google Drive file id: {file_id}"));
    }

    let client = reqwest::Client::new();
    let mut resp = client
        .get(format!(
            "https://www.googleapis.com/drive/v3/files/{}?alt=media",
            percent_encode_path_segment(file_id)
        ))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("download: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }

    let dest = unique_temp_zip_path();
    let guard = TempFileGuard(Some(dest.clone()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dest)
        .map_err(|e| format!("create temp file: {e}"))?;

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("download: {e}"))? {
        file.write_all(&chunk)
            .map_err(|e| format!("write temp file: {e}"))?;
    }
    file.flush().map_err(|e| format!("flush temp file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("sync temp file: {e}"))?;

    Ok(guard.keep())
}

/// Deletes a file previously returned by `download`. Refuses anything
/// outside the OS temp dir so a bad path can't be used to delete arbitrary
/// files.
pub fn delete_temp_download(path: &Path) -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    let canonical_temp = std::fs::canonicalize(&temp_dir).unwrap_or(temp_dir);
    let canonical_path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if canonical_path.parent() != Some(canonical_temp.as_path()) {
        return Err("refusing to delete a file outside the temp directory".to_string());
    }
    let is_our_download = canonical_path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("dawmgr-restore-") && n.ends_with(".zip"));
    if !is_our_download {
        return Err("refusing to delete a file that isn't a restore download".to_string());
    }
    std::fs::remove_file(&canonical_path).map_err(|e| e.to_string())
}

// ── Utility ───────────────────────────────────────────────────────────────────

trait Pipe: Sized {
    fn pipe<T, F: FnOnce(Self) -> T>(self, f: F) -> T {
        f(self)
    }
}
impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(expires_in: i64) -> crate::backup::GDriveTokens {
        crate::backup::GDriveTokens {
            access_token: "tok".into(),
            refresh_token: "ref".into(),
            expires_in,
        }
    }

    // One test so the shared static isn't raced by parallel tests.
    #[test]
    fn access_token_cache() {
        cache_access_token(&tokens(3600));
        assert_eq!(cached_access_token().as_deref(), Some("tok"));

        // Inside the expiry margin counts as expired.
        cache_access_token(&tokens(30));
        assert_eq!(cached_access_token(), None);

        cache_access_token(&tokens(3600));
        clear_access_token();
        assert_eq!(cached_access_token(), None);
    }

    // ── is_valid_file_id ─────────────────────────────────────────────────────

    #[test]
    fn accepts_typical_drive_file_ids() {
        assert!(is_valid_file_id("1A2b3C4d5E6f7G8h9I0j"));
        assert!(is_valid_file_id("abc-DEF_123"));
    }

    #[test]
    fn rejects_empty_and_path_breaking_file_ids() {
        assert!(!is_valid_file_id(""));
        assert!(!is_valid_file_id("../../etc/passwd"));
        assert!(!is_valid_file_id("abc/def"));
        assert!(!is_valid_file_id("abc?alt=foo"));
        assert!(!is_valid_file_id("abc def"));
        assert!(!is_valid_file_id("abc#frag"));
    }

    // ── percent_encode_path_segment ──────────────────────────────────────────

    #[test]
    fn percent_encodes_only_reserved_bytes() {
        assert_eq!(
            percent_encode_path_segment("abc-DEF_123.~"),
            "abc-DEF_123.~"
        );
        assert_eq!(percent_encode_path_segment("a/b"), "a%2Fb");
        assert_eq!(percent_encode_path_segment("a b"), "a%20b");
    }

    // ── delete_temp_download ─────────────────────────────────────────────────

    #[test]
    fn deletes_a_file_inside_the_temp_dir() {
        let path = unique_temp_zip_path();
        std::fs::write(&path, b"x").unwrap();
        assert!(delete_temp_download(&path).is_ok());
        assert!(!path.exists());
    }

    #[test]
    fn refuses_to_delete_a_file_outside_the_temp_dir() {
        // `tempfile::tempdir()` itself lives under the OS temp dir, so use a
        // scratch dir under the crate's own target dir instead — definitely
        // outside it — to prove the guard isn't a no-op.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("gdrive-test-scratch");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("not-a-temp-download.zip");
        std::fs::write(&path, b"x").unwrap();

        assert!(delete_temp_download(&path).is_err());
        assert!(path.exists());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn refuses_to_delete_other_temp_files() {
        let path = std::env::temp_dir().join(format!("not-ours-{}.zip", std::process::id()));
        std::fs::write(&path, b"x").unwrap();
        assert!(delete_temp_download(&path).is_err());
        assert!(path.exists());
        let _ = std::fs::remove_file(&path);
    }
}
