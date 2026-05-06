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
    PendingApprovals, PermissionDecision, PermissionHook, PolicyAwareHook, PolicyHook,
    RunModePermissionHook, SafeOnlyHook,
};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::db::dao::{card, message, workmap};
use crate::db::models::NewMessage;
use crate::db::Database;
use crate::dive::event_log as dive_event_log;
use crate::dive::DiveStage;
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

pub struct AgentLoop {
    pub provider: Arc<dyn LlmProvider>,
    pub registry: Arc<ToolRegistry>,
    pub permission: Arc<dyn PermissionHook>,
    pub db: Arc<Mutex<Database>>,
    pub tool_ctx: ToolContext,
    pub max_iterations: u32,
    pub cancel: Arc<AtomicBool>,
    pub model: String,
    pub stage: DiveStage,
    pub disable_gates: bool,
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
        self.check_gate(session_id, emit)?;

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
            json!({ "stage": self.stage.as_str(), "card_id": current_card_id }),
        )?;
        let mut user_payload = dive_event_log::user_text_metadata(user_input);
        if let Value::Object(map) = &mut user_payload {
            map.insert("stage".into(), json!(self.stage.as_str()));
            map.insert("card_id".into(), json!(current_card_id));
        }
        self.log_event(session_id, "user_message", user_payload)?;

        let mut messages = self.load_history(session_id)?;
        if let Some(prompt) = self.current_card_system_prompt(session_id)? {
            messages.insert(0, ProviderMessage::System { content: prompt });
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

            self.persist_assistant_message(session_id, current_card_id, &content, &tool_calls)?;
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
                self.log_event(
                    session_id,
                    "stage_exit",
                    json!({
                        "stage": self.stage.as_str(),
                        "reason": finish_reason_str(finish_reason),
                    }),
                )?;
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
                    diff_preview,
                    args: args_value.clone(),
                });
                self.log_event(
                    session_id,
                    "tool_call_start",
                    json!({ "tool": tc.name, "params_preview": preview, "risk": risk.as_str() }),
                )?;

                if let Some(tool) = tool_opt.as_ref() {
                    if let Err(crate::tools::ToolError::Blocked(reason)) =
                        tool.validate(&args_value)
                    {
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
                }

                let decision = self.permission.intercept(tc, risk).await;
                match decision {
                    PermissionDecision::Approved { modified_args } => {
                        emit(AgentEvent::ToolCallApproved { id: tc.id.clone() });
                        let effective_args = modified_args.unwrap_or(args_value);
                        self.log_event(
                            session_id,
                            "tool_approve",
                            json!({ "tool": tc.name, "risk": risk.as_str() }),
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
                        let out = match tool.run(effective_args, &self.tool_ctx).await {
                            Ok(out) => out,
                            Err(e) => {
                                let msg = format!("{e}");
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
                        self.record_changed_files(session_id, &tc.name, &out.full)?;
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
    ) -> Result<(String, Vec<ToolCall>, FinishReason), AgentError> {
        let provider = self.provider.clone();
        let mut stream = crate::providers::with_retry(
            || {
                let provider = provider.clone();
                let req = request.clone();
                async move { provider.chat(req).await }
            },
            3,
            std::time::Duration::from_millis(500),
        )
        .await?;
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

    fn check_gate(
        &self,
        session_id: i64,
        emit: &mut (dyn FnMut(AgentEvent) + Send),
    ) -> Result<(), AgentError> {
        if self.disable_gates || crate::dive::gates_disabled_for_research() {
            self.log_event(
                session_id,
                "gate_bypassed",
                json!({
                    "stage": self.stage.as_str(),
                    "reason": "research_ablation"
                }),
            )?;
            return Ok(());
        }
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let decision = crate::dive::DiveGateEngine::check(db.conn(), session_id, self.stage)?;
        drop(db);
        match decision {
            crate::dive::GateDecision::Allow => Ok(()),
            crate::dive::GateDecision::Block { stage, reason } => {
                emit(AgentEvent::Error {
                    message: reason.clone(),
                    retryable: false,
                });
                Err(AgentError::GateBlocked {
                    stage: stage.as_str().into(),
                    reason,
                })
            }
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
    ) -> Result<(), AgentError> {
        let Some(card_id) = self.current_card_id(session_id)? else {
            return Ok(());
        };
        let paths = changed_paths_from_tool_result(tool_name, full);
        if paths.is_empty() {
            return Ok(());
        }
        let db = self
            .db
            .lock()
            .map_err(|_| AgentError::Internal("db mutex poisoned".into()))?;
        let merged = card::append_changed_files(db.conn(), card_id, &paths)?;
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
        let instruction = card.instruction.as_deref().unwrap_or("").trim();
        if instruction.is_empty() {
            Ok(Some(format!("현재 작업 중인 카드: {}", card.title)))
        } else {
            Ok(Some(format!(
                "현재 작업 중인 카드: {}\n지시: {}",
                card.title, instruction
            )))
        }
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
    stage: Option<DiveStage>,
    disable_gates: bool,
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
    pub fn stage(mut self, s: DiveStage) -> Self {
        self.stage = Some(s);
        self
    }
    pub fn disable_gates(mut self, disabled: bool) -> Self {
        self.disable_gates = disabled;
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
            stage: self.stage.unwrap_or(DiveStage::D),
            disable_gates: self.disable_gates,
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
}
