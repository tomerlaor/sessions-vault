use std::path::Path;
use std::process::Command;

#[derive(Debug, PartialEq)]
pub struct Invocation {
    pub program: &'static str,
    pub args: Vec<String>,
}

/// How to show `path` selected in the system file manager.
pub fn reveal_invocation(os: &str, path: &str) -> Option<Invocation> {
    match os {
        "macos" => Some(invocation("open", vec!["-R".into(), path.into()])),
        "windows" => Some(invocation("explorer", vec![format!("/select,{path}")])),
        "linux" => {
            // xdg-open has no "select this file", so open the containing folder.
            let folder = Path::new(path)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .filter(|p| !p.is_empty())
                .unwrap_or_else(|| path.to_string());
            Some(invocation("xdg-open", vec![folder]))
        }
        _ => None,
    }
}

/// How to open `path` with its default application.
pub fn open_invocation(os: &str, path: &str) -> Option<Invocation> {
    let program = match os {
        "macos" => "open",
        "windows" => "explorer",
        "linux" => "xdg-open",
        _ => return None,
    };
    Some(invocation(program, vec![path.into()]))
}

fn invocation(program: &'static str, args: Vec<String>) -> Invocation {
    Invocation { program, args }
}

fn run(invocation: Option<Invocation>) -> Result<(), String> {
    let inv = invocation
        .ok_or_else(|| format!("Not supported on this platform ({})", std::env::consts::OS))?;
    Command::new(inv.program)
        .args(&inv.args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not run {}: {e}", inv.program))
}

pub fn reveal(path: &str) -> Result<(), String> {
    run(reveal_invocation(std::env::consts::OS, path))
}

pub fn open(path: &str) -> Result<(), String> {
    run(open_invocation(std::env::consts::OS, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inv(program: &'static str, args: &[&str]) -> Option<Invocation> {
        Some(Invocation {
            program,
            args: args.iter().map(|a| a.to_string()).collect(),
        })
    }

    #[test]
    fn macos_reveal_selects_the_file_in_finder() {
        assert_eq!(
            reveal_invocation("macos", "/Music/a.wav"),
            inv("open", &["-R", "/Music/a.wav"])
        );
    }

    #[test]
    fn windows_reveal_selects_the_file_in_explorer() {
        assert_eq!(
            reveal_invocation("windows", r"C:\Music\a.wav"),
            inv("explorer", &[r"/select,C:\Music\a.wav"])
        );
    }

    #[test]
    fn linux_reveal_opens_the_containing_folder() {
        assert_eq!(
            reveal_invocation("linux", "/home/me/Music/a.wav"),
            inv("xdg-open", &["/home/me/Music"])
        );
    }

    #[test]
    fn linux_reveal_of_a_bare_name_falls_back_to_the_path_itself() {
        assert_eq!(
            reveal_invocation("linux", "a.wav"),
            inv("xdg-open", &["a.wav"])
        );
    }

    #[test]
    fn open_uses_each_platforms_default_opener() {
        assert_eq!(open_invocation("macos", "/a.als"), inv("open", &["/a.als"]));
        assert_eq!(
            open_invocation("windows", r"C:\a.als"),
            inv("explorer", &[r"C:\a.als"])
        );
        assert_eq!(
            open_invocation("linux", "/a.als"),
            inv("xdg-open", &["/a.als"])
        );
    }

    #[test]
    fn unknown_platforms_are_reported_not_silently_ignored() {
        assert_eq!(reveal_invocation("freebsd", "/a"), None);
        assert_eq!(open_invocation("freebsd", "/a"), None);
        assert!(run(None).is_err());
    }
}
