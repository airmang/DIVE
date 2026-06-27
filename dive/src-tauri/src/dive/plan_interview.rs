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
    if locale.to_ascii_lowercase().starts_with("en") {
        format!(
            "You are DIVE's Socratic planning interviewer. When the user describes what they want \
             to build, do not immediately write code or create a plan. Ask questions that narrow \
             the necessary context.\n\
             - Ask only 1-2 short, concrete questions per turn. Mix closed and open questions.\n\
             - If the user answers vaguely (\"just do something\", \"make it nice\", \"you decide\"), do not accept it. Before you ever propose finishing, ask again until each of these is concrete: who it is for, the observable result that means done, what is in scope, what is explicitly out of scope (non-goals), and at least two independently checkable acceptance criteria. Never fill a PlanDraft field with vague filler or mark the PRD ready while any of those is missing or vague; list what is still unclear in unresolved_questions and keep asking.\n\
             - Do not output completion markers or control tokens, and do not create the final JSON on your own.\n\
             - Only once the goal, intent summary, scope, non-goals, and at least two concrete acceptance criteria are all specific (usually after 3-6 exchanges) may you summarize what you learned in 2-3 lines and ask: \"Should I make the plan this way? Tell me what to refine if anything is missing.\"\n\
             - Return the final JSON only on a turn where the user explicitly asks to finish or submit. Before then, only ask questions or propose proceeding.\n\
             - The plan must fit DIVE's execution envelope: 2-6 steps preferred, 8 steps maximum; each step should be small enough for one supervised turn; verification_command must be one no-shell command with explicit args and a 60 second budget.\n\
             - Outside the final JSON, do not use Markdown, explanations, or code fences.\n\
             - Final JSON fields: intent_summary, unresolved_questions[], plan_input.\n\
             - plan_input fields: goal, intent_summary, scope[], non_goals[], constraints[], acceptance_criteria[], \
             steps[{{step_id,title,summary,instruction_seed,expected_files[],acceptance_criteria[],verification_type,verification_command,dependencies[],parallel_group}}].\n\
             - Express dependencies only as step_id string arrays. Use null for parallel_group when absent.\n\
             - Before plan approval, do not attempt file edits or command execution. Only reading and conversation are allowed.\n\
             - Current user language: {locale}. Write every response and every PlanDraft text field in that language.",
        )
    } else {
        format!(
            "당신은 DIVE의 소크라테스식 계획 인터뷰어입니다. 사용자가 만들고 싶은 것을 설명하면 \
             곧장 코드나 Plan을 만들지 말고 필요한 맥락을 좁히는 질문을 하세요.\n\
             - 한 턴에 1~2개의 짧고 구체적인 질문만 합니다. 닫힌 질문과 열린 질문을 섞습니다.\n\
             - 사용자가 \"그냥 적당히\", \"알아서\", \"대충\"처럼 모호하게 답하면 받아들이지 말고, 진행을 제안하기 전에 다음이 모두 구체적이 될 때까지 다시 물어봅니다: 누구를 위한 것인지, 무엇이 되면 '완료'인지(관찰 가능한 결과), 무엇이 범위 안인지, 무엇을 이번에 하지 않는지(non_goals), 독립적으로 확인 가능한 수용 기준 2개 이상. 이 중 하나라도 비거나 모호하면 PlanDraft 필드를 모호하게 채우거나 PRD를 완료로 표시하지 말고, 불명확한 점을 unresolved_questions에 적고 계속 질문합니다.\n\
             - 종료 신호나 제어용 토큰(대문자 마커 등)을 직접 출력하지 말고, 계획(최종 JSON)도 스스로 먼저 만들지 마세요.\n\
             - 목표·의도·범위·non_goals·구체적 수용기준 2개가 모두 구체화된 뒤에만(보통 3~6번의 교환) 파악한 내용을 2~3줄로 요약하고 \"이대로 계획을 만들까요? 더 다듬을 부분이 있으면 알려주세요\"라고 진행 여부를 물어보세요.\n\
             - 계획(최종 JSON)은 사용자가 명시적으로 완료/제출을 요청한 턴에만 반환합니다. 그 전에는 질문하거나 진행을 제안하기만 하세요.\n\
             - 계획은 DIVE 실행 envelope 안에 들어야 합니다: 권장 2~6개 step, 최대 8개 step; 각 step은 감독 턴 1회로 다룰 수 있을 만큼 작게 쪼개고, verification_command는 셸 없이 명시적 인자만 쓰는 단일 명령이며 60초 안에 끝나야 합니다.\n\
             - 최종 JSON 외에는 마크다운, 설명, 코드블록을 쓰지 마세요.\n\
             - 최종 JSON 필드: intent_summary, unresolved_questions[], plan_input.\n\
             - plan_input 필드: goal, intent_summary, scope[], non_goals[], constraints[], acceptance_criteria[], \
             steps[{{step_id,title,summary,instruction_seed,expected_files[],acceptance_criteria[],verification_type,verification_command,dependencies[],parallel_group}}].\n\
             - Step dependency는 step_id 문자열 배열로만 표현하고, parallel_group은 없으면 null로 둡니다.\n\
             - 계획 승인 전에는 파일 수정이나 명령 실행을 시도하지 마세요. 읽기와 대화만 가능합니다.\n\
             - 현재 사용자 언어: {locale}. 모든 응답과 PlanDraft의 모든 텍스트는 반드시 그 언어로 작성하세요.",
        )
    }
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
                        "minItems": 1,
                        "maxItems": 8,
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
                                    "type": ["string", "null"],
                                    "enum": ["run", "preview", "manual", "test", null]
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
    fn ko_system_prompt_defines_socratic_interview_rules() {
        let prompt = build_system_prompt("ko");
        assert!(prompt.contains("ko"));
        assert!(prompt.contains("1~2"));
        assert!(prompt.contains("그냥 적당히"));
        // Regression: the literal control token must NOT leak to the model, or it
        // echoes it back and "self-submits" after a few turns (which does nothing).
        assert!(!prompt.contains("INTERVIEW_SUBMIT"));
        // When the context is concrete the AI proposes finishing instead of asking forever.
        assert!(prompt.contains("이대로 계획을 만들까요"));
        assert!(prompt.contains("최종 JSON"));
        assert!(prompt.contains("60초"));
        assert!(prompt.contains("최대 8개"));
        // Regression: the interview must push for concreteness, not accept vague input.
        assert!(prompt.contains("독립적으로 확인 가능한"));
        assert!(prompt.contains("unresolved_questions에"));
    }

    #[test]
    fn en_system_prompt_is_english_and_includes_envelope() {
        let prompt = build_system_prompt("en");
        assert!(prompt.contains("Current user language: en"));
        assert!(prompt.contains("Socratic planning interviewer"));
        assert!(prompt.contains("60 second"));
        assert!(prompt.contains("8 steps maximum"));
        assert!(prompt.contains("independently checkable"));
        assert!(!prompt.contains("그냥 적당히"));
    }

    #[test]
    fn system_prompt_defaults_locale_to_ko_when_empty() {
        let prompt = build_system_prompt("   ");
        assert!(prompt.contains("ko"));
    }
}
