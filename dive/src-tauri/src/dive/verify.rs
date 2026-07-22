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

use super::prompt_locale::prompt_locale_is_english;

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

    /// True when DIVE has evidence that a configured test command actually ran.
    pub fn has_executed_test_command(&self) -> bool {
        self.test_command
            .as_deref()
            .is_some_and(|command| !command.trim().is_empty())
            && self.test_exit_code.is_some()
    }

    pub fn automated_pass_evidence(&self) -> bool {
        self.test_result == TestResult::Pass && self.has_executed_test_command()
    }

    pub fn automated_fail_evidence(&self) -> bool {
        self.test_result == TestResult::Fail && self.has_executed_test_command()
    }

    /// Direct Approve is allowed only from concrete automated pass evidence.
    /// AI static pass/fail and skipped results remain weak self-report signals.
    pub fn approve_eligible(&self) -> bool {
        self.intent_match && self.automated_pass_evidence()
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
        locale: &str,
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

        let system = build_system_prompt(locale);
        let user = build_user_prompt(&card.title, &instruction, &changed_files_json, locale);

        let tool = ToolDef {
            name: "verify_result".into(),
            description: "Report intent-code alignment and test status for this card.".into(),
            parameters: verify_result_schema(locale),
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
            details = append_test_command_summary(&details, command_text, &test_result, locale);
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

/// Localized word for a `TestResult`, for embedding in human-facing summary text.
fn test_result_word(result: &TestResult, locale: &str) -> &'static str {
    let english = prompt_locale_is_english(locale);
    match (result, english) {
        (TestResult::Pass, true) => "pass",
        (TestResult::Pass, false) => "성공",
        (TestResult::Fail, true) => "fail",
        (TestResult::Fail, false) => "실패",
        (TestResult::Skipped, true) => "skipped",
        (TestResult::Skipped, false) => "건너뜀",
    }
}

/// Appends the executed test-command summary sentence to `details` in the
/// caller's locale, rather than a hardcoded-Korean sentence with an English
/// Debug-formatted result.
fn append_test_command_summary(
    details: &str,
    command_text: &str,
    test_result: &TestResult,
    locale: &str,
) -> String {
    let result_word = test_result_word(test_result, locale);
    let sentence = if prompt_locale_is_english(locale) {
        format!("Test command `{command_text}` result: {result_word}")
    } else {
        format!("검증 명령 `{command_text}` 실행 결과: {result_word}")
    };
    if details.is_empty() {
        sentence
    } else {
        format!("{details}\n\n{sentence}")
    }
}

fn build_system_prompt(locale: &str) -> String {
    if prompt_locale_is_english(locale) {
        "You are DIVE's V-stage self-verifier. You receive the instruction for a student-authored card \
and the list of changed files linked to that card, then return a verdict using the structured tool (`verify_result`).\n\n\
Verdict criteria:\n\
- intent_match: true when the changes satisfy the core intent of the instruction.\n\
- test_result: if no external test execution is provided, it must be 'skipped'. Do not report pass from static inference alone.\n\
- details: explain the verdict in English in 2-4 sentences.\n\n\
Call only the `verify_result` tool, with no other text or tools."
            .to_string()
    } else {
        "당신은 DIVE V 단계의 자체 검증자입니다. 학생이 작성한 카드의 지시문과 그 카드에 \
연결된 변경 파일 목록을 받고, 아래 구조화된 도구(`verify_result`)로 판정을 돌려줍니다.\n\n\
판정 기준:\n\
- intent_match: 변경이 지시문의 핵심 의도를 충족하면 true.\n\
- test_result: 외부 테스트 실행이 제공되지 않았으면 반드시 'skipped'. 정적 추론만으로 pass를 보고하지 마세요.\n\
- details: 판정 근거를 한국어로 2~4문장 작성하세요.\n\n\
반드시 `verify_result` 도구만 호출하고, 다른 텍스트나 도구를 사용하지 마세요."
            .to_string()
    }
}

fn build_user_prompt(
    title: &str,
    instruction: &str,
    changed_files: &Value,
    locale: &str,
) -> String {
    let english = prompt_locale_is_english(locale);
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
        _ if english => "(no changed file information)".to_string(),
        _ => "(변경 파일 정보 없음)".to_string(),
    };
    let instruction_summary = if instruction.is_empty() {
        if english {
            "(no instruction)"
        } else {
            "(지시 없음)"
        }
    } else {
        instruction
    };
    if english {
        return format!(
            "Card title: {title}\n\nInstruction:\n{instruction_summary}\n\nChanged files:\n{files_summary}\n\nUse the information above to call `verify_result`."
        );
    }
    format!(
        "카드 제목: {title}\n\n지시:\n{}\n\n변경된 파일:\n{files_summary}\n\n위 정보를 바탕으로 `verify_result`를 호출하세요.",
        instruction_summary
    )
}

