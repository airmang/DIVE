//! Chat-driven plan interview (post-refactor PR D).
//!
//! This module exposes only the tool definition and system-prompt builder for
//! the chat-driven plan interview. The actual agent loop is the existing
//! `AgentLoop`; it consumes `plan_interview_tool()` plus `build_system_prompt()`
//! so the LLM learns to ask one natural-language question at a time and, once
//! it has enough context, call `emit_plan_draft` with the structured payload
//! the frontend expects. No separate engine or IPC surface is needed — the
//! existing `chat_send` IPC plus the `RunModePermissionHook` stay in charge.

use serde_json::{json, Value};

use crate::providers::ToolDef;

pub const EMIT_PLAN_DRAFT_TOOL_NAME: &str = "emit_plan_draft";

pub fn plan_interview_tool() -> ToolDef {
    ToolDef {
        name: EMIT_PLAN_DRAFT_TOOL_NAME.to_string(),
        description:
            "Emit the structured PlanDraft once you have gathered enough context from the user. \
             Only call this when you have a concrete goal, MVP, steps, and success criteria."
                .to_string(),
        parameters: plan_draft_schema(),
    }
}

pub fn build_system_prompt(locale: &str) -> String {
    let locale = locale.trim();
    let locale = if locale.is_empty() { "ko" } else { locale };
    format!(
        "당신은 DIVE의 계획 인터뷰어입니다. 사용자가 만들고 싶은 것을 설명하면 \
         한 번에 한 가지 질문만 자연어로 물어 필요한 맥락을 모으세요.\n\
         - 질문은 짧고 구체적으로, 사용자 답을 바탕으로 한 턴에 하나씩 진행합니다.\n\
         - 불필요한 선택지 버튼이나 템플릿을 제시하지 마세요. 자연스러운 대화만 합니다.\n\
         - 정보가 충분하다고 판단되면 반드시 `{tool}` 도구를 호출해 PlanDraft를 제출합니다.\n\
         - PlanDraft 필드: goal(한 문장 목표), mvp(가장 작은 유용한 첫 버전), non_goals[], \
         steps[{{name, intent}}], success_criteria[], risks[].\n\
         - 계획 승인 전에는 파일 수정이나 명령 실행을 시도하지 마세요. 읽기와 대화만 가능합니다.\n\
         - 현재 사용자 언어: {locale}. 모든 응답과 PlanDraft의 모든 텍스트는 반드시 그 언어로 작성하세요.",
        tool = EMIT_PLAN_DRAFT_TOOL_NAME
    )
}

fn plan_draft_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "goal": {
                "type": "string",
                "description": "One-sentence statement of what the user wants to build or fix."
            },
            "mvp": {
                "type": "string",
                "description": "The smallest useful first version that proves the core behavior."
            },
            "non_goals": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Explicit exclusions to keep scope small."
            },
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "intent": { "type": "string" }
                    },
                    "required": ["name", "intent"]
                }
            },
            "success_criteria": {
                "type": "array",
                "items": { "type": "string" }
            },
            "risks": {
                "type": "array",
                "items": { "type": "string" }
            }
        },
        "required": ["goal", "mvp", "steps", "success_criteria"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_def_uses_expected_name() {
        let tool = plan_interview_tool();
        assert_eq!(tool.name, EMIT_PLAN_DRAFT_TOOL_NAME);
        assert!(!tool.description.is_empty());
    }

    #[test]
    fn schema_requires_goal_mvp_steps_and_success_criteria() {
        let schema = plan_draft_schema();
        let required = schema["required"]
            .as_array()
            .expect("required array")
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>();
        assert!(required.contains(&"goal"));
        assert!(required.contains(&"mvp"));
        assert!(required.contains(&"steps"));
        assert!(required.contains(&"success_criteria"));
    }

    #[test]
    fn system_prompt_includes_locale_and_tool_name() {
        let prompt = build_system_prompt("en");
        assert!(prompt.contains(EMIT_PLAN_DRAFT_TOOL_NAME));
        assert!(prompt.contains("en"));
    }

    #[test]
    fn system_prompt_defaults_locale_to_ko_when_empty() {
        let prompt = build_system_prompt("   ");
        assert!(prompt.contains("ko"));
    }
}
