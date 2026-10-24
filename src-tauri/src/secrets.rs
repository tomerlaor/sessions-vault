const SERVICE: &str = "com.sessions.app";

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

// macOS asks for the login password once per keychain item, so every secret
// lives in ONE item (a JSON map stored under VAULT_ACCOUNT): at most one prompt
// per launch, however many features use secrets. Other platforms don't prompt
// and keep one item per key.
const USE_VAULT: bool = cfg!(target_os = "macos");
// Debug builds skip the OS keychain entirely: an unsigned dev binary looks like
// a new app after every rebuild, so macOS would ask for the password again each
// time. Dev secrets go to a private file instead; release builds never use it.
const USE_DEV_FILE: bool = cfg!(debug_assertions);
const VAULT_ACCOUNT: &str = "vault";
// Empty items named "has:<key>" record which keys exist. A keychain item's
// existence can be checked without reading it (no prompt), whereas the vault's
// contents can't, so `exists` uses these markers.
const MARKER_PREFIX: &str = "has:";

#[derive(Default)]
struct State {
    // Vault mode: the decrypted map, loaded on first use.
    vault: Option<HashMap<String, String>>,
    // Vault mode: keys already looked up as legacy per-key items.
    legacy_checked: HashSet<String>,
    // Per-key mode: read cache.
    cache: HashMap<String, Option<String>>,
}

// One lock for everything: held across the OS call so concurrent callers wait
// for the first read instead of each triggering their own prompt.
fn state() -> MutexGuard<'static, State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE
        .get_or_init(|| Mutex::new(State::default()))
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

// In dev, env vars shadow the keychain so recompiles don't trigger prompts.
// e.g. `export GDRIVE_CLIENT_ID=... in your shell before cargo tauri dev`.
#[cfg(debug_assertions)]
fn env_override(key: &str) -> Option<String> {
    std::env::var(key.to_uppercase().replace('-', "_")).ok()
}
#[cfg(not(debug_assertions))]
fn env_override(_key: &str) -> Option<String> {
    None
}

static DEV_FILE: OnceLock<PathBuf> = OnceLock::new();

// Called once at startup with the app data dir. Only used in debug builds.
pub fn init_dev_store(dir: PathBuf) {
    if USE_DEV_FILE {
        let _ = DEV_FILE.set(dir.join("dev-secrets.json"));
    }
}

fn dev_path() -> Result<&'static PathBuf, String> {
    DEV_FILE
        .get()
        .ok_or_else(|| "dev secret store not initialised".to_string())
}

