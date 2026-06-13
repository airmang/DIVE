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
    PendingApprovalSnapshot, PendingApprovals, PermissionDecision, PermissionHook,
    PermissionRequestContext, PolicyAwareHook, PolicyHook, RunModePermissionHook, SafeOnlyHook,
};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::dao::{card, message, workmap};
use crate::db::models::NewMessage;
use crate::db::Database;
use crate::dive::build_plan_interview_system_prompt;
use crate::dive::event_log as dive_event_log;
use crate::providers::{
    ChatEvent, ChatRequest, FinishReason, LlmProvider, Message as ProviderMessage, ToolCall,
};
use crate::tools::{params_preview, RiskLevel, ToolContext, ToolRegistry};

const DEFAULT_MAX_ITERATIONS: u32 = 10;

fn changed_paths_from_tool_result(tool_name: &str, full: &Value) -> Vec<String> {
    if !matches!(
        tool_name,
        "write_file" | "edit_file" | "delete_file" | "mkdir"
    ) {
        return Vec::new();
    }
    full.get("path")
        .and_then(Value::as_str)
        .map(|path| vec![path.to_owned()])
        .unwrap_or_default()
}

#[derive(Debug, Clone)]
pub struct StepContext {
    pub step_id: i64,
    pub title: String,
    pub instruction_seed: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub expected_files: Option<String>,
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

