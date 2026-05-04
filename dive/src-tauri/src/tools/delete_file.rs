use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{RiskLevel, Tool, ToolContext, ToolError, ToolOutput};

#[derive(Deserialize)]
struct Input {
    path: String,
}

pub struct DeleteFile;

#[async_trait]
impl Tool for DeleteFile {
    fn name(&self) -> &str {
        "delete_file"
    }

    fn description(&self) -> &str {
        "Delete a single file inside the project root. Directories are not allowed."
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            },
            "required": ["path"]
        })
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Danger
    }

    async fn run(&self, input: Value, ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        let args: Input =
            serde_json::from_value(input).map_err(|e| ToolError::InvalidInput(e.to_string()))?;
        let path = ctx.fs.resolve(&args.path)?;
        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => ToolError::NotFound(args.path.clone()),
                _ => ToolError::Io(e),
            })?;
        if !meta.is_file() {
            return Err(ToolError::InvalidInput(format!(
                "delete_file only deletes regular files: {}",
                args.path
            )));
        }
        tokio::fs::remove_file(&path).await?;
        Ok(ToolOutput::success(
            format!("deleted {}", args.path),
            json!({ "path": args.path }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn delete_file_removes_regular_file() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "bye").unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let out = DeleteFile
            .run(json!({ "path": "a.txt" }), &ctx)
            .await
            .unwrap();
        assert!(out.success);
        assert!(!tmp.path().join("a.txt").exists());
    }

    #[tokio::test]
    async fn delete_file_rejects_directory_and_escape() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("dir")).unwrap();
        let ctx = ToolContext::new(tmp.path(), 1);
        let err = DeleteFile
            .run(json!({ "path": "dir" }), &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
        let err = DeleteFile
            .run(json!({ "path": "../outside" }), &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::PathDenied(_)));
    }
}
