use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

use super::guard::reject_symlink_components;
use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    path: String,
    #[serde(default)]
    recursive: bool,
}

pub struct Mkdir;

#[async_trait]
impl Tool for Mkdir {
    fn name(&self) -> &str {
        "mkdir"
    }

    fn description(&self) -> &str {
        "Create a directory inside the project root"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" },
                "recursive": { "type": "boolean", "description": "Create parent directories when true" }
            },
            "required": ["path"]
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Warn
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let path = ctx.fs.resolve(&args.path)?;
        if path.is_file() {
            return Err(ToolError::InvalidInput(format!(
                "path is a file: {}",
                args.path
            )));
        }
        if args.recursive {
            tokio::fs::create_dir_all(&path).await?;
        } else if !path.exists() {
            tokio::fs::create_dir(&path).await?;
        }
        verify_created_dir_inside_root(&path, ctx).await?;
        Ok(ToolOutput::success(
            format!("created directory {}", args.path),
            json!({ "path": args.path, "recursive": args.recursive }),
        ))
    }
}

/// Re-check the just-created directory before reporting success. `resolve()`
/// only validates the *logical* path before creation; when the target (or an
/// ancestor of it) does not exist yet, it skips the physical symlink/
/// containment checks entirely. A parent-symlink planted in the window
/// between `resolve()` and `create_dir_all`/`create_dir` can therefore make
/// the directory actually land outside the sandbox root while the tool still
/// reports success. Mirrors `write_file`'s post-create `verify_write_parent`
/// recheck (mkdir-missing-verify-write-parent-toctou).
async fn verify_created_dir_inside_root(path: &Path, ctx: &ToolContext) -> Result<(), ToolError> {
    let root = ctx.fs.project_root();
    reject_symlink_components(path, root)?;
    let canonical = tokio::fs::canonicalize(path).await?;
    if !canonical.starts_with(root) {
        return Err(ToolError::PathDenied(format!(
            "path escapes project root: {}",
            path.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn mkdir_creates_nested_directory_when_recursive() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let out = Mkdir
            .run(json!({ "path": "a/b", "recursive": true }), &ctx)
            .await
            .unwrap();
        assert!(out.success);
        assert!(tmp.path().join("a/b").is_dir());
    }

    #[tokio::test]
    async fn mkdir_rejects_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let err = Mkdir
            .run(json!({ "path": "../escape", "recursive": true }), &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::PathDenied(_)));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn mkdir_post_create_recheck_rejects_symlinked_parent() {
        // mkdir-missing-verify-write-parent-toctou: mirrors fs_guard's
        // `write_parent_recheck_rejects_symlink_swapped_after_resolve`. The
        // parent (`escape`) does not exist at resolve time, so `resolve()`'s
        // symlink/containment checks are skipped (nothing to walk yet); if a
        // symlink is planted there before the actual mkdir syscall runs, the
        // directory is physically created outside the sandbox root unless the
        // post-create recheck catches it.
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("project");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        let ctx = ToolContext::new(&project, 1);
        let target = ctx.fs.resolve("escape/newdir").unwrap();

        std::os::unix::fs::symlink(&outside, project.join("escape")).unwrap();
        // Simulate the race window: the mkdir syscall follows the freshly
        // planted symlink and creates the directory outside the sandbox.
        tokio::fs::create_dir_all(&target).await.unwrap();
        assert!(outside.join("newdir").is_dir());

        let err = verify_created_dir_inside_root(&target, &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::PathDenied(_)));
    }
}
