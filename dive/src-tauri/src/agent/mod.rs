//! Agent Loop — spec §8.2.
//!
//! `AgentLoop::run` drives a single user turn: records the user message,
//! streams the assistant reply, intercepts tool calls through the
//! `PermissionHook`, executes approved tools via `ToolRegistry`, and loops
//! until the model stops requesting tools. Each transition emits an
//! `AgentEvent` for the UI and persists durable state to SQLite.

pub mod error;
pub mod event;
pub mod permission;

pub use error::AgentError;
pub use event::{AgentEvent, DiffPreview};
pub use permission::{
    AgentRunMode, AlwaysApproveHook, AlwaysDenyHook, AutoApprove, AutoApprovePolicy, AwaitUserHook,
    PendingApprovalSnapshot, PendingApprovals, PermissionApprovalWarnings, PermissionDecision,
    PermissionHook, PermissionRequestContext, PolicyAwareHook, PolicyHook, RunModePermissionHook,
    SafeOnlyHook, WholeFileOverwriteWarning,
};

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::dao::{card, message, workmap};
use crate::db::models::{NewMessage, StepKind};
use crate::db::Database;
use crate::dive::event_log as dive_event_log;
use crate::dive::{build_plan_interview_system_prompt, prompt_locale_is_english};
use crate::providers::{
    ChatEvent, ChatRequest, FinishReason, LlmProvider, Message as ProviderMessage, ToolCall,
};
use crate::tools::multi_replace;
use crate::tools::runtime::{
    classify_preview_open_command, RuntimeInputKind, RuntimeRoutingDecision, RuntimeRoutingOutcome,
};
use crate::tools::{
    assess_file_write_secrets, params_preview, BlockReason, RiskLevel, ToolContext, ToolError,
    ToolRegistry,
};

const DEFAULT_MAX_ITERATIONS: u32 = 10;
const PROJECT_COMMAND_DEFAULT_TIMEOUT_SEC: u64 = 30;

#[derive(Debug, Clone, Default)]
struct DiffPreviewBundle {
    diff_preview: Option<DiffPreview>,
    diff_previews: Vec<DiffPreview>,
}

