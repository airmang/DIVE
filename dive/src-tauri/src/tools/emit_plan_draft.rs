use async_trait::async_trait;
use serde_json::{json, Value};

use crate::dive::plan_interview;
use crate::tools::{context::ToolContext, RiskLevel, Tool, ToolError, ToolOutput};

pub struct EmitPlanDraftTool;

#[async_trait]
impl Tool for EmitPlanDraftTool {
    fn name(&self) -> &str {
        plan_interview::EMIT_PLAN_DRAFT_TOOL_NAME
    }

    fn description(&self) -> &str {
        "Emit a structured PlanDraft for the user to review. Call only when you have gathered enough context."
    }

    fn input_schema(&self) -> Value {
        plan_interview::plan_interview_tool().parameters
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Safe
    }

    fn validate(&self, input: &Value) -> Result<(), ToolError> {
        let goal = input
            .get("goal")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if goal.is_empty() {
            return Err(ToolError::InvalidInput("goal must be non-empty".into()));
        }
        let mvp = input
            .get("mvp")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if mvp.is_empty() {
            return Err(ToolError::InvalidInput("mvp must be non-empty".into()));
        }
        let steps = input
            .get("steps")
            .and_then(|v| v.as_array())
            .map(|arr| arr.len())
            .unwrap_or(0);
        if steps == 0 {
            return Err(ToolError::InvalidInput(
                "steps must contain at least one entry".into(),
            ));
        }
        Ok(())
    }

    async fn run(&self, input: Value, _ctx: &ToolContext) -> Result<ToolOutput, ToolError> {
        Ok(ToolOutput::success(
            "plan draft emitted",
            json!({ "plan_draft": input }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn emit_plan_draft_returns_payload_as_success() {
        let tool = EmitPlanDraftTool;
        let project_root = std::env::temp_dir();
        let ctx = ToolContext::new(project_root, 1);
        let out = tool
            .run(
                json!({
                    "goal": "Build todo app",
                    "mvp": "List items in memory",
                    "steps": [{"name": "ui", "intent": "render list"}],
                    "success_criteria": ["user can add items"]
                }),
                &ctx,
            )
            .await
            .unwrap();
        assert!(out.success);
        assert_eq!(
            out.full["plan_draft"]["goal"].as_str(),
            Some("Build todo app")
        );
    }

    #[test]
    fn validate_rejects_missing_goal() {
        let tool = EmitPlanDraftTool;
        let err = tool
            .validate(&json!({"mvp": "x", "steps": [{"name":"a","intent":"b"}]}))
            .unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
    }

    #[test]
    fn validate_rejects_empty_steps() {
        let tool = EmitPlanDraftTool;
        let err = tool
            .validate(&json!({"goal": "g", "mvp": "m", "steps": []}))
            .unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
    }
}
