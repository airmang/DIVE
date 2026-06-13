//! V-stage AI self-verification. Spec §4.4.
//!
//! `VerifyEngine` drives one verify pass per card:
//!   1. Build a prompt from the card's instruction + any known changed files.
//!   2. Ask the provider to emit a structured `verify_result` tool call
//!      (Anthropic `tool_use` / OpenAI `tool_choice: specific`).
//!   3. Parse the tool arguments into `VerifyLog`.
//!   4. If the card has an optional `test_command`, run it through the
//!      sandboxed `run_process` tool and fold exit/stdout/stderr into the log.
//!   5. Persist the log into `Card.verify_log` (spec §10.3).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::db::dao::card as card_dao;
use crate::db::models::NewCard;
use crate::db::{now_ms, Database};
use crate::providers::{
    ChatEvent, ChatRequest, FinishReason, LlmProvider, Message, ToolChoice, ToolDef,
};
use crate::tools::{Tool, ToolContext};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TestResult {
    Pass,
    Fail,
    Skipped,
}

/// Spec §10.3 `Card.verify_log` schema. Serialized as JSON into a TEXT
/// column so the migration cost is zero; readers parse lazily.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerifyLog {
    pub intent_match: bool,
    pub test_result: TestResult,
    pub details: String,
    pub model: String,
    pub ran_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_stdout: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_stderr: Option<String>,
}

impl VerifyLog {
    pub fn from_json_str(s: &str) -> Result<Self, VerifyError> {
        serde_json::from_str(s).map_err(|e| VerifyError::ParseLog(e.to_string()))
    }

    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self).expect("VerifyLog -> JSON")
    }

    /// Spec §4.4 — final Approve is gated on `intent_match==true` AND the
    /// test run not reporting a hard fail. Used by `card_transition::Approve`.
    pub fn approve_eligible(&self) -> bool {
        self.intent_match && self.test_result != TestResult::Fail
    }
}

#[derive(Debug, Error)]
pub enum VerifyError {
    #[error("card {0} not found")]
    CardNotFound(i64),
    #[error("card {0} is not in Verifying state (actual: {1})")]
    NotVerifying(i64, String),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("model did not emit verify_result tool call")]
    NoToolCall,
    #[error("verify_result tool arguments not valid JSON: {0}")]
    ParseLog(String),
    #[error("db: {0}")]
    Db(String),
    #[error("no provider model configured")]
    NoModel,
    #[error("test command error: {0}")]
    TestCommand(String),
}

pub struct VerifyEngine {
    pub provider: Arc<dyn LlmProvider>,
    pub db: Arc<Mutex<Database>>,
    pub model: String,
    pub project_root: Option<PathBuf>,
}

impl VerifyEngine {
    pub fn new(provider: Arc<dyn LlmProvider>, db: Arc<Mutex<Database>>, model: String) -> Self {
        Self {
            provider,
            db,
            model,
            project_root: None,
        }
    }

    pub fn with_project_root(mut self, project_root: impl Into<PathBuf>) -> Self {
        self.project_root = Some(project_root.into());
        self
    }

