use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use sha2::{Digest, Sha256};
use std::path::Path;
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
pub fn start_auth_sync(client_id: &str, client_secret: &str) -> Result<super::GDriveTokens, String> {
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
    let url = Url::parse(&format!("http://localhost{}", request.url()))
        .map_err(|e| e.to_string())?;

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

// ── Upload ────────────────────────────────────────────────────────────────────

/// Uploads the zip to Google Drive. Returns the Drive file ID.
pub async fn upload(zip_path: &Path, file_name: &str, access_token: &str) -> Result<String, String> {
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

// ── Utility ───────────────────────────────────────────────────────────────────

trait Pipe: Sized {
    fn pipe<T, F: FnOnce(Self) -> T>(self, f: F) -> T {
        f(self)
    }
}
impl<T> Pipe for T {}
