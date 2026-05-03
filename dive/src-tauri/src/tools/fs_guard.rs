use std::path::{Path, PathBuf};

use super::ToolError;

/// Path sandbox enforcement. Spec §9.3 — all tool filesystem operations must
/// resolve inside the project root. `.git/` writes are hard-blocked even though
/// full blocklist support lands in task 3-4.
pub struct FsGuard {
    project_root: PathBuf,
}

impl FsGuard {
    pub fn new(project_root: impl Into<PathBuf>) -> Self {
        Self {
            project_root: project_root.into(),
        }
    }

    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    /// Join + normalize a user-supplied relative path against the project root.
    /// Absolute paths and any resolved target escaping the root return PathDenied.
    pub fn resolve(&self, user_path: impl AsRef<Path>) -> Result<PathBuf, ToolError> {
        let p = user_path.as_ref();
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
        Ok(normalized)
    }

    /// Read-only resolution — allows `.git` (e.g. viewing log/config), still
    /// blocks escape.
    pub fn resolve_read(&self, user_path: impl AsRef<Path>) -> Result<PathBuf, ToolError> {
        let p = user_path.as_ref();
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
        Ok(normalized)
    }
}

/// Logical `..`/`.` collapse without requiring the path to exist. Does not
/// follow symlinks — that hardening is part of task 3-4.
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
}