fn verify_result_schema(locale: &str) -> Value {
    let details_description = if prompt_locale_is_english(locale) {
        "English explanation of the verdict (2-4 sentences)."
    } else {
        "Korean explanation of the verdict (2-4 sentences)."
    };
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
                "description": details_description
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
            test_command: Some("pnpm test".into()),
            test_exit_code: Some(0),
            test_stdout: None,
            test_stderr: None,
        };
        assert!(ok.approve_eligible());
        assert!(ok.automated_pass_evidence());

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

        let static_pass = VerifyLog {
            test_command: None,
            test_exit_code: None,
            ..ok.clone()
        };
        assert!(!static_pass.approve_eligible());
        assert!(!static_pass.automated_pass_evidence());

        let command_without_exit = VerifyLog {
            test_exit_code: None,
            ..ok.clone()
        };
        assert!(!command_without_exit.approve_eligible());
        assert!(!command_without_exit.automated_pass_evidence());

        let skipped_but_match = VerifyLog {
            test_result: TestResult::Skipped,
            ..ok
        };
        assert!(!skipped_but_match.approve_eligible());
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
        let schema = verify_result_schema("");
        let required = schema["required"].as_array().unwrap();
        let names: Vec<&str> = required.iter().filter_map(|v| v.as_str()).collect();
        assert!(names.contains(&"intent_match"));
        assert!(names.contains(&"test_result"));
        assert!(names.contains(&"details"));
    }

    #[test]
    fn build_system_prompt_uses_english_output_clause_for_en_locale() {
        let prompt = build_system_prompt("en");
        assert!(prompt.contains("explain the verdict in English in 2-4 sentences"));
        assert!(!prompt.contains("한국어"));
    }

    #[test]
    fn build_system_prompt_uses_korean_output_clause_by_default() {
        let prompt = build_system_prompt("");
        assert!(prompt.contains("한국어로 2~4문장"));
        assert!(!prompt.contains("in English"));
    }

    #[test]
    fn build_user_prompt_uses_english_labels_for_en_locale() {
        let prompt = build_user_prompt("Title", "", &Value::Null, "en-US");
        assert!(prompt.contains("Card title: Title"));
        assert!(prompt.contains("Instruction:\n(no instruction)"));
        assert!(prompt.contains("Changed files:\n(no changed file information)"));
        assert!(!prompt.contains("카드 제목"));
        assert!(!prompt.contains("(지시 없음)"));
        assert!(!prompt.contains("(변경 파일 정보 없음)"));
    }

    #[test]
    fn build_user_prompt_uses_korean_labels_by_default() {
        let prompt = build_user_prompt("Title", "", &Value::Null, "");
        assert!(prompt.contains("카드 제목: Title"));
        assert!(prompt.contains("지시:\n(지시 없음)"));
        assert!(prompt.contains("변경된 파일:\n(변경 파일 정보 없음)"));
        assert!(!prompt.contains("Card title"));
        assert!(!prompt.contains("no changed file information"));
    }

    #[test]
    fn append_test_command_summary_uses_english_for_en_locale() {
        let out = append_test_command_summary("", "pnpm test", &TestResult::Pass, "en");
        assert_eq!(out, "Test command `pnpm test` result: pass");
        assert!(!out.contains("검증 명령"));
        assert!(!out.contains("Pass")); // no Debug-formatted variant leaking through
    }

    #[test]
    fn append_test_command_summary_uses_korean_by_default() {
        let out = append_test_command_summary("", "pnpm test", &TestResult::Fail, "");
        assert_eq!(out, "검증 명령 `pnpm test` 실행 결과: 실패");
        assert!(!out.contains("Test command"));
        assert!(!out.contains("Fail"));
    }

    #[test]
    fn append_test_command_summary_appends_after_existing_details() {
        let out = append_test_command_summary("intent ok", "cargo test", &TestResult::Pass, "en");
        assert_eq!(out, "intent ok\n\nTest command `cargo test` result: pass");
    }
}
