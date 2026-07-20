//! AI Assist for card decomposition. Spec §4.1 / §5.2.2 / §6.1.
//!
//! The `AiAssistDialog` in the frontend asks the model to decompose a
//! user-supplied feature description into a small list of actionable cards.
//! We reuse the same structured-output pattern as `VerifyEngine`
//! (single-tool `tool_choice`) so the model's response is already typed.

use std::sync::Arc;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::providers::{ChatEvent, ChatRequest, LlmProvider, Message, ToolChoice, ToolDef};

use super::prompt_locale::prompt_locale_is_english;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssistedCard {
    pub title: String,
    pub summary: String,
    pub rationale: Option<String>,
    pub priority: Option<String>,
    pub estimated_steps: Option<u32>,
}

#[derive(Debug, Error)]
pub enum AssistError {
    #[error("provider error: {0}")]
    Provider(String),
    #[error("model did not emit assist_cards tool call")]
    NoToolCall,
    #[error("assist_cards tool arguments not valid JSON: {0}")]
    ParseArgs(String),
    #[error("no provider model configured")]
    NoModel,
}

pub struct AiAssistEngine {
    pub provider: Arc<dyn LlmProvider>,
    pub model: String,
}

impl AiAssistEngine {
    pub fn new(provider: Arc<dyn LlmProvider>, model: String) -> Self {
        Self { provider, model }
    }

    pub async fn suggest_cards(
        &self,
        description: &str,
        locale: &str,
    ) -> Result<Vec<AssistedCard>, AssistError> {
        if self.model.is_empty() {
            return Err(AssistError::NoModel);
        }

        let tool = ToolDef {
            name: "assist_cards".into(),
            description: "Return 3-6 small, actionable work cards that decompose the feature."
                .into(),
            parameters: assist_schema(),
        };

        let req = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                Message::System {
                    content: build_system_prompt(locale),
                },
                Message::User {
                    content: build_user_prompt(description, locale),
                },
            ],
            tools: Some(vec![tool]),
            tool_choice: Some(ToolChoice::Specific("assist_cards".into())),
            temperature: Some(0.4),
            max_tokens: Some(1024),
        };

        let mut stream = self
            .provider
            .chat(req)
            .await
            .map_err(|e| AssistError::Provider(e.to_string()))?;
        let mut args = String::new();
        let mut got_call = false;

        while let Some(evt) = stream.next().await {
            match evt {
                ChatEvent::ToolCallStart { name, .. } if name == "assist_cards" => {
                    got_call = true;
                }
                ChatEvent::ToolCallDelta {
                    arguments_delta, ..
                } if got_call => {
                    args.push_str(&arguments_delta);
                }
                ChatEvent::ToolCallEnd { .. } => {}
                ChatEvent::Done { .. } => break,
                ChatEvent::Error(e) => return Err(AssistError::Provider(e)),
                _ => {}
            }
        }

        if !got_call || args.is_empty() {
            return Err(AssistError::NoToolCall);
        }

        let parsed: Value =
            serde_json::from_str(&args).map_err(|e| AssistError::ParseArgs(e.to_string()))?;
        let arr = parsed
            .get("cards")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let cards = arr
            .into_iter()
            .filter_map(|v| {
                let title = v.get("title")?.as_str()?.to_string();
                let summary = v
                    .get("summary")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                let rationale = v
                    .get("rationale")
                    .and_then(|s| s.as_str())
                    .map(str::to_string);
                let priority = v
                    .get("priority")
                    .and_then(|s| s.as_str())
                    .map(str::to_string);
                let estimated_steps = v
                    .get("estimated_steps")
                    .and_then(|n| n.as_u64())
                    .and_then(|n| u32::try_from(n).ok());
                Some(AssistedCard {
                    title,
                    summary,
                    rationale,
                    priority,
                    estimated_steps,
                })
            })
            .collect();
        Ok(cards)
    }
}

fn build_system_prompt(locale: &str) -> String {
    if prompt_locale_is_english(locale) {
        "You are DIVE's D-stage assistant. Decompose the feature the user wants to build \
into 3-6 small cards. Each card must include:\n\
- an English title, 20 characters or fewer\n\
- a one-sentence English summary, 80 characters or fewer\n\
- one sentence explaining why this card is needed as the rationale\n\
- one priority: must, should, or nice\n\
- the estimated number of implementation steps for a novice\n\
Call only the `assist_cards` tool."
            .to_string()
    } else {
        "당신은 DIVE의 D 단계 도우미입니다. 사용자가 만들고 싶다고 설명한 기능을 \
3~6개의 작은 카드로 분해합니다. 각 카드는:\n\
- 한국어로 20자 이내의 제목\n\
- 한국어로 한 문장의 요약(80자 이내)\n\
- 왜 이 카드가 필요한지 한 문장 rationale\n\
- 우선순위 must/should/nice 중 하나\n\
- 초심자 기준 예상 구현 단계 수\n\
반드시 `assist_cards` 도구만 호출하세요."
            .to_string()
    }
}

fn build_user_prompt(description: &str, locale: &str) -> String {
    if prompt_locale_is_english(locale) {
        format!(
            "Feature the user wants to build:\n{description}\n\nUse the `assist_cards` tool to suggest 3-6 small cards."
        )
    } else {
        format!(
            "만들고 싶은 기능:\n{description}\n\n`assist_cards` 도구로 3~6개의 작은 카드를 제안하세요."
        )
    }
}

fn assist_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "cards": {
                "type": "array",
                "minItems": 3,
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "properties": {
                        "title": { "type": "string" },
                        "summary": { "type": "string" },
                        "rationale": { "type": "string" },
                        "priority": { "type": "string", "enum": ["must", "should", "nice"] },
                        "estimated_steps": { "type": "integer", "minimum": 1, "maximum": 12 }
                    },
                    "required": ["title", "summary", "rationale", "priority", "estimated_steps"]
                }
            }
        },
        "required": ["cards"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_has_cards_array() {
        let s = assist_schema();
        assert!(s["properties"]["cards"]["type"] == "array");
        assert!(s["properties"]["cards"]["minItems"].as_u64() == Some(3));
        assert!(s["properties"]["cards"]["maxItems"].as_u64() == Some(6));
    }

    #[test]
    fn build_system_prompt_branches_by_locale() {
        let english = build_system_prompt("en");
        assert!(english.contains("an English title, 20 characters or fewer"));
        assert!(english.contains("one-sentence English summary"));
        assert!(!english.contains("한국어"));

        let korean = build_system_prompt("");
        assert!(korean.contains("한국어로 20자 이내의 제목"));
        assert!(korean.contains("한국어로 한 문장의 요약"));
        assert!(!korean.contains("English title"));
    }
}
