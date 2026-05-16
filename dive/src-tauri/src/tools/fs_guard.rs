use std::path::{Path, PathBuf};

use super::guard::reject_symlink_components;
use super::ToolError;

/// Path sandbox enforcement. Spec §9.3 — all tool filesystem operations must
/// resolve inside the project root. `.git/` writes are hard-blocked even though
/// full blocklist support lands in task 3-4.
pub struct FsGuard {
    project_root: PathBuf,
}

impl FsGuard {
    pub fn new(project_root: impl Into<PathBuf>) -> Self {
        let project_root = project_root.into();
        let project_root =
            std::fs::canonicalize(&project_root).unwrap_or_else(|_| normalize(&project_root));
        Self { project_root }
    }

    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    /// Join + normalize a user-supplied relative path against the project root.
    /// Absolute paths and any resolved target escaping the root return PathDenied.
    pub fn resolve(&self, user_path: impl AsRef<Path>) -> Result<PathBuf, ToolError> {
        let p = user_path.as_ref();
        reject_dangerous_path_string(p)?;
        if p.is_absolute() {
            return Err(ToolError::PathDenied(format!(
                "absolute path not allowed: {}",
                p.display()
            )));
        }
        let joined = self.project_root.join(p);
        let normalized = normalize(&joined);
        if !normalized.starts_with(&self.project_root) {
            return Err(ToolError::PathDenied(format!(
                "path escapes project root: {}",
                p.display()
            )));
        }
        if contains_git_dir(&normalized, &self.project_root) {
            return Err(ToolError::PathDenied(
                ".git directory is not writable".into(),
            ));
        }
        reject_symlink_components(&normalized, &self.project_root)?;
        if let Some(canonical) = canonicalize_existing(&normalized)? {
            ensure_inside_root(&canonical, &self.project_root, p)?;
        }
        Ok(normalized)
    }

    /// Read-only resolution — allows `.git` (e.g. viewing log/config), still
    /// blocks escape and symlink traversal.
    pub fn resolve_read(&self, user_path: impl AsRef<Path>) -> Result<PathBuf, ToolError> {
        let p = user_path.as_ref();
        reject_dangerous_path_string(p)?;
        if p.is_absolute() {
            return Err(ToolError::PathDenied(format!(
                "absolute path not allowed: {}",
                p.display()
            )));
        }
        let joined = self.project_root.join(p);
        let normalized = normalize(&joined);
        if !normalized.starts_with(&self.project_root) {
            return Err(ToolError::PathDenied(format!(
                "path escapes project root: {}",
                p.display()
            )));
        }
        reject_symlink_components(&normalized, &self.project_root)?;
        if let Some(canonical) = canonicalize_existing(&normalized)? {
            ensure_inside_root(&canonical, &self.project_root, p)?;
        }
        Ok(normalized)
    }

    /// Re-check the parent of a write target after parent creation and before
    /// writing bytes. This closes the common gap where an attacker swaps a
    /// missing parent for a symlink between logical path validation and write.
    pub fn verify_write_parent(&self, target: &Path) -> Result<(), ToolError> {
        let Some(parent) = target.parent() else {
            return Ok(());
        };
        if !parent.starts_with(&self.project_root) {
            return Err(ToolError::PathDenied(format!(
                "path escapes project root: {}",
                target.display()
            )));
        }
        reject_symlink_components(parent, &self.project_root)?;
        let canonical_parent = std::fs::canonicalize(parent)?;
        ensure_inside_root(&canonical_parent, &self.project_root, target)?;
        if contains_git_dir(&canonical_parent, &self.project_root) {
            return Err(ToolError::PathDenied(
                ".git directory is not writable".into(),
            ));
        }
        Ok(())
    }
}

/// Logical `..`/`.` collapse without requiring the path to exist. Symlink
/// containment is enforced by callers once the logical path is inside root.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        use std::path::Component;
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn contains_git_dir(target: &Path, root: &Path) -> bool {
    let Ok(rel) = target.strip_prefix(root) else {
        return false;
    };
    rel.components()
        .any(|c| c.as_os_str() == std::ffi::OsStr::new(".git"))
}

fn reject_dangerous_path_string(path: &Path) -> Result<(), ToolError> {
    let raw = path.to_string_lossy();
    if is_windows_dangerous_path_string(&raw) {
        return Err(ToolError::PathDenied(format!(
            "windows-style path not allowed: {}",
            path.display()
        )));
    }
    Ok(())
}

pub(crate) fn is_windows_dangerous_path_string(raw: &str) -> bool {
    let windows_separators = raw.replace('/', "\\");
    if windows_separators.starts_with('\\') {
        return true;
    }

    raw.contains(':')
}

fn canonicalize_existing(path: &Path) -> Result<Option<PathBuf>, ToolError> {
    match std::fs::canonicalize(path) {
        Ok(path) => Ok(Some(path)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(ToolError::Io(e)),
    }
}

fn ensure_inside_root(target: &Path, root: &Path, original: &Path) -> Result<(), ToolError> {
    if target.starts_with(root) {
        return Ok(());
    }
    Err(ToolError::PathDenied(format!(
        "path escapes project root: {}",
        original.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn guard() -> FsGuard {
        FsGuard::new(PathBuf::from("/tmp/project"))
    }

    #[test]
    fn rejects_absolute_path() {
        assert!(guard().resolve("/etc/passwd").is_err());
    }

    #[test]
    fn rejects_escape_via_parent() {
        assert!(guard().resolve("../secret").is_err());
    }

    #[test]
    fn accepts_nested_relative() {
        let r = guard().resolve("src/foo.rs").unwrap();
        assert_eq!(r, PathBuf::from("/tmp/project/src/foo.rs"));
    }

    #[test]
    fn blocks_git_write() {
        assert!(guard().resolve(".git/config").is_err());
        assert!(guard().resolve("sub/.git/HEAD").is_err());
    }

    #[test]
    fn allows_git_read() {
        assert!(guard().resolve_read(".git/HEAD").is_ok());
    }

    #[test]
    fn resolves_curdir() {
        let r = guard().resolve("./src/foo.rs").unwrap();
        assert_eq!(r, PathBuf::from("/tmp/project/src/foo.rs"));
    }

    #[test]
    fn rejects_windows_dangerous_path_strings_cross_platform() {
        for path in [
            r"\\server\share\file.txt",
            r"\\?\C:\Users\student\file.txt",
            r"C:relative\file.txt",
            r"\rooted\file.txt",
            r"file.txt::$DATA",
            r"file.txt:stream",
        ] {
            assert!(guard().resolve(path).is_err(), "accepted {path}");
            assert!(guard().resolve_read(path).is_err(), "accepted read {path}");
        }
    }

    #[test]
    #[cfg(unix)]
    fn read_resolution_rejects_canonical_symlink_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("project");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(&outside, project.join("escape")).unwrap();

        let guard = FsGuard::new(&project);

        assert!(guard.resolve_read("escape/secret.txt").is_err());
    }

    #[test]
    fn canonicalizes_project_root_on_construction() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("project");
        std::fs::create_dir_all(project.join("src")).unwrap();

        let guard = FsGuard::new(project.join("src/.."));

        assert_eq!(guard.project_root(), project.canonicalize().unwrap());
    }

    #[test]
    #[cfg(any(unix, windows))]
    fn write_parent_recheck_rejects_symlink_swapped_after_resolve() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("project");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        let guard = FsGuard::new(&project);
        let target = guard.resolve("escape/new.txt").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, project.join("escape")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, project.join("escape")).unwrap();

        assert!(guard.verify_write_parent(&target).is_err());
    }
}
