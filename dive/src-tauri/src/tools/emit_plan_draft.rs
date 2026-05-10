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
        "Emit a submitted interview summary and structured workspace plan draft for review."
    }

    fn input_schema(&self) -> Value {
        plan_interview::plan_interview_tool().parameters
    }

    fn risk_level(&self) -> RiskLevel {
        RiskLevel::Safe
    }

    fn validate(&self, input: &Value) -> Result<(), ToolError> {
        let intent_summary = input
            .get("intent_summary")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if intent_summary.is_empty() {
            return Err(ToolError::InvalidInput(
                "intent_summary must be non-empty".into(),
            ));
        }
        let plan_input = input
            .get("plan_input")
            .ok_or_else(|| ToolError::InvalidInput("plan_input must be provided".to_string()))?;
        let goal = plan_input
            .get("goal")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if goal.is_empty() {
            return Err(ToolError::InvalidInput(
                "plan_input.goal must be non-empty".into(),
            ));
        }
        let steps = plan_input
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
                    "intent_summary": "Build a small todo app",
                    "unresolved_questions": [],
                    "plan_input": {
                        "goal": "Build todo app",
                        "intent_summary": "Build a small todo app",
                        "scope": ["List items in memory"],
                        "non_goals": [],
                        "constraints": [],
                        "acceptance_criteria": ["user can add items"],
                        "steps": [{
                            "step_id": "step-001",
                            "title": "UI",
                            "summary": "Render list",
                            "instruction_seed": "Render list",
                            "expected_files": ["src/App.tsx"],
                            "acceptance_criteria": ["List is visible"],
                            "dependencies": []
                        }]
                    }
                }),
                &ctx,
            )
            .await
            .unwrap();
        assert!(out.success);
        assert_eq!(
            out.full["plan_draft"]["plan_input"]["goal"].as_str(),
            Some("Build todo app")
        );
    }

    #[test]
    fn validate_rejects_missing_goal() {
        let tool = EmitPlanDraftTool;
        let err = tool
            .validate(&json!({
                "intent_summary": "x",
                "unresolved_questions": [],
                "plan_input": {"steps": [{"title":"a"}]}
            }))
            .unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
    }

    #[test]
    fn validate_rejects_empty_steps() {
        let tool = EmitPlanDraftTool;
        let err = tool
            .validate(&json!({
                "intent_summary": "x",
                "unresolved_questions": [],
                "plan_input": {"goal": "g", "steps": []}
            }))
            .unwrap_err();
        assert!(matches!(err, ToolError::InvalidInput(_)));
    }
}
