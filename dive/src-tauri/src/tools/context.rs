use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::fs_guard::FsGuard;

#[derive(Clone)]
pub struct ToolContext {
    pub project_root: PathBuf,
    pub session_id: i64,
    pub fs: Arc<FsGuard>,
}

impl ToolContext {
    pub fn new(project_root: impl AsRef<Path>, session_id: i64) -> Self {
        let fs_guard = FsGuard::new(project_root.as_ref().to_path_buf());
        let root = fs_guard.project_root().to_path_buf();
        let fs = Arc::new(fs_guard);
        Self {
            project_root: root,
            session_id,
            fs,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_root_matches_fs_guard_canonical_root() {
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("project");
        std::fs::create_dir_all(project.join("src")).unwrap();

        let ctx = ToolContext::new(project.join("src/.."), 1);

        assert_eq!(ctx.project_root, ctx.fs.project_root());
    }
}
