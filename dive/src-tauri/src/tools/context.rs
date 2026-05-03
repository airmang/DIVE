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
        let root = project_root.as_ref().to_path_buf();
        let fs = Arc::new(FsGuard::new(root.clone()));
        Self {
            project_root: root,
            session_id,
            fs,
        }
    }
}