        let tool_defs = if self.run_mode == AgentRunMode::Interview {
            Vec::new()
        } else {
            self.registry.tool_defs()
        };
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
                let (risk, tool_opt) = match self.registry.get(&tc.name) {
                    Some(t) => (t.risk_level(), Some(t)),
                    None => (RiskLevel::Warn, None),
                };
                let args_value: Value = serde_json::from_str(&tc.arguments)
                    .map_err(AgentError::ArgumentJson)
                    .unwrap_or_else(|e| {
                        let msg = format!("tool arguments not JSON: {e}");
                        emit(AgentEvent::Error {
                            message: msg,
                            retryable: false,
                        });
                        Value::Object(Default::default())
                    });
                let preview = params_preview(&tc.name, &args_value);
                let diff_preview = self.build_diff_preview(&tc.name, &args_value).await;
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
                    diff_preview: diff_preview.clone(),
                    args: args_value.clone(),
                });
                self.log_event(
                    session_id,
                    "tool_call_start",
                    json!({ "tool": tc.name, "params_preview": preview, "risk": risk.as_str() }),
                )?;

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

                if let Err(crate::tools::ToolError::Blocked(reason)) = tool.validate(&args_value) {
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
                    let msg = format!(
                        "tool call blocked by safety policy: {} (pattern: {})",
                        reason.rule, reason.pattern
                    );
                    messages.push(ProviderMessage::Tool {
                        content: msg,
                        tool_call_id: tc.id.clone(),
                    });
                    continue;
                }

                let decision = self
                    .permission
                    .intercept(
                        tc,
                        risk,
                        PermissionRequestContext {
                            session_id,
                            params_preview: preview.clone(),
                            diff_preview: diff_preview.clone(),
                            args: args_value.clone(),
                        },
                    )
                    .await;
                match decision {
                    PermissionDecision::Approved {
                        modified_args,
                        approval_metadata,
                    } => {
                        emit(AgentEvent::ToolCallApproved { id: tc.id.clone() });
                        let effective_args = modified_args.unwrap_or(args_value);
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
                                    full: json!({ "error": msg.clone() }),
                                });
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
                            diff_preview.as_ref(),
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
                        let tool_content = out.full.to_string();
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
        if self.run_mode == AgentRunMode::Interview {
            Vec::new()
        } else {
            self.registry.tool_defs()
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
        let (risk, tool_opt) = match self.registry.get(&tc.name) {
            Some(t) => (t.risk_level(), Some(t)),
            None => (RiskLevel::Warn, None),
        };
        let args_value: Value = serde_json::from_str(&tc.arguments)
            .map_err(AgentError::ArgumentJson)
            .unwrap_or_else(|e| {
                let msg = format!("tool arguments not JSON: {e}");
                emit(AgentEvent::Error {
                    message: msg,
                    retryable: false,
                });
                Value::Object(Default::default())
            });
        let preview = params_preview(&tc.name, &args_value);
        let diff_preview = self.build_diff_preview(&tc.name, &args_value).await;
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
            diff_preview: diff_preview.clone(),
            args: args_value.clone(),
        });
        self.log_event(
            session_id,
            "tool_call_start",
            json!({ "tool": tc.name, "params_preview": preview, "risk": risk.as_str(), "runtime": "pi_sidecar" }),
        )?;

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

        match tool.validate(&args_value) {
            Ok(()) => {}
            Err(crate::tools::ToolError::Blocked(reason)) => {
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
                let msg = format!(
                    "tool call blocked by safety policy: {} (pattern: {})",
                    reason.rule, reason.pattern
                );
                return Ok(SupervisedToolResult {
                    content: msg.clone(),
                    success: false,
                    summary: msg.clone(),
                    full: json!({ "error": msg }),
                });
            }
            Err(err) => {
                let msg = format!("{err}");
                emit(AgentEvent::ToolResult {
                    call_id: tc.id.clone(),
                    success: false,
                    summary: msg.clone(),
                    full: json!({ "error": msg.clone() }),
                });
                self.log_event(
                    session_id,
                    "tool_error",
                    json!({ "tool": tc.name, "error": msg.clone(), "runtime": "pi_sidecar" }),
                )?;
                return Ok(SupervisedToolResult {
                    content: msg.clone(),
                    success: false,
                    summary: msg.clone(),
                    full: json!({ "error": msg }),
                });
            }
        }

        let decision = self
            .permission
            .intercept(
                tc,
                risk,
                PermissionRequestContext {
                    session_id,
                    params_preview: preview.clone(),
                    diff_preview: diff_preview.clone(),
                    args: args_value.clone(),
                },
            )
            .await;
        match decision {
            PermissionDecision::Approved {
                modified_args,
                approval_metadata,
            } => {
                emit(AgentEvent::ToolCallApproved { id: tc.id.clone() });
                let effective_args = modified_args.unwrap_or(args_value);
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
                let out = match tool.run(effective_args, &self.tool_ctx).await {
                    Ok(out) => out,
                    Err(e) => {
                        let msg = format!("{e}");
                        tracing::warn!(
                            session_id,
                            tool = %tc.name,
                            error = %crate::telemetry::redact_log_text(&msg),
                            runtime = "pi_sidecar",
                            "tool execution failed"
                        );
                        let full = json!({ "error": msg.clone() });
                        emit(AgentEvent::ToolResult {
                            call_id: tc.id.clone(),
                            success: false,
                            summary: msg.clone(),
                            full: full.clone(),
                        });
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
                tracing::info!(
                    session_id,
                    tool = %tc.name,
                    success = out.success,
                    runtime = "pi_sidecar",
                    "tool execution completed"
                );
                self.record_changed_files(session_id, &tc.name, &out.full, diff_preview.as_ref())?;
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
                    content: out.full.to_string(),
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
                if let Some(diff) = diff_preview.filter(|diff| diff.path == *path) {
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
        let mut prompt_parts = Vec::new();
        if let Some(ctx) = &self.step_context {
            prompt_parts.push(format!("현재 작업 단계: {}", ctx.title));
            if let Some(instruction) = &ctx.instruction_seed {
                prompt_parts.push(format!("단계 지시: {}", instruction));
            }
            if let Some(criteria) = &ctx.acceptance_criteria {
                prompt_parts.push(format!("수용 기준: {}", criteria));
            }
            if let Some(files) = &ctx.expected_files {
                prompt_parts.push(format!("예상 변경 파일: {}", files));
            }
            prompt_parts.push(
                "단계 종료 규칙: 수용 기준을 충족했거나 더 이상 필요한 도구 호출이 없으면 즉시 도구 호출을 멈추고 최종 응답으로 변경 내용, 검증/미검증 근거, 남은 리스크를 요약하세요. 같은 정보를 반복 확인하기 위해 동일한 도구 호출을 반복하지 마세요.".to_string(),
            );
        }

        let instruction = card.instruction.as_deref().unwrap_or("").trim();
        if instruction.is_empty() {
            prompt_parts.push(format!("현재 작업 중인 카드: {}", card.title));
        } else {
            prompt_parts.push(format!(
                "현재 작업 중인 카드: {}\n지시: {}",
                card.title, instruction
            ));
        }
        Ok(Some(prompt_parts.join("\n\n")))
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

    async fn build_diff_preview(&self, tool_name: &str, args: &Value) -> Option<DiffPreview> {
        let path = args.get("path")?.as_str()?.to_string();
        match tool_name {
            "write_file" => {
                let after = args.get("content")?.as_str()?.to_string();
                let resolved = self.tool_ctx.fs.resolve_read(&path).ok()?;
                let before = tokio::fs::read_to_string(&resolved)
                    .await
                    .unwrap_or_default();
                Some(DiffPreview {
                    path,
                    before,
                    after,
                })
            }
            "edit_file" => {
                let find = args.get("find")?.as_str()?;
                let replace = args.get("replace")?.as_str()?;
                let resolved = self.tool_ctx.fs.resolve_read(&path).ok()?;
                let before = tokio::fs::read_to_string(&resolved).await.ok()?;
                if !before.contains(find) {
                    return Some(DiffPreview {
                        path,
                        before,
                        after: String::new(),
                    });
                }
                let after = before.replacen(find, replace, 1);
                Some(DiffPreview {
                    path,
                    before,
                    after,
                })
            }
            _ => None,
        }
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
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_paths_extracts_only_mutating_file_tools() {
        assert_eq!(
            changed_paths_from_tool_result("write_file", &json!({"path": "src/App.tsx"})),
            vec!["src/App.tsx"]
        );
        assert!(
            changed_paths_from_tool_result("read_file", &json!({"path": "src/App.tsx"})).is_empty()
        );
        assert!(changed_paths_from_tool_result("bash", &json!({"stdout": "changed"})).is_empty());
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
}
