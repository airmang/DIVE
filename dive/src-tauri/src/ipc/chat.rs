use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::agent::{
    AgentEvent, AgentLoop, AgentRunMode, PendingApprovalSnapshot, PermissionDecision,
    RunModePermissionHook, StepContext,
};
use crate::db::dao::{
    message as message_dao, plan as plan_dao, provider_config as provider_dao, step as step_dao,
    step_session_mapping as mapping_dao,
};
use crate::db::models::MessageRow;
use crate::db::now_ms;
use crate::dive::event_log as dive_event_log;
use crate::tools::ToolContext;

use super::state::ActiveTurnGuard;
use super::{
    app_data_dir_from_environment, log_error_event, AppState, ProviderKind, RuntimeChoice,
};

#[derive(Debug, Clone, Serialize)]
pub struct ChatEventEnvelope {
    pub session_id: i64,
    #[serde(flatten)]
    pub event: AgentEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatHistoryMessage {
    #[serde(rename_all = "camelCase")]
    User {
        id: String,
        created_at: i64,
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    Assistant {
        id: String,
        created_at: i64,
        content: String,
        streaming: bool,
    },
    #[serde(rename_all = "camelCase")]
    System {
        id: String,
        created_at: i64,
        content: String,
    },
}

fn history_message_from_row(row: MessageRow) -> Option<ChatHistoryMessage> {
    let id = format!("db-{}", row.id);
    match row.role.as_str() {
        "user" => Some(ChatHistoryMessage::User {
            id,
            created_at: row.created_at,
            content: row.content,
        }),
        "assistant" => Some(ChatHistoryMessage::Assistant {
            id,
            created_at: row.created_at,
            content: row.content,
            streaming: false,
        }),
        "system" => Some(ChatHistoryMessage::System {
            id,
            created_at: row.created_at,
            content: row.content,
        }),
        _ => None,
    }
}

pub(super) fn backend_run_mode_floor(plan_accepted: bool) -> AgentRunMode {
    if plan_accepted {
        AgentRunMode::Build
    } else {
        AgentRunMode::Plan
    }
}

fn run_mode_strictness(mode: AgentRunMode) -> u8 {
    match mode {
        AgentRunMode::Interview => 0,
        AgentRunMode::Plan => 1,
        AgentRunMode::Verify => 2,
        AgentRunMode::Build => 3,
    }
}

pub(super) fn safest_run_mode(backend: AgentRunMode, requested: AgentRunMode) -> AgentRunMode {
    if run_mode_strictness(requested) <= run_mode_strictness(backend) {
        requested
    } else {
        backend
    }
}

/// `env_override` is `std::env::var("DIVE_RUNTIME").ok()` at the call site
/// (passed in so this is unit-testable). Precedence: legacy override -> Legacy;
/// pi override -> Pi only for providers with a Pi descriptor, otherwise Legacy;
/// no override -> parity allowlist decides.
pub(super) fn select_runtime(kind: ProviderKind, env_override: Option<&str>) -> RuntimeChoice {
    match env_override {
        Some("legacy") => RuntimeChoice::Legacy,
        Some("pi") => {
            if crate::pi_sidecar::parity::pi_provider_descriptor(kind.clone()).is_some() {
                RuntimeChoice::Pi
            } else {
                tracing::warn!(
                    provider = kind.as_str(),
                    "DIVE_RUNTIME=pi ignored because provider has no Pi sidecar support"
                );
                RuntimeChoice::Legacy
            }
        }
        _ => {
            if crate::pi_sidecar::parity::pi_provider_descriptor(kind.clone()).is_some() {
                RuntimeChoice::Pi
            } else {
                RuntimeChoice::Legacy
            }
        }
    }
}

fn runtime_selection_reason(kind: &ProviderKind, choice: RuntimeChoice) -> String {
    match (std::env::var("DIVE_RUNTIME").ok().as_deref(), choice) {
        (Some("legacy"), RuntimeChoice::Legacy) => "DIVE_RUNTIME=legacy forced legacy loop".into(),
        (Some("pi"), RuntimeChoice::Pi) => "DIVE_RUNTIME=pi forced Pi sidecar runtime".into(),
        (Some("pi"), RuntimeChoice::Legacy) => {
            format!("provider {} has no Pi sidecar support", kind.as_str())
        }
        (_, RuntimeChoice::Pi) => "provider is eligible for Pi sidecar runtime".into(),
        (_, RuntimeChoice::Legacy) => {
            format!("provider {} falls back to DIVE legacy loop", kind.as_str())
        }
    }
}

#[tauri::command]
pub async fn pi_sidecar_codex_smoke(
    state: State<'_, AppState>,
    provider_config_id: Option<i64>,
    model: Option<String>,
) -> Result<crate::pi_sidecar::PiSidecarSmokeResult, String> {
    let provider_config_id = match provider_config_id {
        Some(id) => id,
        None => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            provider_dao::list(db.conn())
                .map_err(|e| e.to_string())?
                .into_iter()
                .rev()
                .find(|row| row.kind == "codex")
                .map(|row| row.id)
                .ok_or_else(|| "codex provider not found".to_string())?
        }
    };
    let project_root = state.project_root_required()?;
    crate::pi_sidecar::run_codex_smoke(
        state.keyring.as_ref(),
        provider_config_id,
        project_root,
        model,
    )
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: i64,
    text: String,
    stage: Option<String>,
    run_mode: Option<String>,
    locale: Option<String>,
    plan_accepted: Option<bool>,
    step_id: Option<i64>,
) -> Result<(), String> {
    tracing::info!(
        session_id,
        legacy_stage = stage.as_deref().unwrap_or("default"),
        requested_run_mode = run_mode.as_deref().unwrap_or("default"),
        text_chars = text.chars().count(),
        step_id,
        "ipc chat_send started"
    );
    let requested_plan_accepted = plan_accepted.unwrap_or(false);
    let step_context = load_active_step_context(&state, session_id, step_id)?;
    let active_step_id = step_context.as_ref().map(|ctx| ctx.context.step_id);
    let effective_plan_accepted = requested_plan_accepted
        || step_context
            .as_ref()
            .map(|ctx| ctx.plan_approved)
            .unwrap_or(false);
    let backend_run_mode = backend_run_mode_floor(effective_plan_accepted);
    let requested_run_mode = run_mode.as_deref().and_then(AgentRunMode::parse);
    let run_mode = match requested_run_mode {
        Some(requested) => safest_run_mode(backend_run_mode, requested),
        None => backend_run_mode,
    };
    let active_turn = ActiveTurnGuard::begin(&state, session_id)?;
    let snap = state.ensure_provider_runtime().await?;
    if snap.kind.is_none() {
        let msg = crate::providers::ProviderError::NotConfigured.to_string();
        tracing::warn!(
            session_id,
            "ipc chat_send rejected because provider is not configured"
        );
        let _ = log_error_event(&state, Some(session_id), "provider", &msg);
        return Err(msg);
    }
    let runtime_choice = select_runtime(
        snap.kind.clone(),
        std::env::var("DIVE_RUNTIME").ok().as_deref(),
    );
    let use_pi_sidecar_runtime = runtime_choice == RuntimeChoice::Pi;
    tracing::info!(
        session_id,
        provider = ?snap.kind,
        runtime = ?runtime_choice,
        "ipc chat_send runtime selected"
    );
    let pi_provider_config_id = snap.config_id;
    let project_root = state.project_root_required()?;
    let cancel = active_turn.token();
    let loop_ = AgentLoop::builder()
        .provider(snap.provider)
        .registry(state.registry.clone())
        .permission(Arc::new(
            RunModePermissionHook::new(run_mode, state.permission.clone())
                .with_plan_accepted(effective_plan_accepted)
                .with_active_step_id(step_context.as_ref().map(|ctx| ctx.context.step_id)),
        ))
        .db(state.db.clone())
        .tool_ctx(ToolContext::new(project_root, session_id))
        .model(snap.model)
        .cancel(cancel)
        .run_mode(run_mode)
        .plan_accepted(effective_plan_accepted)
        .locale(locale)
        .step_context(step_context.map(|ctx| ctx.context))
        .build()
        .map_err(|e| e.to_string())?;

    let app_clone = app.clone();
    let mut emit_event = move |evt| {
        let envelope = ChatEventEnvelope {
            session_id,
            event: evt,
        };
        let _ = app_clone.emit(&format!("chat://event/{session_id}"), &envelope);
    };
    emit_event(AgentEvent::RuntimeSelected {
        runtime: match runtime_choice {
            RuntimeChoice::Pi => "pi_sidecar".into(),
            RuntimeChoice::Legacy => "legacy_loop".into(),
        },
        provider: snap.kind.as_str().into(),
        model: loop_.model.clone(),
        reason: runtime_selection_reason(&snap.kind, runtime_choice),
        created_at: now_ms(),
    });
    let res = if use_pi_sidecar_runtime {
        let descriptor = crate::pi_sidecar::parity::pi_provider_descriptor(snap.kind.clone())
            .expect("select_runtime guarantees eligibility");
        let provider_config_id = pi_provider_config_id
            .ok_or_else(|| "provider config id missing for Pi sidecar runtime".to_string())?;
        let runtime_state_root = app_data_dir_from_environment(&app)
            .map_err(|e| e.to_string())?
            .join("runtime");
        std::fs::create_dir_all(&runtime_state_root).map_err(|e| e.to_string())?;
        tracing::info!(
            session_id,
            provider_config_id,
            model = %loop_.model,
            "ipc chat_send using Pi sidecar runtime"
        );
        crate::pi_sidecar::run_supervised_turn(
            state.keyring.as_ref(),
            &descriptor,
            provider_config_id,
            &loop_,
            session_id,
            &text,
            Some(runtime_state_root),
            &mut emit_event,
        )
        .await
        .map(|result| {
            tracing::info!(
                session_id,
                model = %result.model,
                tool_calls_seen = result.tool_calls_seen,
                "Pi sidecar runtime turn completed"
            );
            "stopped:stop".to_string()
        })
    } else {
        loop_.run(session_id, &text, &mut emit_event).await
    };

    match res {
        Ok(_) => {
            tracing::info!(session_id, "ipc chat_send completed");
            Ok(())
        }
        Err(err) => {
            let message = err.to_string();
            tracing::error!(
                session_id,
                error = %crate::telemetry::redact_log_text(&message),
                "ipc chat_send failed"
            );
            if let Some(step_id) = active_step_id {
                let _ = mark_step_blocked_after_recoverable_error(&state, step_id, &message);
            }
            let _ = log_error_event(&state, Some(session_id), "agent_loop", &message);
            Err(message)
        }
    }
}

pub(super) fn mark_step_blocked_after_recoverable_error(
    state: &AppState,
    step_id: i64,
    message: &str,
) -> Result<(), String> {
    let lower = message.to_lowercase();
    let recoverable_provider_error = lower.contains("429")
        || lower.contains("rate limit")
        || lower.contains("quota")
        || lower.contains("freeusagelimiterror")
        || lower.contains("max iterations")
        || lower.contains("repeated tool calls");
    if !recoverable_provider_error {
        return Ok(());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let Some(mapping) = mapping_dao::get_by_step(db.conn(), step_id).map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    if mapping.status == "done" || mapping.status == "shipped" {
        return Ok(());
    }
    mapping_dao::update_status(db.conn(), mapping.id, "blocked").map_err(|e| e.to_string())?;
    let step = step_dao::get_by_id(db.conn(), step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {step_id} not found"))?;
    let plan = plan_dao::get_by_id(db.conn(), step.plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {} not found", step.plan_id))?;
    let _ = dive_event_log::append_to_conn(
        db.conn(),
        mapping.session_id,
        "plan_step_state_changed",
        serde_json::json!({
            "project_id": plan.project_id,
            "plan_id": plan.id,
            "step_id": step.id,
            "stable_step_id": step.step_id,
            "step_title": step.title,
            "message": "Step blocked by provider limit",
            "reason": crate::telemetry::redact_log_text(message),
        }),
    );
    Ok(())
}

struct LoadedStepContext {
    context: StepContext,
    plan_approved: bool,
}

fn load_active_step_context(
    state: &AppState,
    session_id: i64,
    step_id: Option<i64>,
) -> Result<Option<LoadedStepContext>, String> {
    let Some(step_id) = step_id else {
        return Ok(None);
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let step = step_dao::get_by_id(db.conn(), step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {step_id} not found"))?;
    let mapping = mapping_dao::get_by_step(db.conn(), step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {step_id} has no active session mapping"))?;
    if mapping.session_id != Some(session_id) {
        return Err(format!(
            "step {step_id} is not active in session {session_id}"
        ));
    }
    let plan = plan_dao::get_by_id(db.conn(), step.plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {} not found", step.plan_id))?;
    Ok(Some(LoadedStepContext {
        context: StepContext {
            step_id: step.id,
            title: step.title,
            instruction_seed: step.instruction_seed,
            acceptance_criteria: join_json_strings(step.acceptance_criteria.as_ref(), "\n"),
            expected_files: join_json_strings(step.expected_files.as_ref(), ", "),
        },
        plan_approved: plan.status == "approved",
    }))
}

fn join_json_strings(value: Option<&Value>, separator: &str) -> Option<String> {
    let items = value?
        .as_array()?
        .iter()
        .filter_map(|item| item.as_str())
        .collect::<Vec<_>>();
    if items.is_empty() {
        None
    } else {
        Some(items.join(separator))
    }
}

pub(super) fn message_list_impl(
    state: &AppState,
    session_id: i64,
) -> Result<Vec<ChatHistoryMessage>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows =
        message_dao::list_by_session(db.conn(), session_id, 500).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .filter_map(history_message_from_row)
        .collect())
}

#[tauri::command]
pub async fn message_list(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<ChatHistoryMessage>, String> {
    message_list_impl(&state, session_id)
}

#[tauri::command]
pub async fn pending_tool_calls(
    state: State<'_, AppState>,
    session_id: i64,
) -> Result<Vec<PendingApprovalSnapshot>, String> {
    Ok(state.pending_approvals.list_for_session(session_id))
}

#[tauri::command]
pub async fn chat_cancel(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    let guard = state.cancels.lock().map_err(|e| e.to_string())?;
    if let Some(token) = guard.get(&session_id) {
        token.store(true, std::sync::atomic::Ordering::SeqCst);
    }
    drop(guard);
    state.pending_approvals.cancel_session(session_id);
    Ok(())
}

#[tauri::command]
pub async fn tool_approve(
    state: State<'_, AppState>,
    tool_call_id: String,
    modified_args: Option<Value>,
    approval_metadata: Option<Value>,
) -> Result<bool, String> {
    let decision = match modified_args {
        Some(args) => PermissionDecision::approved_with_context(args, approval_metadata),
        None => PermissionDecision::approved_with_metadata(approval_metadata),
    };
    Ok(state.pending_approvals.resolve(&tool_call_id, decision))
}

#[tauri::command]
pub async fn tool_deny(
    state: State<'_, AppState>,
    tool_call_id: String,
    reason: Option<String>,
) -> Result<bool, String> {
    let decision = PermissionDecision::denied(reason.unwrap_or_else(|| "사용자가 거부함".into()));
    Ok(state.pending_approvals.resolve(&tool_call_id, decision))
}
