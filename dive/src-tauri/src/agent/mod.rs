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
pub use event::AgentEvent;
pub use permission::{
    AlwaysApproveHook, AlwaysDenyHook, AutoApprove, AutoApprovePolicy, PermissionDecision,
    PermissionHook, PolicyHook, SafeOnlyHook,
};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::dao::{event_log, message};
use crate::db::models::{NewEventLog, NewMessage};
use crate::db::Database;
use crate::providers::{
    ChatEvent, ChatRequest, FinishReason, LlmProvider, Message as ProviderMessage, ToolCall,
};
use crate::tools::{params_preview, RiskLevel, ToolContext, ToolRegistry};

const DEFAULT_MAX_ITERATIONS: u32 = 10;

pub struct AgentLoop {
    pub provider: Arc<dyn LlmProvider>,
    pub registry: Arc<ToolRegistry>,
    pub permission: Arc<dyn PermissionHook>,
    pub db: Arc<Mutex<Database>>,
    pub tool_ctx: ToolContext,
    pub max_iterations: u32,
    pub cancel: Arc<AtomicBool>,
    pub model: String,
}

pub struct AgentOutcome {
    pub events: Vec<AgentEvent>,
    pub final_reason: String,
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
        self.persist_user_message(session_id, user_input)?;
        emit_and_forward(
            emit,
            AgentEvent::UserMessage {
                id: user_msg_id,
                content: user_input.to_string(),
                created_at,
            },
        );
        self.log_event(session_id, "user_message", json!({ "content": user_input }))?;

        let mut messages = self.load_history(session_id)?;
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

        let tool_defs = self.registry.tool_defs();

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

            let (content, tool_calls, finish_reason) =
                self.stream_assistant(&assistant_id, request, emit).await?;

            self.persist_assistant_message(session_id, &content, &tool_calls)?;
            emit(AgentEvent::AssistantEnd {
                id: assistant_id,
                content: content.clone(),
            });
            self.log_event(
                session_id,
                "assistant_end",
                json!({ "finish_reason": finish_reason_str(finish_reason) }),
            )?;

            messages.push(ProviderMessage::Assistant {
                content: content.clone(),
                tool_calls: if tool_calls.is_empty() {
                    None
                } else {
                    Some(tool_calls.clone())
                },
            });

            if tool_calls.is_empty() {
                return Ok(format!("stopped:{}", finish_reason_str(finish_reason)));
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
                emit(AgentEvent::ToolCallStart {
                    id: tc.id.clone(),
                    tool: tc.name.clone(),
                    params_preview: preview.clone(),
                    risk,
                });
                self.log_event(
                    session_id,
                    "tool_call_start",
                    json!({ "tool": tc.name, "params_preview": preview, "risk": risk.as_str() }),
                )?;

                let decision = self.permission.intercept(tc, risk).await;
                match decision {
                    PermissionDecision::Approved => {
                        emit(AgentEvent::ToolCallApproved { id: tc.id.clone() });
                        let Some(tool) = tool_opt else {
                            let msg = format!("tool '{}' not registered", tc.name);
                            emit(AgentEvent::ToolResult {
                                call_id: tc.id.clone(),
                                success: false,
                                summary: msg.clone(),
                                full: json!({ "error": msg }),
                            });
                            messages.push(ProviderMessage::Tool {
                                content: msg,
                                tool_call_id: tc.id.clone(),
                            });
                            continue;
                        };
                        let out = match tool.run(args_value, &self.tool_ctx).await {
                            Ok(out) => out,
                            Err(e) => {
                                let msg = format!("{e}");
                                emit(AgentEvent::ToolResult {
                                    call_id: tc.id.clone(),
                                    success: false,
                                    summary: msg.clone(),
                                    full: json!({ "error": msg }),
                                });
                                self.log_event(
                                    session_id,
                                    "tool_error",
                                    json!({ "tool": tc.name, "error": msg }),
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
                        self.log_event(
                            session_id,
                            "tool_result",
                            json!({
                                "tool": tc.name,
                                "success": out.success,
                                "summary": out.summary,
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
                            json!({ "tool": tc.name, "reason": reason }),
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
                return Err(AgentError::MaxIterations(self.max_iterations));
            }
        }

        emit(AgentEvent::Done {
            reason: "max_iterations".into(),
        });
        Err(AgentError::MaxIterations(self.max_iterations))
    }

    async fn stream_assistant(
        &self,
        assistant_id: &str,
        request: ChatRequest,
        emit: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<(String, Vec<ToolCall>, FinishReason), AgentError> {
        let mut stream = self.provider.chat(request).await?;
        let mut content = String::new();
        let mut pending_tool_calls: Vec<PendingToolCall> = Vec::new();
        let mut finish_reason = FinishReason::Stop;

        while let Some(event) = stream.next().await {
            self.check_cancel()?;
            match event {
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

        Ok((content, tool_calls, finish_reason))
    }

    fn persist_user_message(&self, session_id: i64, content: &str) -> Result<i64, AgentError> {
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let id = message::insert(
            db.conn(),
            &NewMessage {
                session_id,
                card_id: None,
                role: "user".into(),
                content: content.to_string(),
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
        content: &str,
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
                card_id: None,
                role: "assistant".into(),
                content: content.to_string(),
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
        event_log::append(
            db.conn(),
            &NewEventLog {
                session_id: Some(session_id),
                r#type: kind.into(),
                payload,
            },
        )?;
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
            model: self.model.unwrap_or_else(|| "mock-model".into()),
        })
    }
}