    pub async fn verify_card(
        &self,
        _session_id: i64,
        card_id: i64,
    ) -> Result<VerifyLog, VerifyError> {
        if self.model.is_empty() {
            return Err(VerifyError::NoModel);
        }

        let card = {
            let db = self.db.lock().map_err(|e| VerifyError::Db(e.to_string()))?;
            card_dao::get_by_id(db.conn(), card_id)
                .map_err(|e| VerifyError::Db(e.to_string()))?
                .ok_or(VerifyError::CardNotFound(card_id))?
        };

        if !matches!(card.state, crate::db::models::CardState::Verifying) {
            return Err(VerifyError::NotVerifying(
                card_id,
                format!("{:?}", card.state),
            ));
        }

        let instruction = card.instruction.clone().unwrap_or_default();
        let changed_files_json: Value = card.changed_files.clone().unwrap_or(Value::Null);

        let system = build_system_prompt();
        let user = build_user_prompt(&card.title, &instruction, &changed_files_json);

        let tool = ToolDef {
            name: "verify_result".into(),
            description: "Report intent-code alignment and test status for this card.".into(),
            parameters: verify_result_schema(),
        };

        let req = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                Message::System { content: system },
                Message::User { content: user },
            ],
            tools: Some(vec![tool]),
            tool_choice: Some(ToolChoice::Specific("verify_result".into())),
            temperature: Some(0.0),
            max_tokens: Some(1024),
            stream: true,
        };

        let mut stream = self
            .provider
            .chat(req)
            .await
            .map_err(|e| VerifyError::Provider(e.to_string()))?;

        let mut current_args = String::new();
        let mut got_tool_call = false;
        let mut finish: Option<FinishReason> = None;

        while let Some(evt) = stream.next().await {
            match evt {
                ChatEvent::ToolCallStart { name, .. } if name == "verify_result" => {
                    got_tool_call = true;
                }
                ChatEvent::ToolCallDelta {
                    arguments_delta, ..
                } if got_tool_call => {
                    current_args.push_str(&arguments_delta);
                }
                ChatEvent::ToolCallEnd { .. } => {}
                ChatEvent::Done { finish_reason } => {
                    finish = Some(finish_reason);
                    break;
                }
                ChatEvent::Error(e) => return Err(VerifyError::Provider(e)),
                _ => {}
            }
        }

        let _ = finish;
        if !got_tool_call || current_args.is_empty() {
            return Err(VerifyError::NoToolCall);
        }

        let parsed: Value = serde_json::from_str(&current_args)
            .map_err(|e| VerifyError::ParseLog(e.to_string()))?;

        let intent_match = parsed
            .get("intent_match")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let mut test_result = match parsed
            .get("test_result")
            .and_then(|v| v.as_str())
            .unwrap_or("skipped")
        {
            "pass" => TestResult::Pass,
            "fail" => TestResult::Fail,
            _ => TestResult::Skipped,
        };
        let mut details = parsed
            .get("details")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mut test_exit_code = None;
        let mut test_stdout = None;
        let mut test_stderr = None;
        let test_command = card
            .test_command
            .as_deref()
            .map(str::trim)
            .filter(|cmd| !cmd.is_empty())
            .map(str::to_owned);

        if let Some(command_text) = test_command.as_deref() {
            let executed = self.run_test_command(card.session_id, command_text).await?;
            test_result = if executed.success {
                TestResult::Pass
            } else {
                TestResult::Fail
            };
            test_exit_code = Some(executed.exit_code);
            test_stdout = Some(executed.stdout);
            test_stderr = Some(executed.stderr);
            details = if details.is_empty() {
                format!("검증 명령 `{command_text}` 실행 결과: {test_result:?}")
            } else {
                format!("{details}\n\n검증 명령 `{command_text}` 실행 결과: {test_result:?}")
            };
        }

        let log = VerifyLog {
            intent_match,
            test_result,
            details,
            model: self.model.clone(),
            ran_at: now_ms(),
            test_command,
            test_exit_code,
            test_stdout,
            test_stderr,
        };

        let db = self.db.lock().map_err(|e| VerifyError::Db(e.to_string()))?;
        card_dao::update(
            db.conn(),
            card_id,
            &NewCard {
                session_id: card.session_id,
                title: card.title.clone(),
                instruction: card.instruction.clone(),
                assist_summary: card.assist_summary.clone(),
                acceptance_criteria: card.acceptance_criteria.clone(),
                retrospective: card.retrospective.clone(),
                change_summary: card.change_summary.clone(),
                state: card.state,
                verify_log: Some(log.to_json_string()),
                changed_files: card.changed_files.clone(),
                test_command: card.test_command.clone(),
                approval_judgment: card.approval_judgment.clone(),
                approval_provenance: card.approval_provenance.clone(),
                position: card.position,
            },
        )
        .map_err(|e| VerifyError::Db(e.to_string()))?;

        Ok(log)
    }

    async fn run_test_command(
        &self,
        session_id: i64,
        command_text: &str,
    ) -> Result<TestExecution, VerifyError> {
        let project_root = self
            .project_root
            .clone()
            .ok_or_else(|| VerifyError::TestCommand("project root required".into()))?;
        let (command, args) = split_test_command(command_text)?;
        let ctx = ToolContext::new(project_root, session_id);
        let output = crate::tools::run_process::RunProcess
            .run(
                json!({
                    "command": command,
                    "args": args,
                    "timeout_sec": 60,
                }),
                &ctx,
            )
            .await
            .map_err(|e| VerifyError::TestCommand(e.to_string()))?;
        Ok(TestExecution {
            success: output.success,
            exit_code: output.full["exit_code"].as_i64().unwrap_or(-1) as i32,
            stdout: output.full["stdout"].as_str().unwrap_or("").to_owned(),
            stderr: output.full["stderr"].as_str().unwrap_or("").to_owned(),
        })
    }
}

