//! Chat-driven plan interview.
//!
//! The existing `chat_send` IPC and `AgentLoop` drive the Socratic interview.
//! This module provides the interview system prompt. The frontend persists
//! Interview rows via workspace-plan IPCs and turns the final assistant JSON
//! into `workspace_plan_generate_draft`.

use serde_json::{json, Value};

use crate::providers::ToolDef;

pub const EMIT_PLAN_DRAFT_TOOL_NAME: &str = "emit_workspace_plan_draft";

pub fn plan_interview_tool() -> ToolDef {
    ToolDef {
        name: EMIT_PLAN_DRAFT_TOOL_NAME.to_string(),
        description: "Emit the submitted interview summary and structured workspace plan draft. \
             Only call this after the user explicitly submits the interview."
            .to_string(),
        parameters: plan_draft_schema(),
    }
}

pub fn build_system_prompt(locale: &str) -> String {
    let locale = locale.trim();
    let locale = if locale.is_empty() { "ko" } else { locale };
    format!(
        "당신은 DIVE의 소크라테스식 계획 인터뷰어입니다. 사용자가 만들고 싶은 것을 설명하면 \
         곧장 코드나 Plan을 만들지 말고 필요한 맥락을 좁히는 질문을 하세요.\n\
         - 한 턴에 1~2개의 짧고 구체적인 질문만 합니다. 닫힌 질문과 열린 질문을 섞습니다.\n\
         - 사용자가 \"그냥 적당히\", \"알아서\", \"대충\"처럼 모호하게 답하면 구체적인 기준, 대상, 범위를 다시 물어봅니다.\n\
         - 사용자가 [INTERVIEW_SUBMIT] 메시지를 보낼 때만 최종 JSON을 반환합니다. 그 전에는 질문만 하세요.\n\
         - 최종 JSON 외에는 마크다운, 설명, 코드블록을 쓰지 마세요.\n\
         - 최종 JSON 필드: intent_summary, unresolved_questions[], plan_input.\n\
         - plan_input 필드: goal, intent_summary, scope[], non_goals[], constraints[], acceptance_criteria[], \
         steps[{{step_id,title,summary,instruction_seed,expected_files[],acceptance_criteria[],verification_type,verification_command,dependencies[],parallel_group}}].\n\
         - Step dependency는 step_id 문자열 배열로만 표현하고, parallel_group은 없으면 null로 둡니다.\n\
         - 계획 승인 전에는 파일 수정이나 명령 실행을 시도하지 마세요. 읽기와 대화만 가능합니다.\n\
         - 현재 사용자 언어: {locale}. 모든 응답과 PlanDraft의 모든 텍스트는 반드시 그 언어로 작성하세요.",
    )
}

fn plan_draft_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "intent_summary": {
                "type": "string",
                "description": "Concise summary of the user's intent from the interview."
            },
            "unresolved_questions": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Important unresolved items that remain before approval."
            },
            "plan_input": {
                "type": "object",
                "properties": {
                    "goal": { "type": "string" },
                    "intent_summary": { "type": "string" },
                    "scope": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "non_goals": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "constraints": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "acceptance_criteria": {
                        "type": "array",
                        "items": { "type": "string" }
                    },
                    "steps": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "step_id": { "type": "string" },
                                "title": { "type": "string" },
                                "summary": { "type": "string" },
                                "instruction_seed": { "type": "string" },
                                "expected_files": {
                                    "type": "array",
                                    "items": { "type": "string" }
                                },
                                "acceptance_criteria": {
                                    "type": "array",
                                    "items": { "type": "string" }
                                },
                                "verification_type": {
                                    "type": ["string", "null"]
                                },
                                "verification_command": {
                                    "type": ["string", "null"]
                                },
                                "dependencies": {
                                    "type": "array",
                                    "items": { "type": "string" }
                                },
                                "parallel_group": {
                                    "type": ["integer", "null"]
                                }
                            },
                            "required": [
                                "step_id",
                                "title",
                                "summary",
                                "instruction_seed",
                                "expected_files",
                                "acceptance_criteria",
                                "dependencies"
                            ]
                        }
                    }
                },
                "required": [
                    "goal",
                    "intent_summary",
                    "scope",
                    "non_goals",
                    "constraints",
                    "acceptance_criteria",
                    "steps"
                ]
            }
        },
        "required": ["intent_summary", "unresolved_questions", "plan_input"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_def_uses_expected_name() {
        let tool = plan_interview_tool();
        assert_eq!(tool.name, "emit_workspace_plan_draft");
        assert!(!tool.description.is_empty());
    }

    #[test]
    fn schema_requires_summary_unresolved_and_plan_input() {
        let schema = plan_draft_schema();
        let required = schema["required"]
            .as_array()
            .expect("required array")
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>();
        assert!(required.contains(&"intent_summary"));
        assert!(required.contains(&"unresolved_questions"));
        assert!(required.contains(&"plan_input"));

        let plan_required = schema["properties"]["plan_input"]["required"]
            .as_array()
            .expect("plan_input required array")
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>();
        assert!(plan_required.contains(&"goal"));
        assert!(plan_required.contains(&"scope"));
        assert!(plan_required.contains(&"non_goals"));
        assert!(plan_required.contains(&"constraints"));
        assert!(plan_required.contains(&"acceptance_criteria"));
        assert!(plan_required.contains(&"steps"));
    }

    #[test]
    fn system_prompt_defines_socratic_interview_rules() {
        let prompt = build_system_prompt("en");
        assert!(prompt.contains("en"));
        assert!(prompt.contains("1~2"));
        assert!(prompt.contains("그냥 적당히"));
        assert!(prompt.contains("INTERVIEW_SUBMIT"));
        assert!(prompt.contains("최종 JSON"));
    }

    #[test]
    fn system_prompt_defaults_locale_to_ko_when_empty() {
        let prompt = build_system_prompt("   ");
        assert!(prompt.contains("ko"));
    }
}
