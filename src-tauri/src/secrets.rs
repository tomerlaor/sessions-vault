const SERVICE: &str = "com.sessions.app";

pub fn store(key: &str, value: &str) -> Result<(), String> {
    platform::store(SERVICE, key, value)
}

pub fn get(key: &str) -> Result<Option<String>, String> {
    // In dev, env vars shadow the keychain so recompiles don't trigger prompts.
    // e.g. `export GDRIVE_CLIENT_ID=... in your shell before cargo tauri dev`.
    #[cfg(debug_assertions)]
    {
        let env_key = key.to_uppercase().replace('-', "_");
        if let Ok(v) = std::env::var(&env_key) {
            return Ok(Some(v));
        }
    }
    platform::get(SERVICE, key)
}

pub fn delete(key: &str) -> Result<(), String> {
    platform::delete(SERVICE, key)
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
            trusted_list: *const CFTypeRef, // CFArrayRef
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
        let status = SecAccessCreate(descriptor.as_CFTypeRef(), &array as *const _ as _, &mut access);
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

    pub fn delete(service: &str, key: &str) -> Result<(), String> {
        let kc = SecKeychain::default().map_err(|e| e.to_string())?;
        match kc.find_generic_password(service, key) {
            Ok((_, item)) => {
                item.delete();
                Ok(())
            }
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