struct TestExecution {
    success: bool,
    exit_code: i32,
    stdout: String,
    stderr: String,
}

fn split_test_command(command_text: &str) -> Result<(String, Vec<String>), VerifyError> {
    let parts: Vec<String> = command_text.split_whitespace().map(str::to_owned).collect();
    let Some((command, args)) = parts.split_first() else {
        return Err(VerifyError::TestCommand("empty command".into()));
    };
    Ok((command.clone(), args.to_vec()))
}

fn build_system_prompt() -> String {
    "당신은 DIVE V 단계의 자체 검증자입니다. 학생이 작성한 카드의 지시문과 그 카드에 \
연결된 변경 파일 목록을 받고, 아래 구조화된 도구(`verify_result`)로 판정을 돌려줍니다.\n\n\
판정 기준:\n\
- intent_match: 변경이 지시문의 핵심 의도를 충족하면 true.\n\
- test_result: 외부 테스트 실행이 제공되지 않았으면 'skipped'. (3-2에서는 항상 skipped 또는 AI가 정적으로 확신 가능한 pass/fail)\n\
- details: 판정 근거를 한국어 2~4문장으로.\n\n\
반드시 `verify_result` 도구만 호출하고, 다른 텍스트나 도구를 사용하지 마세요."
        .to_string()
}

fn build_user_prompt(title: &str, instruction: &str, changed_files: &Value) -> String {
    let files_summary = match changed_files {
        Value::Array(arr) if !arr.is_empty() => {
            let names: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            if names.is_empty() {
                changed_files.to_string()
            } else {
                names.join(", ")
            }
        }
        _ => "(변경 파일 정보 없음)".to_string(),
    };
    format!(
        "카드 제목: {title}\n\n지시:\n{}\n\n변경된 파일:\n{files_summary}\n\n위 정보를 바탕으로 `verify_result`를 호출하세요.",
        if instruction.is_empty() {
            "(지시 없음)"
        } else {
            instruction
        }
    )
}

fn verify_result_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "intent_match": {
                "type": "boolean",
                "description": "Whether the code changes satisfy the card's instruction."
            },
            "test_result": {
                "type": "string",
                "enum": ["pass", "fail", "skipped"],
                "description": "Test execution outcome. Use 'skipped' if no tests were run."
            },
            "details": {
                "type": "string",
                "description": "Korean explanation of the verdict (2-4 sentences)."
            }
        },
        "required": ["intent_match", "test_result", "details"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_log_approve_eligible() {
        let ok = VerifyLog {
            intent_match: true,
            test_result: TestResult::Pass,
            details: "ok".into(),
            model: "m".into(),
            ran_at: 0,
            test_command: None,
            test_exit_code: None,
            test_stdout: None,
            test_stderr: None,
        };
        assert!(ok.approve_eligible());

        let no_match = VerifyLog {
            intent_match: false,
            ..ok.clone()
        };
        assert!(!no_match.approve_eligible());

        let failed = VerifyLog {
            test_result: TestResult::Fail,
            ..ok.clone()
        };
        assert!(!failed.approve_eligible());

        let skipped_but_match = VerifyLog {
            test_result: TestResult::Skipped,
            ..ok
        };
        assert!(skipped_but_match.approve_eligible());
    }

    #[test]
    fn verify_log_roundtrip_json() {
        let log = VerifyLog {
            intent_match: true,
            test_result: TestResult::Skipped,
            details: "의도대로 구현됨".into(),
            model: "claude-3-5-sonnet".into(),
            ran_at: 1234,
            test_command: None,
            test_exit_code: None,
            test_stdout: None,
            test_stderr: None,
        };
        let json = log.to_json_string();
        let back = VerifyLog::from_json_str(&json).unwrap();
        assert_eq!(log, back);
    }

    #[test]
    fn verify_result_schema_has_required_fields() {
        let schema = verify_result_schema();
        let required = schema["required"].as_array().unwrap();
        let names: Vec<&str> = required.iter().filter_map(|v| v.as_str()).collect();
        assert!(names.contains(&"intent_match"));
        assert!(names.contains(&"test_result"));
        assert!(names.contains(&"details"));
    }
}
