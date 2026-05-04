//! Prompt pre-send check (§6.6.3).
//!
//! Requests the model to critique the user's prompt itself before it is
//! sent to the main chat. Returns a list of ambiguity issues plus an
//! optional refined text. Single-tool `tool_choice` ensures the model
//! responds with a structured JSON payload reusable by the dialog UI.

use std::sync::Arc;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::providers::{ChatEvent, ChatRequest, LlmProvider, Message, ToolChoice, ToolDef};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptIssue {
    pub kind: String,
    pub span: Option<[usize; 2]>,
    pub excerpt: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptCheckResult {
    pub issues: Vec<PromptIssue>,
    pub refined_text: String,
    pub approximate_tokens: u32,
}

#[derive(Debug, Error)]
pub enum PromptCheckError {
    #[error("provider error: {0}")]
    Provider(String),
    #[error("model did not emit prompt_review tool call")]
    NoToolCall,
    #[error("prompt_review arguments not valid JSON: {0}")]
    ParseArgs(String),
    #[error("model not configured")]
    NoModel,
    #[error("prompt text is empty")]
    EmptyPrompt,
}

pub struct PromptCheckEngine {
    pub provider: Arc<dyn LlmProvider>,
    pub model: String,
}

impl PromptCheckEngine {
    pub fn new(provider: Arc<dyn LlmProvider>, model: String) -> Self {
        Self { provider, model }
    }

    pub async fn review(
        &self,
        prompt_text: &str,
        stage_hint: Option<&str>,
    ) -> Result<PromptCheckResult, PromptCheckError> {
        if self.model.is_empty() {
            return Err(PromptCheckError::NoModel);
        }
        let trimmed = prompt_text.trim();
        if trimmed.is_empty() {
            return Err(PromptCheckError::EmptyPrompt);
        }

        let tool = ToolDef {
            name: "prompt_review".into(),
            description: "Return ambiguity issues for the user's prompt plus a refined rewrite."
                .into(),
            parameters: review_schema(),
        };

        let stage_line = stage_hint
            .map(|s| format!("현재 DIVE 단계: {s}\n"))
            .unwrap_or_default();
        let req = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                Message::System {
                    content: build_system_prompt(),
                },
                Message::User {
                    content: format!(
                        "{stage_line}사용자 프롬프트:\n```\n{prompt_text}\n```\n\n`prompt_review` 도구로 모호한 부분과 보완 제안을 반환하세요."
                    ),
                },
            ],
            tools: Some(vec![tool]),
            tool_choice: Some(ToolChoice::Specific("prompt_review".into())),
            temperature: Some(0.2),
            max_tokens: Some(512),
            stream: true,
        };

        let mut stream = self
            .provider
            .chat(req)
            .await
            .map_err(|e| PromptCheckError::Provider(e.to_string()))?;
        let mut args = String::new();
        let mut got_call = false;
        let mut usage_tokens: u32 = 0;

        while let Some(evt) = stream.next().await {
            match evt {
                ChatEvent::ToolCallStart { name, .. } if name == "prompt_review" => {
                    got_call = true;
                }
                ChatEvent::ToolCallDelta {
                    arguments_delta, ..
                } if got_call => {
                    args.push_str(&arguments_delta);
                }
                ChatEvent::ToolCallEnd { .. } => {}
                ChatEvent::Usage {
                    prompt_tokens,
                    completion_tokens,
                } => {
                    usage_tokens = prompt_tokens + completion_tokens;
                }
                ChatEvent::Done { .. } => break,
                ChatEvent::Error(e) => return Err(PromptCheckError::Provider(e)),
                _ => {}
            }
        }

        if !got_call || args.is_empty() {
            return Err(PromptCheckError::NoToolCall);
        }

        let parsed: Value =
            serde_json::from_str(&args).map_err(|e| PromptCheckError::ParseArgs(e.to_string()))?;
        let refined = parsed
            .get("refined_text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let issues_raw = parsed
            .get("issues")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let issues = issues_raw
            .into_iter()
            .filter_map(|v| {
                let kind = v.get("kind").and_then(|s| s.as_str())?.to_string();
                let excerpt = v
                    .get("excerpt")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                let suggestion = v
                    .get("suggestion")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                let span = v.get("span").and_then(|s| s.as_array()).and_then(|arr| {
                    if arr.len() == 2 {
                        Some([arr[0].as_u64()? as usize, arr[1].as_u64()? as usize])
                    } else {
                        None
                    }
                });
                Some(PromptIssue {
                    kind,
                    span,
                    excerpt,
                    suggestion,
                })
            })
            .collect();

        Ok(PromptCheckResult {
            issues,
            refined_text: refined,
            approximate_tokens: usage_tokens,
        })
    }
}

fn build_system_prompt() -> String {
    "당신은 DIVE의 '보내기 전 점검' 도우미입니다. 학생/교사가 AI에게 보낼 프롬프트를 \
분석해 모호한 표현을 찾아 보완 제안을 제공합니다.\n\
- 지시 대명사(이거/그거), 주어 생략, 모호한 수량·시점, 대상 누락을 중점적으로 봅니다.\n\
- 각 issue는 excerpt(원문 발췌)와 suggestion(보완)로 구성합니다.\n\
- refined_text는 모호함을 해소한 더 명확한 재작성 버전입니다. 짧게 유지합니다.\n\
- 반드시 `prompt_review` 도구만 호출하세요."
        .to_string()
}

fn review_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "issues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string"},
                        "span": {
                            "type": "array",
                            "items": {"type": "integer"},
                            "minItems": 2,
                            "maxItems": 2,
                        },
                        "excerpt": {"type": "string"},
                        "suggestion": {"type": "string"}
                    },
                    "required": ["kind", "excerpt", "suggestion"]
                }
            },
            "refined_text": {"type": "string"}
        },
        "required": ["issues", "refined_text"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_requires_issues_and_refined_text() {
        let s = review_schema();
        let req = s["required"].as_array().unwrap();
        let req_names: Vec<&str> = req.iter().filter_map(|v| v.as_str()).collect();
        assert!(req_names.contains(&"issues"));
        assert!(req_names.contains(&"refined_text"));
    }
}