fn dev_read() -> Result<HashMap<String, String>, String> {
    let path = dev_path()?;
    match std::fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json)
            .map_err(|e| format!("{} is unreadable: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

// Writes to a temp file and renames it, so a crash can't leave a half-written
// file. The file is created owner-only on Unix.
fn dev_write(map: &HashMap<String, String>) -> Result<(), String> {
    let path = dev_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    {
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn marker(key: &str) -> String {
    format!("{MARKER_PREFIX}{key}")
}

fn load_vault(st: &mut State) -> Result<(), String> {
    if st.vault.is_some() {
        return Ok(());
    }
    let map = match platform::get(SERVICE, VAULT_ACCOUNT)? {
        // A corrupt vault is an error, not an empty map: treating it as empty
        // would let the next write overwrite whatever is still recoverable.
        Some(json) => serde_json::from_str(&json)
            .map_err(|e| format!("keychain vault is unreadable: {e}"))?,
        None => HashMap::new(),
    };
    st.vault = Some(map);
    Ok(())
}

fn persist_vault(st: &State) -> Result<(), String> {
    let map = st.vault.as_ref().ok_or("vault not loaded")?;
    if map.is_empty() {
        return platform::delete(SERVICE, VAULT_ACCOUNT);
    }
    let json = serde_json::to_string(map).map_err(|e| e.to_string())?;
    platform::store(SERVICE, VAULT_ACCOUNT, &json)
}

// Secrets saved before the vault existed are separate per-key items. Move one
// into the vault the first time it is asked for; the old item is deleted only
// after the vault has been written.
fn migrate_legacy(st: &mut State, key: &str) -> Result<Option<String>, String> {
    if !st.legacy_checked.insert(key.to_owned()) {
        return Ok(None);
    }
    let Some(value) = platform::get(SERVICE, key)? else {
        return Ok(None);
    };
    st.vault
        .as_mut()
        .ok_or("vault not loaded")?
        .insert(key.to_owned(), value.clone());
    persist_vault(st)?;
    platform::store(SERVICE, &marker(key), "1")?;
    platform::delete(SERVICE, key)?;
    Ok(Some(value))
}

pub fn store(key: &str, value: &str) -> Result<(), String> {
    if USE_DEV_FILE {
        let _guard = state();
        let mut map = dev_read()?;
        map.insert(key.to_owned(), value.to_owned());
        return dev_write(&map);
    }
    let mut st = state();
    if !USE_VAULT {
        platform::store(SERVICE, key, value)?;
        st.cache.insert(key.to_owned(), Some(value.to_owned()));
        return Ok(());
    }
    load_vault(&mut st)?;
    st.vault
        .as_mut()
        .ok_or("vault not loaded")?
        .insert(key.to_owned(), value.to_owned());
    persist_vault(&st)?;
    platform::store(SERVICE, &marker(key), "1")?;
    // Drop any pre-vault copy of this key.
    platform::delete(SERVICE, key)?;
    st.legacy_checked.insert(key.to_owned());
    Ok(())
}

pub fn get(key: &str) -> Result<Option<String>, String> {
    if let Some(v) = env_override(key) {
        return Ok(Some(v));
    }
    if USE_DEV_FILE {
        let _guard = state();
        return Ok(dev_read()?.get(key).cloned());
    }
    let mut st = state();
    if !USE_VAULT {
        if let Some(cached) = st.cache.get(key) {
            return Ok(cached.clone());
        }
        let result = platform::get(SERVICE, key)?;
        st.cache.insert(key.to_owned(), result.clone());
        return Ok(result);
    }
    load_vault(&mut st)?;
    if let Some(v) = st.vault.as_ref().and_then(|m| m.get(key)) {
        return Ok(Some(v.clone()));
    }
    migrate_legacy(&mut st, key)
}

// Existence check that never reads a secret, so it can't trigger an OS prompt.
pub fn exists(key: &str) -> Result<bool, String> {
    if env_override(key).is_some() {
        return Ok(true);
    }
    if USE_DEV_FILE {
        let _guard = state();
        return Ok(dev_read()?.contains_key(key));
    }
    let st = state();
    if !USE_VAULT {
        if let Some(cached) = st.cache.get(key) {
            return Ok(cached.is_some());
        }
        return platform::exists(SERVICE, key);
    }
    if st.vault.as_ref().is_some_and(|m| m.contains_key(key)) {
        return Ok(true);
    }
    // Marker for vault entries, or the key's own item for not-yet-migrated ones.
    Ok(platform::exists(SERVICE, &marker(key))? || platform::exists(SERVICE, key)?)
}

pub fn delete(key: &str) -> Result<(), String> {
    if USE_DEV_FILE {
        let _guard = state();
        let mut map = dev_read()?;
        map.remove(key);
        return dev_write(&map);
    }
    let mut st = state();
    if !USE_VAULT {
        platform::delete(SERVICE, key)?;
        st.cache.remove(key);
        return Ok(());
    }
    load_vault(&mut st)?;
    st.vault.as_mut().ok_or("vault not loaded")?.remove(key);
    persist_vault(&st)?;
    platform::delete(SERVICE, &marker(key))?;
    platform::delete(SERVICE, key)?;
    st.legacy_checked.insert(key.to_owned());
    Ok(())
}

// ── macOS ─────────────────────────────────────────────────────────────────────
// On every store() we delete the existing item and recreate it with an ACL
// that names our binary as the only trusted caller. That way get() never shows
// the "SessionsVault wants to use your confidential information" dialog.
//
// SecAccessCreate / SecTrustedApplicationCreateFromPath / SecKeychainItemSetAccess
// are legacy (pre-Data-Protection) keychain APIs that the security-framework Rust
// crate does not wrap, so we declare them via extern "C" directly.
#[cfg(target_os = "macos")]
mod platform {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    use core_foundation_sys::array::{CFArrayCallBacks, CFArrayCreate};
    use core_foundation_sys::base::{CFAllocatorRef, CFIndex, CFRelease, CFTypeRef, OSStatus};
    use security_framework::os::macos::keychain::SecKeychain;
    use std::ffi::CString;
    use std::ptr;

    const ERR_NOT_FOUND: i32 = -25300; // errSecItemNotFound

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        static kCFTypeArrayCallBacks: CFArrayCallBacks;

        fn SecTrustedApplicationCreateFromPath(
            path: *const std::os::raw::c_char,
            app: *mut CFTypeRef,
        ) -> OSStatus;

        fn SecAccessCreate(
            descriptor: CFTypeRef,
            trusted_list: CFTypeRef, // CFArrayRef (the array itself, not a pointer to it)
            access: *mut CFTypeRef,
        ) -> OSStatus;

        fn SecKeychainItemSetAccess(item_ref: CFTypeRef, access: CFTypeRef) -> OSStatus;
    }

    // Sets an ACL on a raw keychain item so only the current binary can read it
    // without a prompt. Errors here are non-fatal: the item was already stored,
    // it just might prompt once before the user clicks "Always Allow".
    unsafe fn set_item_acl(item_ref: CFTypeRef) {
        let exe = match std::env::current_exe() {
            Ok(p) => p,
            Err(_) => return,
        };
        let Ok(exe_c) = CString::new(exe.to_string_lossy().as_bytes()) else {
            return;
        };

        let mut trusted_app: CFTypeRef = ptr::null();
        if SecTrustedApplicationCreateFromPath(exe_c.as_ptr(), &mut trusted_app) != 0
            || trusted_app.is_null()
        {
            return;
        }

        // CFArrayCreate expects *const *const c_void; CFTypeRef IS *const c_void.
        let items: [CFTypeRef; 1] = [trusted_app];
        let array = CFArrayCreate(
            ptr::null::<CFAllocatorRef>() as CFAllocatorRef,
            items.as_ptr() as *const *const _,
            1 as CFIndex,
            &kCFTypeArrayCallBacks,
        );
        CFRelease(trusted_app);

        if array.is_null() {
            return;
        }

        let descriptor = CFString::new("SessionsVault");
        let mut access: CFTypeRef = ptr::null();
        let status = SecAccessCreate(descriptor.as_CFTypeRef(), array as CFTypeRef, &mut access);
        CFRelease(array as _);

        if status == 0 && !access.is_null() {
            SecKeychainItemSetAccess(item_ref, access);
            CFRelease(access);
        }
    }

    pub fn store(service: &str, key: &str, value: &str) -> Result<(), String> {
        let _ = delete(service, key); // reset stale ACL if item exists

        let kc = SecKeychain::default().map_err(|e| e.to_string())?;
        kc.add_generic_password(service, key, value.as_bytes())
            .map_err(|e| e.to_string())?;

        if let Ok((_, item)) = kc.find_generic_password(service, key) {
            unsafe { set_item_acl(item.as_CFTypeRef()) };
        }

        Ok(())
    }

    pub fn get(service: &str, key: &str) -> Result<Option<String>, String> {
        let kc = SecKeychain::default().map_err(|e| e.to_string())?;
        match kc.find_generic_password(service, key) {
            Ok((pw, _)) => Ok(Some(
                std::str::from_utf8(pw.as_ref())
                    .map_err(|e| e.to_string())?
                    .to_owned(),
            )),
            Err(e) if e.code() == ERR_NOT_FOUND => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    // Attributes-only search: finds the item without loading its secret data.
    pub fn exists(service: &str, key: &str) -> Result<bool, String> {
        use security_framework::item::{ItemClass, ItemSearchOptions};
        match ItemSearchOptions::new()
            .class(ItemClass::generic_password())
            .service(service)
            .account(key)
            .load_attributes(true)
            .limit(1)
            .search()
        {
            Ok(r) => Ok(!r.is_empty()),
            Err(e) if e.code() == ERR_NOT_FOUND => Ok(false),
            Err(e) => Err(e.to_string()),
        }
    }

    // SecItemDelete removes the item without reading its secret, so replacing a
    // key written by an earlier build doesn't trigger a keychain password prompt.
    pub fn delete(service: &str, key: &str) -> Result<(), String> {
        match security_framework::passwords::delete_generic_password(service, key) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == ERR_NOT_FOUND => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

// ── Windows + Linux fallback ───────────────────────────────────────────────────
// Windows Credential Manager uses DPAPI (tied to the user's Windows login) —
// no password prompt ever. Linux falls back to libsecret / session keyring.
#[cfg(not(target_os = "macos"))]
mod platform {
    use keyring::Error as KErr;

    pub fn store(service: &str, key: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(service, key)
            .map_err(|e| e.to_string())?
            .set_password(value)
            .map_err(|e| e.to_string())
    }

    pub fn get(service: &str, key: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(service, key)
            .map_err(|e| e.to_string())?
            .get_password()
        {
            Ok(v) => Ok(Some(v)),
            Err(KErr::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn exists(service: &str, key: &str) -> Result<bool, String> {
        get(service, key).map(|v| v.is_some())
    }

    pub fn delete(service: &str, key: &str) -> Result<(), String> {
        match keyring::Entry::new(service, key)
            .map_err(|e| e.to_string())?
            .delete_password()
        {
            Ok(()) | Err(KErr::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}