fn changed_paths_from_tool_result(tool_name: &str, full: &Value) -> Vec<String> {
    match tool_name {
        "write_file" | "edit_file" | "delete_file" | "mkdir" => full
            .get("path")
            .and_then(Value::as_str)
            .map(|path| vec![path.to_owned()])
            .unwrap_or_default(),
        "multi_replace" => full
            .get("changed_files")
            .and_then(Value::as_array)
            .map(|files| {
                files
                    .iter()
                    .filter_map(|file| file.get("path").and_then(Value::as_str).map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn tool_result_content_for_model(tool_name: &str, full: &Value) -> String {
    if tool_name != "web_fetch" {
        return full.to_string();
    }
    let mut sanitized = full.clone();
    if let Value::Object(map) = &mut sanitized {
        // audit L2: never surface the fired guard rule or the internal
        // resolved IP to the model/tool channel (mapping-oracle). The human
        // card/EventLog keep these; the LLM sees only a generic result.
        map.remove("errorClass");
        map.remove("resolvedIp");
    }
    sanitized.to_string()
}

fn diff_line_count(text: &str) -> usize {
    if text.is_empty() {
        0
    } else {
        text.lines().count().max(1)
    }
}

fn write_content_for_secret_assessment(tool_name: &str, args: &Value) -> Option<String> {
    match tool_name {
        "write_file" => args
            .get("content")
            .and_then(Value::as_str)
            .map(str::to_owned),
        "edit_file" => args
            .get("replace")
            .and_then(Value::as_str)
            .map(str::to_owned),
        _ => None,
    }
}

fn approval_warnings_for_tool(
    tool_name: &str,
    args: &Value,
    diff_preview: Option<&DiffPreview>,
    diff_previews: &[DiffPreview],
) -> PermissionApprovalWarnings {
    if !matches!(tool_name, "write_file" | "edit_file" | "multi_replace") {
        return PermissionApprovalWarnings::default();
    }

    let path = args
        .get("path")
        .and_then(Value::as_str)
        .or_else(|| diff_preview.map(|diff| diff.path.as_str()))
        .unwrap_or("");
    let mut warnings = PermissionApprovalWarnings::default();

    if tool_name == "multi_replace" {
        for diff in diff_previews {
            merge_secret_warning(&mut warnings, &diff.path, &diff.after);
        }
    } else if let Some(content) = write_content_for_secret_assessment(tool_name, args) {
        merge_secret_warning(&mut warnings, path, &content);
    }

    if tool_name == "write_file" {
        if let Some(diff) = diff_preview.filter(|diff| !diff.before.is_empty()) {
            warnings.whole_file_overwrite = Some(WholeFileOverwriteWarning {
                lines_removed: diff_line_count(&diff.before),
            });
        }
    }

    warnings
}

fn merge_secret_warning(warnings: &mut PermissionApprovalWarnings, path: &str, content: &str) {
    let secret = assess_file_write_secrets(path, content);
    if !secret.flagged {
        return;
    }
    warnings.secret_flagged = true;
    for reason in secret.reasons {
        if !warnings
            .secret_reasons
            .iter()
            .any(|existing| existing == &reason)
        {
            warnings.secret_reasons.push(reason);
        }
    }
}

fn approval_risk(base: RiskLevel, warnings: &PermissionApprovalWarnings) -> RiskLevel {
    if matches!(base, RiskLevel::Warn)
        && (warnings.secret_flagged || warnings.whole_file_overwrite.is_some())
    {
        RiskLevel::Danger
    } else {
        base
    }
}

#[derive(Debug, Clone)]
pub struct StepContext {
    pub step_id: i64,
    pub title: String,
    pub instruction_seed: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub linked_criterion_ids: Vec<String>,
    pub decomposition_rationale: Option<String>,
    pub expected_files: Option<String>,
    pub step_kind: StepKind,
}

pub struct AgentLoop {
    pub provider: Arc<dyn LlmProvider>,
    pub registry: Arc<ToolRegistry>,
    pub permission: Arc<dyn PermissionHook>,
    pub db: Arc<Mutex<Database>>,
    pub tool_ctx: ToolContext,
    pub max_iterations: u32,
    pub cancel: Arc<AtomicBool>,
    pub model: String,
    pub run_mode: AgentRunMode,
    pub plan_accepted: bool,
    pub locale: Option<String>,
    pub step_context: Option<StepContext>,
    web_fetch_session_grants: Arc<Mutex<HashSet<String>>>,
}

pub struct AgentOutcome {
    pub events: Vec<AgentEvent>,
    pub final_reason: String,
}

pub struct ExternalTurnContext {
    pub messages: Vec<ProviderMessage>,
    pub current_card_id: Option<i64>,
}

pub struct SupervisedToolResult {
    pub content: String,
    pub success: bool,
    pub summary: String,
    pub full: Value,
}

impl AgentLoop {
    pub fn builder() -> AgentLoopBuilder {
        AgentLoopBuilder::default()
    }

    pub async fn run(
        &self,
        session_id: i64,
        user_input: &str,
        emit: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<String, AgentError> {
        let user_msg_id = Uuid::new_v4().to_string();
        let created_at = crate::db::now_ms();
        let current_card_id = self.current_card_id(session_id)?;
        self.persist_user_message(session_id, current_card_id, user_input)?;
        emit_and_forward(
            emit,
            AgentEvent::UserMessage {
                id: user_msg_id,
                content: user_input.to_string(),
                created_at,
            },
        );
        self.log_event(
            session_id,
            "stage_enter",
            json!({ "run_mode": self.run_mode.as_str(), "card_id": current_card_id }),
        )?;
        let mut user_payload = dive_event_log::user_text_metadata(user_input);
        if let Value::Object(map) = &mut user_payload {
            map.insert("run_mode".into(), json!(self.run_mode.as_str()));
            map.insert("card_id".into(), json!(current_card_id));
        }
        self.log_event(session_id, "user_message", user_payload)?;

        let mut messages = self.load_history(session_id)?;
        if let Some(prompt) = self.current_card_system_prompt(session_id)? {
            messages.insert(0, ProviderMessage::System { content: prompt });
        }
        if let Some(locale_hint) = self.locale_system_prompt() {
            messages.insert(
                0,
                ProviderMessage::System {
                    content: locale_hint,
                },
            );
        }
        if let Some(interview_prompt) = self.plan_interview_system_prompt() {
            messages.insert(
                0,
                ProviderMessage::System {
                    content: interview_prompt,
                },
            );
        }
        if let Some(last) = messages.last() {
            if !matches!(last, ProviderMessage::User { .. }) {
                messages.push(ProviderMessage::User {
                    content: user_input.to_string(),
                });
            }
        } else {
            messages.push(ProviderMessage::User {
                content: user_input.to_string(),
            });
        }

        let tool_defs = self.tool_defs_for_current_mode();
        let mut last_tool_signature: Option<String> = None;
        let mut repeated_tool_turns = 0_u32;

        for iter in 0..self.max_iterations {
            self.check_cancel()?;

            let request = ChatRequest {
                model: self.model.clone(),
                messages: messages.clone(),
                tools: if tool_defs.is_empty() {
                    None
                } else {
                    Some(tool_defs.clone())
                },
                tool_choice: None,
                temperature: Some(0.7),
                max_tokens: Some(4096),
                stream: true,
            };

            let assistant_id = Uuid::new_v4().to_string();
            emit(AgentEvent::AssistantStart {
                id: assistant_id.clone(),
                created_at: crate::db::now_ms(),
            });

            let (content, reasoning_content, tool_calls, finish_reason) =
                match self.stream_assistant(&assistant_id, request, emit).await {
                    Ok(result) => result,
                    Err(err) => {
                        self.log_event(
                            session_id,
                            "error_occurred",
                            dive_event_log::error_payload("provider", &err.to_string()),
                        )?;
                        return Err(err);
                    }
                };

            let reasoning_content = if tool_calls.is_empty() {
                None
            } else {
                reasoning_content
            };
            self.persist_assistant_message(
                session_id,
                current_card_id,
                &content,
                reasoning_content.as_deref(),
                &tool_calls,
            )?;
            emit(AgentEvent::AssistantEnd {
                id: assistant_id,
                content: content.clone(),
                finish_reason: finish_reason_str(finish_reason).to_owned(),
            });
            self.log_event(
                session_id,
                "assistant_end",
                json!({ "finish_reason": finish_reason_str(finish_reason) }),
            )?;

            if !content.is_empty() || !tool_calls.is_empty() {
                messages.push(ProviderMessage::Assistant {
                    content: content.clone(),
                    reasoning_content: reasoning_content.clone(),
                    tool_calls: if tool_calls.is_empty() {
                        None
                    } else {
                        Some(tool_calls.clone())
                    },
                });
            }

            if tool_calls.is_empty() {
                self.log_event(
                    session_id,
                    "stage_exit",
                    json!({
                        "run_mode": self.run_mode.as_str(),
                        "reason": finish_reason_str(finish_reason),
                    }),
                )?;
                return Ok(format!("stopped:{}", finish_reason_str(finish_reason)));
            }

            let tool_signature = tool_calls
                .iter()
                .map(|tc| format!("{}:{}", tc.name, tc.arguments))
                .collect::<Vec<_>>()
                .join("\n");
            if last_tool_signature.as_deref() == Some(tool_signature.as_str()) {
                repeated_tool_turns += 1;
            } else {
                repeated_tool_turns = 0;
                last_tool_signature = Some(tool_signature);
            }
            if repeated_tool_turns >= 2 {
                let reason = "repeated_tool_calls";
                emit(AgentEvent::Done {
                    reason: reason.into(),
                });
                self.log_event(
                    session_id,
                    "stage_exit",
                    json!({
                        "run_mode": self.run_mode.as_str(),
                        "reason": reason,
                    }),
                )?;
                self.log_event(
                    session_id,
                    "error_occurred",
                    dive_event_log::error_payload(
                        "agent_loop",
                        "step stalled: repeated tool calls without a final response",
                    ),
                )?;
                return Err(AgentError::Internal(
                    "step stalled: repeated tool calls without a final response".into(),
                ));
            }

            for tc in &tool_calls {
                self.check_cancel()?;
                let (base_risk, tool_opt) = match self.registry.get(&tc.name) {
                    Some(t) => (t.risk_level(), Some(t)),
                    None => (RiskLevel::Warn, None),
                };
                let mut args_value: Value = serde_json::from_str(&tc.arguments)
                    .map_err(AgentError::ArgumentJson)
                    .unwrap_or_else(|e| {
                        let msg = format!("tool arguments not JSON: {e}");
                        emit(AgentEvent::Error {
                            message: msg,
                            retryable: false,
                        });
                        Value::Object(Default::default())
                    });
                let web_fetch_prepare_error = if tc.name == "web_fetch" {
                    match crate::tools::web_fetch::prepare_approval_args(&args_value).await {
                        Ok((prepared, _approval)) => {
                            args_value = prepared;
                            None
                        }
                        Err(err) => Some(err),
                    }
                } else {
                    None
                };
                let preview = params_preview(&tc.name, &args_value);
                let diff_preview_bundle = self.build_diff_preview(&tc.name, &args_value).await;
                let approval_warnings = approval_warnings_for_tool(
                    &tc.name,
                    &args_value,
                    diff_preview_bundle.diff_preview.as_ref(),
                    &diff_preview_bundle.diff_previews,
                );
                let risk = approval_risk(base_risk, &approval_warnings);
                let reasoning_text = reasoning_summary(&tc.name, &preview);
                emit(AgentEvent::Reasoning {
                    id: Uuid::new_v4().to_string(),
                    text: reasoning_text.clone(),
                    tool_call_id: tc.id.clone(),
                    created_at: crate::db::now_ms(),
                });
                self.log_event(
                    session_id,
                    "reasoning",
                    json!({ "tool": tc.name, "tool_call_id": tc.id, "text": reasoning_text }),
                )?;
                emit(AgentEvent::ToolCallStart {
                    id: tc.id.clone(),
                    tool: tc.name.clone(),
                    params_preview: preview.clone(),
                    risk,
                    diff_preview: diff_preview_bundle.diff_preview.clone(),
                    diff_previews: diff_preview_bundle.diff_previews.clone(),
                    approval_warnings: approval_warnings.clone(),
                    args: args_value.clone(),
                });
                let mut start_payload =
                    json!({ "tool": tc.name, "params_preview": preview, "risk": risk.as_str() });
                if !approval_warnings.is_empty() {
                    start_payload["approvalWarnings"] =
                        serde_json::to_value(&approval_warnings).unwrap_or(Value::Null);
                }
                self.log_event(session_id, "tool_call_start", start_payload)?;

                let Some(tool) = tool_opt else {
                    let msg = format!("tool '{}' not registered", tc.name);
                    emit(AgentEvent::ToolResult {
                        call_id: tc.id.clone(),
                        success: false,
                        summary: msg.clone(),
                        full: json!({ "error": msg.clone() }),
                    });
                    messages.push(ProviderMessage::Tool {
                        content: msg,
                        tool_call_id: tc.id.clone(),
                    });
                    continue;
                };

                if let Some(err) = web_fetch_prepare_error {
                    let egress_reason = match &err {
                        ToolError::EgressBlocked(reason) => Some(reason.clone()),
                        _ => None,
                    };
                    let (reason, msg) = tool_validation_block(err);
                    emit(AgentEvent::ToolCallBlocked {
                        id: tc.id.clone(),
                        reason: reason.clone(),
                    });
                    self.log_event(
                        session_id,
                        "tool_call_blocked",
                        json!({
                            "tool": tc.name,
                            "rule": reason.rule,
                            "pattern": reason.pattern,
                        }),
                    )?;
                    if let Some(reason) = egress_reason {
                        self.record_web_fetch_blocked(session_id, &tc.id, &args_value, &reason)?;
                    }
                    let full = json!({
                        "runtimeAction": "web_fetch",
                        "status": "blocked",
                        "success": false,
                        "summary": msg.clone(),
                        "error": msg.clone(),
                        "isEvidence": false,
                    });
                    emit(AgentEvent::ToolResult {
                        call_id: tc.id.clone(),
                        success: false,
                        summary: msg.clone(),
                        full: full.clone(),
                    });
                    self.record_web_fetch_result(
                        session_id,
                        &tc.id,
                        "blocked",
                        false,
                        &msg,
                        Some(&full),
                    )?;
                    messages.push(ProviderMessage::Tool {
                        content: msg,
                        tool_call_id: tc.id.clone(),
                    });
                    continue;
                }

                if let Err(err) = tool.validate(&args_value) {
                    let egress_reason = match &err {
                        ToolError::EgressBlocked(reason) => Some(reason.clone()),
                        _ => None,
                    };
                    let (reason, msg) = tool_validation_block(err);
                    emit(AgentEvent::ToolCallBlocked {
                        id: tc.id.clone(),
                        reason: reason.clone(),
                    });
                    self.log_event(
                        session_id,
                        "tool_call_blocked",
                        json!({
                            "tool": tc.name,
                            "rule": reason.rule,
                            "pattern": reason.pattern,
                        }),
                    )?;
                    if tc.name == "run_process" {
                        let evidence = self.record_project_command_result(
                            session_id,
                            &tc.id,
                            &args_value,
                            "blocked",
                            false,
                            &msg,
                            None,
                        )?;
                        emit(evidence.to_event());
                    }
                    if tc.name == "run_terminal_script" {
                        let evidence = self.record_terminal_script_result(
                            session_id, &tc.id, "blocked", false, &msg, None,
                        )?;
                        emit(evidence.to_event());
                    }
                    if let Some(reason) = egress_reason {
                        self.record_web_fetch_blocked(session_id, &tc.id, &args_value, &reason)?;
                    }
                    if tc.name == "web_fetch" {
                        let full = json!({
                            "runtimeAction": "web_fetch",
                            "status": "blocked",
                            "success": false,
                            "summary": msg.clone(),
                            "error": msg.clone(),
                            "isEvidence": false,
                        });
                        self.record_web_fetch_result(
                            session_id,
                            &tc.id,
                            "blocked",
                            false,
                            &msg,
                            Some(&full),
                        )?;
                    }
                    messages.push(ProviderMessage::Tool {
                        content: msg,
                        tool_call_id: tc.id.clone(),
                    });
                    continue;
                }

                if tc.name == "run_terminal_script" {
                    self.record_terminal_script_approval_requested(
                        session_id,
                        &tc.id,
                        &args_value,
                    )?;
                }
                let reused_web_fetch_grant =
                    tc.name == "web_fetch" && self.web_fetch_session_grant_allows(&args_value);
                if tc.name == "web_fetch" && !reused_web_fetch_grant {
                    self.record_web_fetch_approval_requested(session_id, &tc.id, &args_value)?;
                }

                let decision = if reused_web_fetch_grant {
                    PermissionDecision::approved_with_metadata(Some(json!({
                        "source": "web_fetch_session_reuse",
                    })))
                } else {
                    self.permission
                        .intercept(
                            tc,
                            risk,
                            PermissionRequestContext {
                                session_id,
                                params_preview: preview.clone(),
                                diff_preview: diff_preview_bundle.diff_preview.clone(),
                                diff_previews: diff_preview_bundle.diff_previews.clone(),
                                approval_warnings: approval_warnings.clone(),
                                args: args_value.clone(),
                            },
                        )
                        .await
                };
                match decision {
                    PermissionDecision::Approved {
                        modified_args,
                        approval_metadata,
                    } => {
                        emit(AgentEvent::ToolCallApproved { id: tc.id.clone() });
                        let effective_args = modified_args.unwrap_or(args_value);
                        let effective_args_for_event = effective_args.clone();
                        if tc.name == "web_fetch"
                            && effective_args
                                .get("reuse_for_session")
                                .and_then(Value::as_bool)
                                .unwrap_or(false)
                        {
                            self.remember_web_fetch_session_grant(&effective_args);
                        }
                        self.log_event(
                            session_id,
                            "tool_approve",
                            tool_approve_payload(
                                &tc.name,
                                &tc.id,
                                risk,
                                None,
                                approval_metadata.as_ref(),
                            ),
                        )?;
                        if let Some(payload) = provocation_continue_with_risk_payload(
                            &tc.name,
                            &tc.id,
                            risk,
                            None,
                            approval_metadata.as_ref(),
                        ) {
                            self.log_event(session_id, "provocation.continued_with_risk", payload)?;
                        }
                        tracing::info!(
                            session_id,
                            tool = %tc.name,
                            risk = risk.as_str(),
                            "tool execution started"
                        );
                        let out = match tool.run(effective_args, &self.tool_ctx).await {
                            Ok(out) => out,
                            Err(e) => {
                                let msg = format!("{e}");
                                let full = if tc.name == "run_process" {
                                    json!({ "runtimeAction": "project_command", "error": msg.clone() })
                                } else if tc.name == "run_terminal_script" {
                                    json!({ "runtimeAction": "terminal_script", "error": msg.clone() })
                                } else if tc.name == "web_fetch" {
                                    json!({ "runtimeAction": "web_fetch", "status": "failed", "error": msg.clone(), "isEvidence": false })
                                } else {
                                    json!({ "error": msg.clone() })
                                };
                                tracing::warn!(
                                    session_id,
                                    tool = %tc.name,
                                    error = %crate::telemetry::redact_log_text(&msg),
                                    "tool execution failed"
                                );
                                emit(AgentEvent::ToolResult {
                                    call_id: tc.id.clone(),
                                    success: false,
                                    summary: msg.clone(),
                                    full: full.clone(),
                                });
                                if tc.name == "run_process" {
                                    let evidence = self.record_project_command_result(
                                        session_id,
                                        &tc.id,
                                        &effective_args_for_event,
                                        "failed",
                                        false,
                                        &msg,
                                        Some(&full),
                                    )?;
                                    emit(evidence.to_event());
                                }
                                if tc.name == "run_terminal_script" {
                                    let evidence = self.record_terminal_script_result(
                                        session_id,
                                        &tc.id,
                                        "failed",
                                        false,
                                        &msg,
                                        Some(&full),
                                    )?;
                                    emit(evidence.to_event());
                                }
                                if tc.name == "web_fetch" {
                                    self.record_web_fetch_result(
                                        session_id,
                                        &tc.id,
                                        "failed",
                                        false,
                                        &msg,
                                        Some(&full),
                                    )?;
                                }
                                self.log_event(
                                    session_id,
                                    "tool_error",
                                    json!({ "tool": tc.name, "error": msg.clone() }),
                                )?;
                                self.log_event(
                                    session_id,
                                    "error_occurred",
                                    dive_event_log::error_payload("tool", &msg),
                                )?;
                                messages.push(ProviderMessage::Tool {
                                    content: msg,
                                    tool_call_id: tc.id.clone(),
                                });
                                continue;
                            }
                        };
                        emit(AgentEvent::ToolResult {
                            call_id: tc.id.clone(),
                            success: out.success,
                            summary: out.summary.clone(),
                            full: out.full.clone(),
                        });
                        if tc.name == "run_process" {
                            let evidence = self.record_project_command_result(
                                session_id,
                                &tc.id,
                                &effective_args_for_event,
                                "completed",
                                out.success,
                                &out.summary,
                                Some(&out.full),
                            )?;
                            emit(evidence.to_event());
                        }
                        if tc.name == "run_terminal_script" {
                            let evidence = self.record_terminal_script_result(
                                session_id,
                                &tc.id,
                                "completed",
                                out.success,
                                &out.summary,
                                Some(&out.full),
                            )?;
                            emit(evidence.to_event());
                        }
                        if tc.name == "web_fetch" {
                            let status = out
                                .full
                                .get("status")
                                .and_then(Value::as_str)
                                .unwrap_or(if out.success { "completed" } else { "failed" });
                            self.record_web_fetch_result(
                                session_id,
                                &tc.id,
                                status,
                                out.success,
                                &out.summary,
                                Some(&out.full),
                            )?;
                        }
                        tracing::info!(
                            session_id,
                            tool = %tc.name,
                            success = out.success,
                            "tool execution completed"
                        );
                        self.record_changed_files(
                            session_id,
                            &tc.name,
                            &out.full,
                            diff_preview_bundle.diff_preview.as_ref(),
                            &diff_preview_bundle.diff_previews,
                        )?;
                        self.log_event(
                            session_id,
                            "tool_result",
                            json!({
                                "tool": tc.name,
                                "success": out.success,
                                "summary": out.summary.clone(),
                            }),
                        )?;
                        self.log_event(
                            session_id,
                            "tool_complete",
                            json!({
                                "tool": tc.name,
                                "success": out.success,
                                "summary": out.summary.clone(),
                            }),
                        )?;
                        let tool_content = tool_result_content_for_model(&tc.name, &out.full);
                        messages.push(ProviderMessage::Tool {
                            content: tool_content,
                            tool_call_id: tc.id.clone(),
                        });
                    }
                    PermissionDecision::Denied(reason) => {
                        emit(AgentEvent::ToolCallDenied {
                            id: tc.id.clone(),
                            reason: reason.clone(),
                        });
                        if tc.name == "run_process" {
                            let content = format!("user denied tool call: {reason}");
                            let evidence = self.record_project_command_result(
                                session_id,
                                &tc.id,
                                &args_value,
                                "denied",
                                false,
                                &content,
                                None,
                            )?;
                            emit(evidence.to_event());
                        }
                        if tc.name == "run_terminal_script" {
                            let content = format!("user denied terminal script: {reason}");
                            let evidence = self.record_terminal_script_result(
                                session_id, &tc.id, "denied", false, &content, None,
                            )?;
                            emit(evidence.to_event());
                        }
                        if tc.name == "web_fetch" {
                            let content = format!("user denied web fetch: {reason}");
                            let full = json!({
                                "runtimeAction": "web_fetch",
                                "status": "denied",
                                "success": false,
                                "summary": content,
                                "isEvidence": false,
                            });
                            self.record_web_fetch_result(
                                session_id,
                                &tc.id,
                                "denied",
                                false,
                                &content,
                                Some(&full),
                            )?;
                        }
                        self.log_event(
                            session_id,
                            "tool_call_denied",
                            json!({ "tool": tc.name, "reason": reason.clone() }),
                        )?;
                        self.log_event(
                            session_id,
                            "tool_reject",
                            json!({ "tool": tc.name, "reason": reason.clone() }),
                        )?;
                        messages.push(ProviderMessage::Tool {
                            content: format!("user denied tool call: {reason}"),
                            tool_call_id: tc.id.clone(),
                        });
                    }
                }
            }

            if iter + 1 == self.max_iterations {
                emit(AgentEvent::Done {
                    reason: "max_iterations".into(),
                });
                self.log_event(
                    session_id,
                    "error_occurred",
                    dive_event_log::error_payload("agent_loop", "max_iterations"),
                )?;
                return Err(AgentError::MaxIterations(self.max_iterations));
            }
        }

        emit(AgentEvent::Done {
            reason: "max_iterations".into(),
        });
        self.log_event(
            session_id,
            "error_occurred",
            dive_event_log::error_payload("agent_loop", "max_iterations"),
        )?;
        Err(AgentError::MaxIterations(self.max_iterations))
    }

    async fn stream_assistant(
        &self,
        assistant_id: &str,
        request: ChatRequest,
        emit: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<(String, Option<String>, Vec<ToolCall>, FinishReason), AgentError> {
        let provider = self.provider.clone();
        let mut stream = tokio::select! {
            result = crate::providers::with_retry(
                || {
                    let provider = provider.clone();
                    let req = request.clone();
                    async move { provider.chat(req).await }
                },
                3,
                std::time::Duration::from_millis(500),
            ) => result?,
            _ = self.wait_for_cancel() => return Err(AgentError::Cancelled),
        };
        let mut content = String::new();
        let mut reasoning_content = String::new();
        let mut pending_tool_calls: Vec<PendingToolCall> = Vec::new();
        let mut finish_reason = FinishReason::Stop;

        loop {
            self.check_cancel()?;
            let event = tokio::select! {
                event = stream.next() => event,
                _ = self.wait_for_cancel() => return Err(AgentError::Cancelled),
            };
            let Some(event) = event else {
                break;
            };
            match event {
                ChatEvent::ReasoningDelta(delta) => {
                    reasoning_content.push_str(&delta);
                }
                ChatEvent::TextDelta(delta) => {
                    content.push_str(&delta);
                    emit(AgentEvent::AssistantDelta {
                        id: assistant_id.to_string(),
                        delta,
                    });
                }
                ChatEvent::ToolCallStart { id, name } => {
                    pending_tool_calls.push(PendingToolCall {
                        id,
                        name,
                        arguments: String::new(),
                    });
                }
                ChatEvent::ToolCallDelta {
                    id,
                    arguments_delta,
                } => {
                    if let Some(ptc) = pending_tool_calls.iter_mut().find(|p| p.id == id) {
                        ptc.arguments.push_str(&arguments_delta);
                    }
                }
                ChatEvent::ToolCallEnd { .. } => {}
                ChatEvent::Usage { .. } => {}
                ChatEvent::Done { finish_reason: fr } => {
                    finish_reason = fr;
                }
                ChatEvent::Error(msg) => {
                    emit(AgentEvent::Error {
                        message: msg.clone(),
                        retryable: true,
                    });
                    return Err(AgentError::Internal(msg));
                }
            }
        }

        let tool_calls = pending_tool_calls
            .into_iter()
            .map(|p| ToolCall {
                id: p.id,
                name: p.name,
                arguments: if p.arguments.is_empty() {
                    "{}".into()
                } else {
                    p.arguments
                },
            })
            .collect();

        let reasoning_content = if reasoning_content.is_empty() {
            None
        } else {
            Some(reasoning_content)
        };

        Ok((content, reasoning_content, tool_calls, finish_reason))
    }

    pub async fn begin_external_turn(
        &self,
        session_id: i64,
        user_input: &str,
        emit: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<ExternalTurnContext, AgentError> {
        let user_msg_id = Uuid::new_v4().to_string();
        let created_at = crate::db::now_ms();
        let current_card_id = self.current_card_id(session_id)?;
        self.persist_user_message(session_id, current_card_id, user_input)?;
        emit_and_forward(
            emit,
            AgentEvent::UserMessage {
                id: user_msg_id,
                content: user_input.to_string(),
                created_at,
            },
        );
        self.log_event(
            session_id,
            "stage_enter",
            json!({ "run_mode": self.run_mode.as_str(), "card_id": current_card_id, "runtime": "pi_sidecar" }),
        )?;
        let mut user_payload = dive_event_log::user_text_metadata(user_input);
        if let Value::Object(map) = &mut user_payload {
            map.insert("run_mode".into(), json!(self.run_mode.as_str()));
            map.insert("card_id".into(), json!(current_card_id));
            map.insert("runtime".into(), json!("pi_sidecar"));
        }
        self.log_event(session_id, "user_message", user_payload)?;

        let mut messages = self.load_history(session_id)?;
        if let Some(prompt) = self.current_card_system_prompt(session_id)? {
            messages.insert(0, ProviderMessage::System { content: prompt });
        }
        if let Some(locale_hint) = self.locale_system_prompt() {
            messages.insert(
                0,
                ProviderMessage::System {
                    content: locale_hint,
                },
            );
        }
        if let Some(interview_prompt) = self.plan_interview_system_prompt() {
            messages.insert(
                0,
                ProviderMessage::System {
                    content: interview_prompt,
                },
            );
        }
        if let Some(last) = messages.last() {
            if !matches!(last, ProviderMessage::User { .. }) {
                messages.push(ProviderMessage::User {
                    content: user_input.to_string(),
                });
            }
        } else {
            messages.push(ProviderMessage::User {
                content: user_input.to_string(),
            });
        }

        Ok(ExternalTurnContext {
            messages,
            current_card_id,
        })
    }

    pub fn tool_defs_for_external_turn(&self) -> Vec<crate::providers::ToolDef> {
        self.tool_defs_for_current_mode()
    }

    fn tool_defs_for_current_mode(&self) -> Vec<crate::providers::ToolDef> {
        if self.run_mode == AgentRunMode::Interview {
            Vec::new()
        } else {
            self.registry
                .tool_defs_filtered(self.run_mode == AgentRunMode::Build)
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn finish_external_turn(
        &self,
        session_id: i64,
        assistant_id: String,
        current_card_id: Option<i64>,
        content: String,
        reasoning_content: Option<String>,
        tool_calls: &[ToolCall],
        finish_reason: FinishReason,
        emit: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<(), AgentError> {
        let reasoning_content = if tool_calls.is_empty() {
            None
        } else {
            reasoning_content
        };
        self.persist_assistant_message(
            session_id,
            current_card_id,
            &content,
            reasoning_content.as_deref(),
            tool_calls,
        )?;
        emit(AgentEvent::AssistantEnd {
            id: assistant_id,
            content,
            finish_reason: finish_reason_str(finish_reason).to_owned(),
        });
        self.log_event(
            session_id,
            "assistant_end",
            json!({
                "finish_reason": finish_reason_str(finish_reason),
                "runtime": "pi_sidecar",
            }),
        )?;
        self.log_event(
            session_id,
            "stage_exit",
            json!({
                "run_mode": self.run_mode.as_str(),
                "reason": finish_reason_str(finish_reason),
                "runtime": "pi_sidecar",
            }),
        )?;
        Ok(())
    }

    pub async fn execute_supervised_tool_call(
        &self,
        session_id: i64,
        tc: &ToolCall,
        emit: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<SupervisedToolResult, AgentError> {
        self.check_cancel()?;
        let (base_risk, tool_opt) = match self.registry.get(&tc.name) {
            Some(t) => (t.risk_level(), Some(t)),
            None => (RiskLevel::Warn, None),
        };
        let mut args_value: Value = serde_json::from_str(&tc.arguments)
            .map_err(AgentError::ArgumentJson)
            .unwrap_or_else(|e| {
                let msg = format!("tool arguments not JSON: {e}");
                emit(AgentEvent::Error {
                    message: msg,
                    retryable: false,
                });
                Value::Object(Default::default())
            });
        let web_fetch_prepare_error = if tc.name == "web_fetch" {
            match crate::tools::web_fetch::prepare_approval_args(&args_value).await {
                Ok((prepared, _approval)) => {
                    args_value = prepared;
                    None
                }
                Err(err) => Some(err),
            }
        } else {
            None
        };
        let preview = params_preview(&tc.name, &args_value);
        let diff_preview_bundle = self.build_diff_preview(&tc.name, &args_value).await;
        let approval_warnings = approval_warnings_for_tool(
            &tc.name,
            &args_value,
            diff_preview_bundle.diff_preview.as_ref(),
            &diff_preview_bundle.diff_previews,
        );
        let risk = approval_risk(base_risk, &approval_warnings);
        let reasoning_text = reasoning_summary(&tc.name, &preview);
        emit(AgentEvent::Reasoning {
            id: Uuid::new_v4().to_string(),
            text: reasoning_text.clone(),
            tool_call_id: tc.id.clone(),
            created_at: crate::db::now_ms(),
        });
        self.log_event(
            session_id,
            "reasoning",
            json!({ "tool": tc.name, "tool_call_id": tc.id, "text": reasoning_text }),
        )?;
        emit(AgentEvent::ToolCallStart {
            id: tc.id.clone(),
            tool: tc.name.clone(),
            params_preview: preview.clone(),
            risk,
            diff_preview: diff_preview_bundle.diff_preview.clone(),
            diff_previews: diff_preview_bundle.diff_previews.clone(),
            approval_warnings: approval_warnings.clone(),
            args: args_value.clone(),
        });
        let mut start_payload = json!({
            "tool": tc.name,
            "params_preview": preview,
            "risk": risk.as_str(),
            "runtime": "pi_sidecar"
        });
        if !approval_warnings.is_empty() {
            start_payload["approvalWarnings"] =
                serde_json::to_value(&approval_warnings).unwrap_or(Value::Null);
        }
        self.log_event(session_id, "tool_call_start", start_payload)?;

        let Some(tool) = tool_opt else {
            let msg = format!("tool '{}' not registered", tc.name);
            let full = json!({ "error": msg.clone() });
            emit(AgentEvent::ToolResult {
                call_id: tc.id.clone(),
                success: false,
                summary: msg.clone(),
                full: full.clone(),
            });
            return Ok(SupervisedToolResult {
                content: msg.clone(),
                success: false,
                summary: msg,
                full,
            });
        };

        if let Some(err) = web_fetch_prepare_error {
            let egress_reason = match &err {
                ToolError::EgressBlocked(reason) => Some(reason.clone()),
                _ => None,
            };
            let (reason, msg) = tool_validation_block(err);
            emit(AgentEvent::ToolCallBlocked {
                id: tc.id.clone(),
                reason: reason.clone(),
            });
            self.log_event(
                session_id,
                "tool_call_blocked",
                json!({
                    "tool": tc.name,
                    "rule": reason.rule,
                    "pattern": reason.pattern,
                    "runtime": "pi_sidecar",
                }),
            )?;
            if let Some(reason) = egress_reason {
                self.record_web_fetch_blocked(session_id, &tc.id, &args_value, &reason)?;
            }
            let full = json!({
                "runtimeAction": "web_fetch",
                "status": "blocked",
                "success": false,
                "summary": msg.clone(),
                "error": msg.clone(),
                "isEvidence": false,
            });
            emit(AgentEvent::ToolResult {
                call_id: tc.id.clone(),
                success: false,
                summary: msg.clone(),
                full: full.clone(),
            });
            self.record_web_fetch_result(session_id, &tc.id, "blocked", false, &msg, Some(&full))?;
            return Ok(SupervisedToolResult {
                content: msg.clone(),
                success: false,
                summary: msg,
                full,
            });
        }

        if tc.name == "run_process" {
            if let Some(classification) =
                classify_preview_open_command(&args_value, &self.tool_ctx.project_root)
            {
                let outcome = classification.outcome;
                let summary = classification.message.clone();
                let target = classification.target.clone();
                let decision = self.record_runtime_routing_decision(
                    session_id,
                    Some(&tc.id),
                    RuntimeInputKind::ProjectCommand,
                    outcome,
                    classification.reason_code,
                    vec![json!({
                        "tool": tc.name,
                        "command": args_value.get("command").cloned().unwrap_or(Value::Null),
                        "args": args_value.get("args").cloned().unwrap_or(Value::Null),
                        "previewKind": classification.kind,
                        "previewTarget": target.clone(),
                        "commandRan": false,
                    })],
                    &summary,
                )?;
                emit(runtime_routing_decision_event(
                    &decision,
                    Some(tc.id.clone()),
                    &summary,
                ));

                let evidence_status = match outcome {
                    RuntimeRoutingOutcome::Rerouted => "blocked",
                    RuntimeRoutingOutcome::Unavailable => "unavailable",
                    _ => "blocked",
                };
                let full = json!({
                    "runtimeAction": "project_command",
                    "routingOutcome": outcome,
                    "reasonCode": classification.reason_code,
                    "message": summary,
                    "previewKind": classification.kind,
                    "previewTarget": target.clone(),
                    "commandRan": false,
                });
                let evidence = self.record_project_command_result(
                    session_id,
                    &tc.id,
                    &args_value,
                    evidence_status,
                    false,
                    &summary,
                    Some(&full),
                )?;
                emit(evidence.to_event());
                emit(AgentEvent::ToolResult {
                    call_id: tc.id.clone(),
                    success: false,
                    summary: summary.clone(),
                    full: full.clone(),
                });
                self.log_event(
                    session_id,
                    "tool_call_blocked",
                    json!({
                        "tool": tc.name,
                        "rule": classification.reason_code,
                        "pattern": "preview-open shell workaround",
                        "runtime": "pi_sidecar",
                        "commandRan": false,
                    }),
                )?;
                return Ok(SupervisedToolResult {
                    content: full.to_string(),
                    success: false,
                    summary,
                    full,
                });
            }
        }

        if let Err(err) = tool.validate(&args_value) {
            let egress_reason = match &err {
                ToolError::EgressBlocked(reason) => Some(reason.clone()),
                _ => None,
            };
            let (reason, msg) = tool_validation_block(err);
            emit(AgentEvent::ToolCallBlocked {
                id: tc.id.clone(),
                reason: reason.clone(),
            });
            self.log_event(
                session_id,
                "tool_call_blocked",
                json!({
                    "tool": tc.name,
                    "rule": reason.rule,
                    "pattern": reason.pattern,
                    "runtime": "pi_sidecar",
                }),
            )?;
            if tc.name == "run_process" {
                let evidence = self.record_project_command_result(
                    session_id,
                    &tc.id,
                    &args_value,
                    "blocked",
                    false,
                    &msg,
                    None,
                )?;
                emit(evidence.to_event());
            }
            if tc.name == "run_terminal_script" {
                let evidence = self.record_terminal_script_result(
                    session_id, &tc.id, "blocked", false, &msg, None,
                )?;
                emit(evidence.to_event());
            }
            if let Some(reason) = egress_reason {
                self.record_web_fetch_blocked(session_id, &tc.id, &args_value, &reason)?;
            }
            if tc.name == "web_fetch" {
                let full = json!({
                    "runtimeAction": "web_fetch",
                    "status": "blocked",
                    "success": false,
                    "summary": msg.clone(),
                    "error": msg.clone(),
                    "isEvidence": false,
                });
                self.record_web_fetch_result(
                    session_id,
                    &tc.id,
                    "blocked",
                    false,
                    &msg,
                    Some(&full),
                )?;
            }
            return Ok(SupervisedToolResult {
                content: msg.clone(),
                success: false,
                summary: msg.clone(),
                full: json!({ "error": msg }),
            });
        }

        if tc.name == "run_terminal_script" {
            self.record_terminal_script_approval_requested(session_id, &tc.id, &args_value)?;
        }
        let reused_web_fetch_grant =
            tc.name == "web_fetch" && self.web_fetch_session_grant_allows(&args_value);
        if tc.name == "web_fetch" && !reused_web_fetch_grant {
            self.record_web_fetch_approval_requested(session_id, &tc.id, &args_value)?;
        }

        let decision = if reused_web_fetch_grant {
            PermissionDecision::approved_with_metadata(Some(json!({
                "source": "web_fetch_session_reuse",
            })))
        } else {
            self.permission
                .intercept(
                    tc,
                    risk,
                    PermissionRequestContext {
                        session_id,
                        params_preview: preview.clone(),
                        diff_preview: diff_preview_bundle.diff_preview.clone(),
                        diff_previews: diff_preview_bundle.diff_previews.clone(),
                        approval_warnings: approval_warnings.clone(),
                        args: args_value.clone(),
                    },
                )
                .await
        };
        match decision {
            PermissionDecision::Approved {
                modified_args,
                approval_metadata,
            } => {
                emit(AgentEvent::ToolCallApproved { id: tc.id.clone() });
                let effective_args = modified_args.unwrap_or(args_value);
                let effective_args_for_event = effective_args.clone();
                if tc.name == "web_fetch"
                    && effective_args
                        .get("reuse_for_session")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                {
                    self.remember_web_fetch_session_grant(&effective_args);
                }
                self.log_event(
                    session_id,
                    "tool_approve",
                    tool_approve_payload(
                        &tc.name,
                        &tc.id,
                        risk,
                        Some("pi_sidecar"),
                        approval_metadata.as_ref(),
                    ),
                )?;
                if let Some(payload) = provocation_continue_with_risk_payload(
                    &tc.name,
                    &tc.id,
                    risk,
                    Some("pi_sidecar"),
                    approval_metadata.as_ref(),
                ) {
                    self.log_event(session_id, "provocation.continued_with_risk", payload)?;
                }
                tracing::info!(
                    session_id,
                    tool = %tc.name,
                    risk = risk.as_str(),
                    runtime = "pi_sidecar",
                    "tool execution started"
                );
                // S-032 pre-edit anchor: snapshot the working tree before any
                // potentially-mutating (non-Safe) tool runs, so a broken or
                // unwanted change has a fine-grained "before my last edit"
                // restore point. Best-effort and deduplicated — never blocks the
                // tool.
                if risk != RiskLevel::Safe {
                    self.snapshot_before_write(session_id, &tc.name);
                }
                let out = match tool.run(effective_args, &self.tool_ctx).await {
                    Ok(out) => out,
                    Err(e) => {
                        let msg = format!("{e}");
                        let full = if tc.name == "run_process" {
                            json!({ "runtimeAction": "project_command", "error": msg.clone() })
                        } else if tc.name == "run_terminal_script" {
                            json!({ "runtimeAction": "terminal_script", "error": msg.clone() })
                        } else if tc.name == "web_fetch" {
                            json!({ "runtimeAction": "web_fetch", "status": "failed", "error": msg.clone(), "isEvidence": false })
                        } else {
                            json!({ "error": msg.clone() })
                        };
                        tracing::warn!(
                            session_id,
                            tool = %tc.name,
                            error = %crate::telemetry::redact_log_text(&msg),
                            runtime = "pi_sidecar",
                            "tool execution failed"
                        );
                        emit(AgentEvent::ToolResult {
                            call_id: tc.id.clone(),
                            success: false,
                            summary: msg.clone(),
                            full: full.clone(),
                        });
                        if tc.name == "run_process" {
                            let evidence = self.record_project_command_result(
                                session_id,
                                &tc.id,
                                &effective_args_for_event,
                                "failed",
                                false,
                                &msg,
                                Some(&full),
                            )?;
                            emit(evidence.to_event());
                        }
                        if tc.name == "run_terminal_script" {
                            let evidence = self.record_terminal_script_result(
                                session_id,
                                &tc.id,
                                "failed",
                                false,
                                &msg,
                                Some(&full),
                            )?;
                            emit(evidence.to_event());
                        }
                        if tc.name == "web_fetch" {
                            self.record_web_fetch_result(
                                session_id,
                                &tc.id,
                                "failed",
                                false,
                                &msg,
                                Some(&full),
                            )?;
                        }
                        self.log_event(
                            session_id,
                            "tool_error",
                            json!({ "tool": tc.name, "error": msg.clone(), "runtime": "pi_sidecar" }),
                        )?;
                        self.log_event(
                            session_id,
                            "error_occurred",
                            dive_event_log::error_payload("tool", &msg),
                        )?;
                        return Ok(SupervisedToolResult {
                            content: msg.clone(),
                            success: false,
                            summary: msg,
                            full,
                        });
                    }
                };
                emit(AgentEvent::ToolResult {
                    call_id: tc.id.clone(),
                    success: out.success,
                    summary: out.summary.clone(),
                    full: out.full.clone(),
                });
                if tc.name == "run_process" {
                    let evidence = self.record_project_command_result(
                        session_id,
                        &tc.id,
                        &effective_args_for_event,
                        "completed",
                        out.success,
                        &out.summary,
                        Some(&out.full),
                    )?;
                    emit(evidence.to_event());
                }
                if tc.name == "run_terminal_script" {
                    let evidence = self.record_terminal_script_result(
                        session_id,
                        &tc.id,
                        "completed",
                        out.success,
                        &out.summary,
                        Some(&out.full),
                    )?;
                    emit(evidence.to_event());
                }
                if tc.name == "web_fetch" {
                    let status = out
                        .full
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or(if out.success { "completed" } else { "failed" });
                    self.record_web_fetch_result(
                        session_id,
                        &tc.id,
                        status,
                        out.success,
                        &out.summary,
                        Some(&out.full),
                    )?;
                }
                if tc.name == "preview_open" {
                    self.record_preview_open_tool_result(session_id, &out.full)?;
                    emit_preview_open_tool_events(&out.full, emit);
                }
                tracing::info!(
                    session_id,
                    tool = %tc.name,
                    success = out.success,
                    runtime = "pi_sidecar",
                    "tool execution completed"
                );
                self.record_changed_files(
                    session_id,
                    &tc.name,
                    &out.full,
                    diff_preview_bundle.diff_preview.as_ref(),
                    &diff_preview_bundle.diff_previews,
                )?;
                self.log_event(
                    session_id,
                    "tool_result",
                    json!({
                        "tool": tc.name,
                        "success": out.success,
                        "summary": out.summary.clone(),
                        "runtime": "pi_sidecar",
                    }),
                )?;
                self.log_event(
                    session_id,
                    "tool_complete",
                    json!({
                        "tool": tc.name,
                        "success": out.success,
                        "summary": out.summary.clone(),
                        "runtime": "pi_sidecar",
                    }),
                )?;
                Ok(SupervisedToolResult {
                    content: tool_result_content_for_model(&tc.name, &out.full),
                    success: out.success,
                    summary: out.summary,
                    full: out.full,
                })
            }
            PermissionDecision::Denied(reason) => {
                emit(AgentEvent::ToolCallDenied {
                    id: tc.id.clone(),
                    reason: reason.clone(),
                });
                if tc.name == "run_process" {
                    let content = format!("user denied tool call: {reason}");
                    let evidence = self.record_project_command_result(
                        session_id,
                        &tc.id,
                        &args_value,
                        "denied",
                        false,
                        &content,
                        None,
                    )?;
                    emit(evidence.to_event());
                }
                if tc.name == "run_terminal_script" {
                    let content = format!("user denied terminal script: {reason}");
                    let evidence = self.record_terminal_script_result(
                        session_id, &tc.id, "denied", false, &content, None,
                    )?;
                    emit(evidence.to_event());
                }
                if tc.name == "web_fetch" {
                    let content = format!("user denied web fetch: {reason}");
                    let full = json!({
                        "runtimeAction": "web_fetch",
                        "status": "denied",
                        "success": false,
                        "summary": content,
                        "isEvidence": false,
                    });
                    self.record_web_fetch_result(
                        session_id,
                        &tc.id,
                        "denied",
                        false,
                        &content,
                        Some(&full),
                    )?;
                }
                self.log_event(
                    session_id,
                    "tool_call_denied",
                    json!({ "tool": tc.name, "reason": reason.clone(), "runtime": "pi_sidecar" }),
                )?;
                self.log_event(
                    session_id,
                    "tool_reject",
                    json!({ "tool": tc.name, "reason": reason.clone(), "runtime": "pi_sidecar" }),
                )?;
                let content = format!("user denied tool call: {reason}");
                Ok(SupervisedToolResult {
                    content: content.clone(),
                    success: false,
                    summary: content.clone(),
                    full: json!({ "error": content }),
                })
            }
        }
    }

    fn persist_user_message(
        &self,
        session_id: i64,
        card_id: Option<i64>,
        content: &str,
    ) -> Result<i64, AgentError> {
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let id = message::insert(
            db.conn(),
            &NewMessage {
                session_id,
                card_id,
                role: "user".into(),
                content: content.to_string(),
                reasoning_content: None,
                tool_calls: None,
                usage: None,
                provider: Some(self.provider.id().into()),
                model: Some(self.model.clone()),
            },
        )?;
        Ok(id)
    }

    fn persist_assistant_message(
        &self,
        session_id: i64,
        card_id: Option<i64>,
        content: &str,
        reasoning_content: Option<&str>,
        tool_calls: &[ToolCall],
    ) -> Result<i64, AgentError> {
        let tool_calls_json = if tool_calls.is_empty() {
            None
        } else {
            Some(serde_json::to_value(tool_calls).unwrap_or(Value::Null))
        };
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let id = message::insert(
            db.conn(),
            &NewMessage {
                session_id,
                card_id,
                role: "assistant".into(),
                content: content.to_string(),
                reasoning_content: reasoning_content
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                tool_calls: tool_calls_json,
                usage: None,
                provider: Some(self.provider.id().into()),
                model: Some(self.model.clone()),
            },
        )?;
        Ok(id)
    }

    fn log_event(&self, session_id: i64, kind: &str, payload: Value) -> Result<(), AgentError> {
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        dive_event_log::append_to_conn(db.conn(), Some(session_id), kind, payload)?;
        Ok(())
    }

    /// S-032: create a locale-neutral `auto-pre-edit` checkpoint before an
    /// approved mutating tool runs. Only commits when the working tree changed
    /// since the last checkpoint, and only when the project's checkpoint repo is
    /// already initialized. Best-effort: failures are logged but never surfaced
    /// to the caller, so recovery anchoring can't break a tool execution.
    fn snapshot_before_write(&self, session_id: i64, tool_name: &str) {
        let engine = crate::checkpoint::CheckpointEngine::new(
            self.tool_ctx.project_root.clone(),
            self.db.clone(),
        );
        if !engine.checkpoint_dir().join("HEAD").exists() {
            return;
        }
        match engine.create_checkpoint_if_changed(session_id, None, "auto-pre-edit", None) {
            Ok(Some(row)) => {
                let _ = self.log_event(
                    session_id,
                    "checkpoint_create",
                    json!({
                        "checkpoint_id": row.id,
                        "card_id": row.card_id,
                        "kind": row.kind,
                        "label": row.label,
                        "git_sha": row.git_sha,
                        "changed_file_count": row.changed_files.len(),
                        "trigger": "pre_edit",
                        "tool": tool_name,
                    }),
                );
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!(
                    session_id,
                    tool = %tool_name,
                    error = %e,
                    "pre-edit checkpoint failed"
                );
            }
        }
    }

    fn record_preview_open_tool_result(
        &self,
        session_id: i64,
        payload: &Value,
    ) -> Result<(), AgentError> {
        let request_id = payload
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or("preview-tool");
        let target_label = payload
            .get("targetLabel")
            .and_then(Value::as_str)
            .unwrap_or("project preview");
        self.log_event(
            session_id,
            dive_event_log::PREVIEW_OPEN_REQUESTED_EVENT,
            json!({
                "requestId": request_id,
                "sessionId": payload.get("sessionId").cloned().unwrap_or_else(|| json!(session_id)),
                "cardId": payload.get("cardId").cloned().unwrap_or(Value::Null),
                "kind": payload.get("kind").cloned().unwrap_or_else(|| json!("auto")),
                "targetLabel": target_label,
                "source": payload.get("source").cloned().unwrap_or_else(|| json!("ai_tool")),
                "requestedAt": crate::db::now_ms(),
            }),
        )?;
        self.log_event(
            session_id,
            dive_event_log::PREVIEW_OPEN_RESULT_EVENT,
            json!({
                "requestId": request_id,
                "status": payload.get("status").cloned().unwrap_or_else(|| json!("unavailable")),
                "targetLabel": target_label,
                "reasonCode": payload.get("reasonCode").cloned().unwrap_or(Value::Null),
                "message": payload.get("message").cloned().unwrap_or_else(|| json!("Preview unavailable.")),
                "resolvedAt": payload.get("resolvedAt").cloned().unwrap_or_else(|| json!(crate::db::now_ms())),
                "logs": payload.get("logs").cloned().unwrap_or_else(|| json!([])),
                "commandSummary": payload.get("commandSummary").cloned().unwrap_or(Value::Null),
            }),
        )?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn record_project_command_result(
        &self,
        session_id: i64,
        tool_call_id: &str,
        args: &Value,
        status: &str,
        success: bool,
        summary: &str,
        full: Option<&Value>,
    ) -> Result<ProjectCommandResultEvidence, AgentError> {
        let card_id = self.current_card_id(session_id)?;
        let evidence = ProjectCommandResultEvidence::from_tool_result(
            session_id,
            card_id,
            tool_call_id,
            args,
            status,
            success,
            summary,
            full,
        );
        self.log_event(
            session_id,
            dive_event_log::PROJECT_COMMAND_RESULT_EVENT,
            evidence.to_payload(),
        )?;
        Ok(evidence)
    }

    fn record_terminal_script_approval_requested(
        &self,
        session_id: i64,
        tool_call_id: &str,
        args: &Value,
    ) -> Result<(), AgentError> {
        let card_id = self.current_card_id(session_id)?;
        self.log_event(
            session_id,
            dive_event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT,
            dive_event_log::terminal_script_approval_requested_payload(
                tool_call_id,
                session_id,
                card_id,
                args,
            ),
        )
    }

    fn record_terminal_script_result(
        &self,
        session_id: i64,
        tool_call_id: &str,
        status: &str,
        success: bool,
        summary: &str,
        full: Option<&Value>,
    ) -> Result<TerminalScriptResultEvidence, AgentError> {
        let payload = dive_event_log::terminal_script_result_payload(
            tool_call_id,
            status,
            success,
            summary,
            full,
        );
        self.log_event(
            session_id,
            dive_event_log::TERMINAL_SCRIPT_RESULT_EVENT,
            payload.clone(),
        )?;
        Ok(TerminalScriptResultEvidence::from_payload(payload))
    }

    fn record_web_fetch_approval_requested(
        &self,
        session_id: i64,
        tool_call_id: &str,
        args: &Value,
    ) -> Result<(), AgentError> {
        let card_id = self.current_card_id(session_id)?;
        self.log_event(
            session_id,
            dive_event_log::WEB_FETCH_APPROVAL_REQUESTED_EVENT,
            dive_event_log::web_fetch_approval_requested_payload(
                tool_call_id,
                session_id,
                card_id,
                args,
            ),
        )
    }

    fn web_fetch_session_grant_allows(&self, args: &Value) -> bool {
        let Some(key) = crate::tools::web_fetch::session_grant_key(args) else {
            return false;
        };
        self.web_fetch_session_grants
            .lock()
            .map(|grants| grants.contains(&key))
            .unwrap_or(false)
    }

    fn remember_web_fetch_session_grant(&self, args: &Value) {
        let Some(key) = crate::tools::web_fetch::session_grant_key(args) else {
            return;
        };
        if let Ok(mut grants) = self.web_fetch_session_grants.lock() {
            grants.insert(key);
        }
    }

    fn record_web_fetch_result(
        &self,
        session_id: i64,
        tool_call_id: &str,
        status: &str,
        success: bool,
        summary: &str,
        full: Option<&Value>,
    ) -> Result<(), AgentError> {
        self.log_event(
            session_id,
            dive_event_log::WEB_FETCH_RESULT_EVENT,
            dive_event_log::web_fetch_result_payload(tool_call_id, status, success, summary, full),
        )
    }

    fn record_web_fetch_blocked(
        &self,
        session_id: i64,
        tool_call_id: &str,
        args: &Value,
        reason: &crate::tools::egress_guard::EgressBlockReason,
    ) -> Result<(), AgentError> {
        self.log_event(
            session_id,
            dive_event_log::WEB_FETCH_BLOCKED_EVENT,
            dive_event_log::web_fetch_blocked_payload(tool_call_id, session_id, args, reason),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn record_runtime_routing_decision(
        &self,
        session_id: i64,
        tool_call_id: Option<&str>,
        input_kind: RuntimeInputKind,
        outcome: RuntimeRoutingOutcome,
        reason_code: impl Into<String>,
        evidence_refs: Vec<Value>,
        message: &str,
    ) -> Result<RuntimeRoutingDecision, AgentError> {
        let decision = RuntimeRoutingDecision {
            decision_id: Uuid::new_v4().to_string(),
            session_id,
            card_id: self.current_card_id(session_id)?,
            input_kind,
            outcome,
            reason_code: reason_code.into(),
            evidence_refs,
            created_at: crate::db::now_ms(),
        };
        let mut payload = dive_event_log::runtime_routing_decision_payload(&decision);
        if let Value::Object(map) = &mut payload {
            map.insert("message".into(), Value::String(message.to_string()));
            if let Some(tool_call_id) = tool_call_id {
                map.insert("toolCallId".into(), Value::String(tool_call_id.to_string()));
            }
            map.insert("commandRan".into(), Value::Bool(false));
        }
        self.log_event(
            session_id,
            dive_event_log::RUNTIME_ROUTING_DECISION_EVENT,
            payload,
        )?;
        Ok(decision)
    }

    fn load_history(&self, session_id: i64) -> Result<Vec<ProviderMessage>, AgentError> {
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let rows = message::list_by_session(db.conn(), session_id, 200)?;
        let mut msgs = Vec::with_capacity(rows.len());
        for row in rows {
            let msg = match row.role.as_str() {
                "system" => ProviderMessage::System {
                    content: row.content,
                },
                "user" => ProviderMessage::User {
                    content: row.content,
                },
                "assistant" => ProviderMessage::Assistant {
                    content: row.content,
                    reasoning_content: row.reasoning_content,
                    tool_calls: row
                        .tool_calls
                        .and_then(|v| serde_json::from_value::<Vec<ToolCall>>(v).ok()),
                },
                "tool" => ProviderMessage::Tool {
                    content: row.content,
                    tool_call_id: String::new(),
                },
                _ => continue,
            };
            msgs.push(msg);
        }
        Ok(msgs)
    }

    fn check_cancel(&self) -> Result<(), AgentError> {
        if self.cancel.load(Ordering::SeqCst) {
            Err(AgentError::Cancelled)
        } else {
            Ok(())
        }
    }

    async fn wait_for_cancel(&self) {
        while !self.cancel.load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    fn current_card_id(&self, session_id: i64) -> Result<Option<i64>, AgentError> {
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let Some(wm) = workmap::get(db.conn(), session_id)? else {
            return Ok(None);
        };
        Ok(wm.current_card_id)
    }

    fn record_changed_files(
        &self,
        session_id: i64,
        tool_name: &str,
        full: &Value,
        diff_preview: Option<&DiffPreview>,
        diff_previews: &[DiffPreview],
    ) -> Result<(), AgentError> {
        let Some(card_id) = self.current_card_id(session_id)? else {
            return Ok(());
        };
        let paths = changed_paths_from_tool_result(tool_name, full);
        if paths.is_empty() {
            return Ok(());
        }
        let entries = paths
            .iter()
            .map(|path| {
                if let Some(diff) = diff_preview
                    .filter(|diff| diff.path == *path)
                    .or_else(|| diff_previews.iter().find(|diff| diff.path == *path))
                {
                    json!({
                        "path": path,
                        "diff": {
                            "path": diff.path,
                            "before": diff.before,
                            "after": diff.after,
                        }
                    })
                } else {
                    Value::String(path.clone())
                }
            })
            .collect::<Vec<_>>();
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let merged = card::append_changed_file_entries(db.conn(), card_id, &entries)?;
        drop(db);
        self.log_event(
            session_id,
            "card_changed_files",
            json!({
                "card_id": card_id,
                "paths": paths,
                "total": merged.len(),
            }),
        )?;
        Ok(())
    }

    fn current_card_system_prompt(&self, session_id: i64) -> Result<Option<String>, AgentError> {
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let Some(wm) = workmap::get(db.conn(), session_id)? else {
            return Ok(None);
        };
        let Some(cid) = wm.current_card_id else {
            return Ok(None);
        };
        let Some(card) = card::get_by_id(db.conn(), cid)? else {
            return Ok(None);
        };
        Ok(Some(build_current_card_system_prompt(
            self.step_context.as_ref(),
            &card.title,
            card.instruction.as_deref(),
            self.locale.as_deref(),
        )))
    }

    fn locale_system_prompt(&self) -> Option<String> {
        let locale = self.locale.as_ref()?.trim();
        if locale.is_empty() {
            return None;
        }
        Some(format!(
            "현재 사용자 언어: {locale}. 모든 응답(설명, 질문, 요약)은 반드시 그 언어로 작성하세요."
        ))
    }

    fn plan_interview_system_prompt(&self) -> Option<String> {
        if self.run_mode != AgentRunMode::Interview {
            return None;
        }
        Some(build_plan_interview_system_prompt(
            self.locale.as_deref().unwrap_or("ko"),
        ))
    }

    async fn build_diff_preview(&self, tool_name: &str, args: &Value) -> DiffPreviewBundle {
        match tool_name {
            "write_file" => {
                let Some(path) = args.get("path").and_then(Value::as_str).map(str::to_owned) else {
                    return DiffPreviewBundle::default();
                };
                let Some(after) = args
                    .get("content")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                else {
                    return DiffPreviewBundle::default();
                };
                let Some(resolved) = self.tool_ctx.fs.resolve_read(&path).ok() else {
                    return DiffPreviewBundle::default();
                };
                let before = tokio::fs::read_to_string(&resolved)
                    .await
                    .unwrap_or_default();
                DiffPreviewBundle {
                    diff_preview: Some(DiffPreview {
                        path,
                        before,
                        after,
                    }),
                    diff_previews: Vec::new(),
                }
            }
            "edit_file" => {
                let Some(path) = args.get("path").and_then(Value::as_str).map(str::to_owned) else {
                    return DiffPreviewBundle::default();
                };
                let Some(find) = args.get("find").and_then(Value::as_str) else {
                    return DiffPreviewBundle::default();
                };
                let Some(replace) = args.get("replace").and_then(Value::as_str) else {
                    return DiffPreviewBundle::default();
                };
                let Some(resolved) = self.tool_ctx.fs.resolve_read(&path).ok() else {
                    return DiffPreviewBundle::default();
                };
                let Some(before) = tokio::fs::read_to_string(&resolved).await.ok() else {
                    return DiffPreviewBundle::default();
                };
                if !before.contains(find) {
                    return DiffPreviewBundle {
                        diff_preview: Some(DiffPreview {
                            path,
                            before,
                            after: String::new(),
                        }),
                        diff_previews: Vec::new(),
                    };
                }
                let after = before.replacen(find, replace, 1);
                DiffPreviewBundle {
                    diff_preview: Some(DiffPreview {
                        path,
                        before,
                        after,
                    }),
                    diff_previews: Vec::new(),
                }
            }
            "multi_replace" => {
                let diff_previews = multi_replace::preview_replacements(args, &self.tool_ctx)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .map(|preview| DiffPreview {
                        path: preview.path,
                        before: preview.before,
                        after: preview.after,
                    })
                    .collect();
                DiffPreviewBundle {
                    diff_preview: None,
                    diff_previews,
                }
            }
            _ => DiffPreviewBundle::default(),
        }
    }
}

fn build_current_card_system_prompt(
    step_context: Option<&StepContext>,
    card_title: &str,
    card_instruction: Option<&str>,
    locale: Option<&str>,
) -> String {
    let mut prompt_parts = Vec::new();
    if let Some(ctx) = step_context {
        prompt_parts.push(format!("현재 작업 단계: {}", ctx.title));
        if let Some(instruction) = &ctx.instruction_seed {
            prompt_parts.push(format!("단계 지시: {}", instruction));
        }
        if let Some(criteria) = &ctx.acceptance_criteria {
            prompt_parts.push(format!("수용 기준: {}", criteria));
        }
        if !ctx.linked_criterion_ids.is_empty() {
            prompt_parts.push(format!(
                "연결된 PRD 기준: {}",
                ctx.linked_criterion_ids.join(", ")
            ));
        }
        if let Some(rationale) = &ctx.decomposition_rationale {
            prompt_parts.push(format!("분해 근거: {}", rationale));
        }
        if let Some(files) = &ctx.expected_files {
            prompt_parts.push(format!("예상 변경 파일: {}", files));
        }
        if let Some(clause) = step_kind_prompt_clause(ctx.step_kind, locale) {
            prompt_parts.push(clause.to_string());
        }
        prompt_parts.push(
            "단계 종료 규칙: 수용 기준을 충족했거나 더 이상 필요한 도구 호출이 없으면 즉시 도구 호출을 멈추고 최종 응답으로 변경 내용, 검증/미검증 근거, 남은 리스크를 요약하세요. 같은 정보를 반복 확인하기 위해 동일한 도구 호출을 반복하지 마세요.".to_string(),
        );
    }

    let instruction = card_instruction.unwrap_or("").trim();
    if instruction.is_empty() {
        prompt_parts.push(format!("현재 작업 중인 카드: {card_title}"));
    } else {
        prompt_parts.push(format!(
            "현재 작업 중인 카드: {card_title}\n지시: {instruction}",
        ));
    }
    prompt_parts.join("\n\n")
}

fn step_kind_prompt_clause(kind: StepKind, locale: Option<&str>) -> Option<&'static str> {
    let english = locale.is_some_and(prompt_locale_is_english);
    match kind {
        StepKind::Refactor | StepKind::Rename => {
            if english {
                Some(
                    "Behavior-preserving step: move the code verbatim - do not change logic, defaults, or ordering; this step must preserve behavior.",
                )
            } else {
                Some(
                    "동작 보존 단계: 코드를 그대로 옮기세요. 로직, 기본값, 순서를 바꾸지 말고 이 단계는 동작을 보존해야 합니다.",
                )
            }
        }
        StepKind::Debug => {
            if english {
                Some(
                    "Debug step: diagnose before editing, identify the smallest likely cause, and make the minimal fix.",
                )
            } else {
                Some("디버그 단계: 편집하기 전에 먼저 진단하고 가장 작은 원인을 찾아 최소 수정만 하세요.")
            }
        }
        StepKind::Feature | StepKind::Comment => None,
    }
}

struct PendingToolCall {
    id: String,
    name: String,
    arguments: String,
}

fn emit_and_forward(emit: &mut (dyn FnMut(AgentEvent) + Send), evt: AgentEvent) {
    emit(evt);
}

fn runtime_routing_decision_event(
    decision: &RuntimeRoutingDecision,
    tool_call_id: Option<String>,
    message: &str,
) -> AgentEvent {
    AgentEvent::RuntimeRoutingDecision {
        decision_id: decision.decision_id.clone(),
        tool_call_id,
        input_kind: decision.input_kind,
        outcome: decision.outcome,
        reason_code: decision.reason_code.clone(),
        evidence_refs: decision.evidence_refs.clone(),
        message: message.to_string(),
        created_at: decision.created_at,
    }
}

#[derive(Debug, Clone)]
struct ProjectCommandResultEvidence {
    tool_call_id: String,
    session_id: i64,
    card_id: Option<i64>,
    command_label: String,
    executable: String,
    args: Vec<String>,
    timeout_sec: u64,
    reason: Option<String>,
    expected_effect: Option<String>,
    status: String,
    success: bool,
    exit_code: Option<i32>,
    summary: String,
    stdout_summary: String,
    stderr_summary: String,
    created_at: i64,
}

impl ProjectCommandResultEvidence {
    #[allow(clippy::too_many_arguments)]
    fn from_tool_result(
        session_id: i64,
        card_id: Option<i64>,
        tool_call_id: &str,
        args_value: &Value,
        status: &str,
        success: bool,
        summary: &str,
        full: Option<&Value>,
    ) -> Self {
        let executable = args_value
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("run_process")
            .to_string();
        let args = string_vec_field(args_value, "args");
        let timeout_sec = full
            .and_then(|value| value.get("timeout_sec"))
            .and_then(Value::as_u64)
            .or_else(|| args_value.get("timeout_sec").and_then(Value::as_u64))
            .unwrap_or(PROJECT_COMMAND_DEFAULT_TIMEOUT_SEC);
        let reason = optional_string_field(args_value, "reason");
        let expected_effect = optional_string_field(args_value, "expected_effect");
        let exit_code = full
            .and_then(|value| value.get("exit_code"))
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok());
        let stdout_summary = full
            .and_then(|value| value.get("stdout"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let stderr_summary = full
            .and_then(|value| value.get("stderr"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let command_label = command_label(&executable, &args);
        Self {
            tool_call_id: tool_call_id.to_string(),
            session_id,
            card_id,
            command_label,
            executable,
            args,
            timeout_sec,
            reason,
            expected_effect,
            status: status.to_string(),
            success,
            exit_code,
            summary: summary.to_string(),
            stdout_summary,
            stderr_summary,
            created_at: crate::db::now_ms(),
        }
    }

    fn to_payload(&self) -> Value {
        json!({
            "toolCallId": self.tool_call_id.clone(),
            "sessionId": self.session_id,
            "cardId": self.card_id,
            "commandLabel": self.command_label.clone(),
            "executable": self.executable.clone(),
            "args": self.args.clone(),
            "timeoutSec": self.timeout_sec,
            "reason": self.reason.clone(),
            "expectedEffect": self.expected_effect.clone(),
            "status": self.status.clone(),
            "success": self.success,
            "exitCode": self.exit_code,
            "summary": self.summary.clone(),
            "stdoutSummary": self.stdout_summary.clone(),
            "stderrSummary": self.stderr_summary.clone(),
            "createdAt": self.created_at,
        })
    }

    fn to_event(&self) -> AgentEvent {
        AgentEvent::ProjectCommandResult {
            tool_call_id: self.tool_call_id.clone(),
            command_label: self.command_label.clone(),
            executable: self.executable.clone(),
            args: self.args.clone(),
            timeout_sec: self.timeout_sec,
            reason: self.reason.clone(),
            expected_effect: self.expected_effect.clone(),
            status: self.status.clone(),
            success: self.success,
            exit_code: self.exit_code,
            summary: self.summary.clone(),
            stdout_summary: Some(self.stdout_summary.clone()),
            stderr_summary: Some(self.stderr_summary.clone()),
            created_at: self.created_at,
        }
    }
}

#[derive(Debug, Clone)]
struct TerminalScriptResultEvidence {
    tool_call_id: String,
    status: String,
    success: bool,
    exit_code: Option<i32>,
    summary: String,
    stdout_summary: String,
    stderr_summary: String,
    truncated: bool,
    resolved_at: i64,
}

impl TerminalScriptResultEvidence {
    fn from_payload(payload: Value) -> Self {
        let exit_code = payload
            .get("exitCode")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok());
        Self {
            tool_call_id: payload
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("terminal-script")
                .to_string(),
            status: payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed")
                .to_string(),
            success: payload
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            exit_code,
            summary: payload
                .get("summary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            stdout_summary: payload
                .get("stdoutSummary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            stderr_summary: payload
                .get("stderrSummary")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            truncated: payload
                .get("truncated")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            resolved_at: payload
                .get("resolvedAt")
                .and_then(Value::as_i64)
                .unwrap_or_else(crate::db::now_ms),
        }
    }

    fn to_event(&self) -> AgentEvent {
        AgentEvent::TerminalScriptResult {
            tool_call_id: self.tool_call_id.clone(),
            status: self.status.clone(),
            success: self.success,
            exit_code: self.exit_code,
            summary: self.summary.clone(),
            stdout_summary: Some(self.stdout_summary.clone()),
            stderr_summary: Some(self.stderr_summary.clone()),
            truncated: self.truncated,
            resolved_at: self.resolved_at,
        }
    }
}

fn string_vec_field(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn optional_string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn command_label(executable: &str, args: &[String]) -> String {
    if args.is_empty() {
        executable.to_string()
    } else {
        format!("{executable} {}", args.join(" "))
    }
}

fn emit_preview_open_tool_events(payload: &Value, emit: &mut (dyn FnMut(AgentEvent) + Send)) {
    let request_id = payload
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or("preview-tool")
        .to_string();
    let target_label = payload
        .get("targetLabel")
        .and_then(Value::as_str)
        .unwrap_or("project preview")
        .to_string();
    let kind = payload
        .get("kind")
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or(crate::tools::runtime::PreviewRequestKind::Auto);
    emit(AgentEvent::PreviewOpenRequested {
        request_id: request_id.clone(),
        kind,
        target_label: target_label.clone(),
        source: payload
            .get("source")
            .and_then(Value::as_str)
            .unwrap_or("ai_tool")
            .to_string(),
        requested_at: crate::db::now_ms(),
    });
    emit(AgentEvent::PreviewOpenResult {
        request_id,
        kind,
        status: payload
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unavailable")
            .to_string(),
        preview_url: payload
            .get("previewUrl")
            .and_then(Value::as_str)
            .map(str::to_string),
        asset_file_path: optional_string_field(payload, "assetFilePath"),
        target_label,
        reason_code: payload
            .get("reasonCode")
            .and_then(Value::as_str)
            .map(str::to_string),
        message: payload
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Preview unavailable.")
            .to_string(),
        resolved_at: payload
            .get("resolvedAt")
            .and_then(Value::as_i64)
            .unwrap_or_else(crate::db::now_ms),
    });
}

fn finish_reason_str(fr: FinishReason) -> &'static str {
    match fr {
        FinishReason::Stop => "stop",
        FinishReason::Length => "length",
        FinishReason::ToolCalls => "tool_calls",
        FinishReason::ContentFilter => "content_filter",
        FinishReason::Error => "error",
    }
}

fn reasoning_summary(tool_name: &str, preview: &str) -> String {
    let action = match tool_name {
        "read_file" | "list_dir" => "현재 코드를 이해하기 위해",
        "write_file" | "edit_file" | "delete_file" | "mkdir" => "카드 지시를 구현하기 위해",
        "bash" => "결과를 검증하거나 필요한 정보를 확인하기 위해",
        _ => "다음 단계를 진행하기 위해",
    };
    if preview.trim().is_empty() {
        format!("AI가 {action} `{tool_name}` 도구를 사용하려고 합니다.")
    } else {
        format!("AI가 {action} `{tool_name}` 도구를 사용하려고 합니다: {preview}")
    }
}

fn tool_validation_block(err: ToolError) -> (BlockReason, String) {
    match err {
        ToolError::Blocked(reason) => {
            let msg = format!(
                "tool call blocked by safety policy: {} (pattern: {})",
                reason.rule, reason.pattern
            );
            (reason, msg)
        }
        ToolError::EgressBlocked(reason) => {
            let msg = reason.safe_agent_message().to_string();
            (
                BlockReason {
                    rule: "web fetch safety policy".into(),
                    pattern: reason.code().into(),
                },
                msg,
            )
        }
        other => {
            let msg = other.to_string();
            (
                BlockReason {
                    rule: "invalid tool input".into(),
                    pattern: msg.clone(),
                },
                format!("tool call blocked before approval: {msg}"),
            )
        }
    }
}

fn tool_approve_payload(
    tool_name: &str,
    tool_call_id: &str,
    risk: RiskLevel,
    runtime: Option<&str>,
    approval_metadata: Option<&Value>,
) -> Value {
    let mut payload = json!({
        "tool": tool_name,
        "tool_call_id": tool_call_id,
        "risk": risk.as_str(),
    });
    if let Some(runtime) = runtime {
        payload["runtime"] = json!(runtime);
    }
    if let Some(metadata) = approval_metadata {
        payload["approval_metadata"] = metadata.clone();
    }
    payload
}

fn provocation_continue_with_risk_payload(
    tool_name: &str,
    tool_call_id: &str,
    risk: RiskLevel,
    runtime: Option<&str>,
    approval_metadata: Option<&Value>,
) -> Option<Value> {
    let metadata = approval_metadata?;
    if metadata.get("source").and_then(Value::as_str) != Some("provocation.continue_with_risk") {
        return None;
    }

    let mut payload = json!({
        "tool": tool_name,
        "tool_call_id": tool_call_id,
        "risk": risk.as_str(),
        "approval_metadata": metadata,
        "reason": metadata.get("riskReason").cloned().unwrap_or(Value::Null),
        "cardId": metadata.get("cardId").cloned().unwrap_or(Value::Null),
        "cardType": metadata.get("cardType").cloned().unwrap_or(Value::Null),
        "highRiskFiles": metadata.get("highRiskFiles").cloned().unwrap_or(Value::Null),
    });
    if let Some(runtime) = runtime {
        payload["runtime"] = json!(runtime);
    }
    Some(payload)
}

#[derive(Default)]
pub struct AgentLoopBuilder {
    provider: Option<Arc<dyn LlmProvider>>,
    registry: Option<Arc<ToolRegistry>>,
    permission: Option<Arc<dyn PermissionHook>>,
    db: Option<Arc<Mutex<Database>>>,
    tool_ctx: Option<ToolContext>,
    max_iterations: Option<u32>,
    cancel: Option<Arc<AtomicBool>>,
    model: Option<String>,
    run_mode: Option<AgentRunMode>,
    plan_accepted: bool,
    locale: Option<String>,
    step_context: Option<StepContext>,
}

impl AgentLoopBuilder {
    pub fn provider(mut self, p: Arc<dyn LlmProvider>) -> Self {
        self.provider = Some(p);
        self
    }
    pub fn registry(mut self, r: Arc<ToolRegistry>) -> Self {
        self.registry = Some(r);
        self
    }
    pub fn permission(mut self, h: Arc<dyn PermissionHook>) -> Self {
        self.permission = Some(h);
        self
    }
    pub fn db(mut self, d: Arc<Mutex<Database>>) -> Self {
        self.db = Some(d);
        self
    }
    pub fn tool_ctx(mut self, c: ToolContext) -> Self {
        self.tool_ctx = Some(c);
        self
    }
    pub fn max_iterations(mut self, n: u32) -> Self {
        self.max_iterations = Some(n);
        self
    }
    pub fn cancel(mut self, c: Arc<AtomicBool>) -> Self {
        self.cancel = Some(c);
        self
    }
    pub fn model(mut self, m: impl Into<String>) -> Self {
        self.model = Some(m.into());
        self
    }
    pub fn run_mode(mut self, mode: AgentRunMode) -> Self {
        self.run_mode = Some(mode);
        self
    }
    pub fn plan_accepted(mut self, accepted: bool) -> Self {
        self.plan_accepted = accepted;
        self
    }
    pub fn locale(mut self, locale: Option<String>) -> Self {
        self.locale = locale
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        self
    }
    pub fn step_context(mut self, ctx: Option<StepContext>) -> Self {
        self.step_context = ctx;
        self
    }

    pub fn build(self) -> Result<AgentLoop, String> {
        Ok(AgentLoop {
            provider: self.provider.ok_or("provider required")?,
            registry: self
                .registry
                .unwrap_or_else(|| Arc::new(ToolRegistry::with_builtins())),
            permission: self.permission.ok_or("permission required")?,
            db: self.db.ok_or("db required")?,
            tool_ctx: self.tool_ctx.ok_or("tool_ctx required")?,
            max_iterations: self.max_iterations.unwrap_or(DEFAULT_MAX_ITERATIONS),
            cancel: self
                .cancel
                .unwrap_or_else(|| Arc::new(AtomicBool::new(false))),
            model: self.model.unwrap_or_else(|| "unset".into()),
            run_mode: self.run_mode.unwrap_or(AgentRunMode::Plan),
            plan_accepted: self.plan_accepted,
            locale: self.locale,
            step_context: self.step_context,
            web_fetch_session_grants: Arc::new(Mutex::new(HashSet::new())),
        })
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::db::models::{CardState, NewCard};

    #[test]
    fn web_fetch_model_channel_strips_resolved_ip_and_error_class_on_success() {
        // audit L2: a successful web_fetch result carries host + resolvedIp for
        // the human card/EventLog, but the model/tool channel must not see the
        // internal resolved IP or the fired guard rule.
        let full = json!({
            "runtimeAction": "web_fetch",
            "status": "completed",
            "success": true,
            "host": "example.com",
            "resolvedIp": "93.184.216.34",
            "errorClass": "denied_resolved_ip",
            "bodySnippet": "hello",
        });
        let model = tool_result_content_for_model("web_fetch", &full);
        assert!(!model.contains("93.184.216.34"));
        assert!(!model.contains("resolvedIp"));
        assert!(!model.contains("errorClass"));
        assert!(!model.contains("denied_resolved_ip"));
        assert!(model.contains("example.com"));
        // Non-web tools are passed through verbatim.
        assert_eq!(
            tool_result_content_for_model("run_process", &full),
            full.to_string()
        );
    }

    fn make_test_loop(
        project: &Path,
        db: Arc<Mutex<crate::db::Database>>,
        session_id: i64,
    ) -> AgentLoop {
        AgentLoop::builder()
            .provider(Arc::new(crate::providers::MockProvider::new(Vec::new())))
            .registry(Arc::new(crate::tools::ToolRegistry::with_builtins()))
            .permission(Arc::new(AlwaysApproveHook))
            .db(db)
            .tool_ctx(crate::tools::ToolContext::new(project, session_id))
            .model("test-model")
            .run_mode(AgentRunMode::Build)
            .build()
            .unwrap()
    }

    fn insert_current_card(db: &crate::db::Database, session_id: i64) -> i64 {
        let card_id = card::insert(
            db.conn(),
            &NewCard {
                session_id,
                title: "current card".into(),
                instruction: None,
                assist_summary: None,
                acceptance_criteria: None,
                retrospective: None,
                change_summary: None,
                state: CardState::Instructed,
                verify_log: None,
                changed_files: None,
                test_command: None,
                approval_judgment: None,
                approval_provenance: None,
                position: 1,
            },
        )
        .unwrap();
        workmap::set_current_card(db.conn(), session_id, Some(card_id)).unwrap();
        card_id
    }

    #[test]
    fn changed_paths_extracts_only_mutating_file_tools() {
        assert_eq!(
            changed_paths_from_tool_result("write_file", &json!({"path": "src/App.tsx"})),
            vec!["src/App.tsx"]
        );
        assert_eq!(
            changed_paths_from_tool_result(
                "multi_replace",
                &json!({
                    "changed_files": [
                        { "path": "src/a.ts", "replacements": 1 },
                        { "path": "src/b.ts", "replacements": 2 }
                    ]
                })
            ),
            vec!["src/a.ts", "src/b.ts"]
        );
        assert!(
            changed_paths_from_tool_result("read_file", &json!({"path": "src/App.tsx"})).is_empty()
        );
        assert!(changed_paths_from_tool_result("bash", &json!({"stdout": "changed"})).is_empty());
    }

    #[test]
    fn multi_replace_secret_warning_escalates_warn_to_danger() {
        let diff_previews = vec![
            DiffPreview {
                path: "src/one.ts".into(),
                before: "const name = \"old\";".into(),
                after: "const name = \"new\";".into(),
            },
            DiffPreview {
                path: "src/secrets.ts".into(),
                before: "export const token = \"placeholder\";".into(),
                after: "export const api_key = \"abcd1234\";".into(),
            },
        ];

        let warnings =
            approval_warnings_for_tool("multi_replace", &json!({}), None, &diff_previews);

        assert!(warnings.secret_flagged);
        assert_eq!(warnings.secret_reasons, vec!["named_secret"]);
        assert_eq!(approval_risk(RiskLevel::Warn, &warnings), RiskLevel::Danger);
    }

    #[tokio::test]
    async fn build_diff_preview_multi_replace_returns_per_target_previews() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("src")).unwrap();
        std::fs::write(project.path().join("src/one.ts"), "OldName();\n").unwrap();
        std::fs::write(
            project.path().join("src/two.ts"),
            "const v = \"OldName\";\n",
        )
        .unwrap();
        let (db, _db_file) = crate::db::tests::fresh_db();
        let (_, session_id) = crate::db::tests::seed_project_session(db.conn());
        let loop_ = make_test_loop(project.path(), Arc::new(Mutex::new(db)), session_id);

        let bundle = loop_
            .build_diff_preview(
                "multi_replace",
                &json!({
                    "find": "OldName",
                    "replace": "NewName",
                    "paths": ["src/one.ts", "src/two.ts"]
                }),
            )
            .await;

        assert!(bundle.diff_preview.is_none());
        assert_eq!(bundle.diff_previews.len(), 2);
        assert_eq!(bundle.diff_previews[0].path, "src/one.ts");
        assert_eq!(bundle.diff_previews[0].before, "OldName();\n");
        assert_eq!(bundle.diff_previews[0].after, "NewName();\n");
        assert_eq!(bundle.diff_previews[1].path, "src/two.ts");
        assert_eq!(bundle.diff_previews[1].before, "const v = \"OldName\";\n");
        assert_eq!(bundle.diff_previews[1].after, "const v = \"NewName\";\n");
    }

    #[tokio::test]
    async fn build_diff_preview_write_file_keeps_single_diff_path_only() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("src")).unwrap();
        std::fs::write(project.path().join("src/App.tsx"), "old").unwrap();
        let (db, _db_file) = crate::db::tests::fresh_db();
        let (_, session_id) = crate::db::tests::seed_project_session(db.conn());
        let loop_ = make_test_loop(project.path(), Arc::new(Mutex::new(db)), session_id);

        let bundle = loop_
            .build_diff_preview(
                "write_file",
                &json!({ "path": "src/App.tsx", "content": "new" }),
            )
            .await;

        let diff = bundle
            .diff_preview
            .expect("write_file should keep single diff");
        assert_eq!(diff.path, "src/App.tsx");
        assert_eq!(diff.before, "old");
        assert_eq!(diff.after, "new");
        assert!(bundle.diff_previews.is_empty());
    }

    #[test]
    fn record_changed_files_attaches_each_multi_replace_diff_by_path() {
        let project = tempfile::tempdir().unwrap();
        let (db, _db_file) = crate::db::tests::fresh_db();
        let (_, session_id) = crate::db::tests::seed_project_session(db.conn());
        let card_id = insert_current_card(&db, session_id);
        let db = Arc::new(Mutex::new(db));
        let loop_ = make_test_loop(project.path(), db.clone(), session_id);
        let diff_previews = vec![
            DiffPreview {
                path: "src/one.ts".into(),
                before: "OldName();".into(),
                after: "NewName();".into(),
            },
            DiffPreview {
                path: "src/two.ts".into(),
                before: "OldName.test();".into(),
                after: "NewName.test();".into(),
            },
        ];

        loop_
            .record_changed_files(
                session_id,
                "multi_replace",
                &json!({
                    "changed_files": [
                        { "path": "src/one.ts", "replacements": 1 },
                        { "path": "src/two.ts", "replacements": 1 }
                    ]
                }),
                None,
                &diff_previews,
            )
            .unwrap();

        let db = db.lock().unwrap();
        let card = card::get_by_id(db.conn(), card_id).unwrap().unwrap();
        assert_eq!(
            card.changed_files,
            Some(json!([
                {
                    "path": "src/one.ts",
                    "diff": {
                        "path": "src/one.ts",
                        "before": "OldName();",
                        "after": "NewName();"
                    }
                },
                {
                    "path": "src/two.ts",
                    "diff": {
                        "path": "src/two.ts",
                        "before": "OldName.test();",
                        "after": "NewName.test();"
                    }
                }
            ]))
        );
    }

    #[test]
    fn reasoning_summary_explains_tool_intent() {
        let text = reasoning_summary("edit_file", "src/App.tsx");
        assert!(text.contains("카드 지시를 구현"));
        assert!(text.contains("edit_file"));
        assert!(text.contains("src/App.tsx"));
    }

    #[test]
    fn provocation_risk_payload_preserves_reason_and_tool_call_id() {
        let metadata = json!({
            "source": "provocation.continue_with_risk",
            "cardId": "diff_scope_drift:execute:tool-1",
            "cardType": "diff_scope_drift",
            "riskReason": "package change is intentional",
            "highRiskFiles": ["package.json"],
        });
        let payload = provocation_continue_with_risk_payload(
            "edit_file",
            "tool-1",
            RiskLevel::Warn,
            None,
            Some(&metadata),
        )
        .unwrap();

        assert_eq!(payload["tool_call_id"], "tool-1");
        assert_eq!(payload["reason"], "package change is intentional");
        assert_eq!(payload["highRiskFiles"][0], "package.json");
    }

    fn test_step_context(kind: StepKind) -> StepContext {
        StepContext {
            step_id: 1,
            title: "Move auth helper".into(),
            instruction_seed: Some("Move the helper into auth.ts".into()),
            acceptance_criteria: Some("Existing auth behavior still works".into()),
            linked_criterion_ids: vec!["AC-001".into()],
            decomposition_rationale: Some("Keep the behavior scoped to auth.".into()),
            expected_files: Some("src/auth.ts".into()),
            step_kind: kind,
        }
    }

    #[test]
    fn current_card_prompt_adds_verbatim_clause_for_refactor_step() {
        let prompt = build_current_card_system_prompt(
            Some(&test_step_context(StepKind::Refactor)),
            "Refactor card",
            Some("Move helper"),
            Some("en-US"),
        );

        assert!(prompt.contains("move the code verbatim"));
        assert!(prompt.contains("this step must preserve behavior"));
    }

    #[test]
    fn current_card_prompt_omits_verbatim_clause_for_default_feature_step() {
        let prompt = build_current_card_system_prompt(
            Some(&test_step_context(StepKind::Feature)),
            "Feature card",
            Some("Add behavior"),
            Some("en-US"),
        );

        assert!(!prompt.contains("move the code verbatim"));
        assert!(!prompt.contains("preserve behavior"));
    }

    #[test]
    fn current_card_prompt_adds_debug_clause_for_debug_step() {
        let prompt = build_current_card_system_prompt(
            Some(&test_step_context(StepKind::Debug)),
            "Debug card",
            Some("Fix failing save"),
            Some("en-US"),
        );

        assert!(prompt.contains("diagnose before editing"));
        assert!(prompt.contains("make the minimal fix"));
    }
}
