use std::path::PathBuf;
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
use crate::db::models::{
    MessageRow, RuntimeCapabilityState, RuntimeCapabilityStatus, RuntimeSetupAction,
    RuntimeUnavailableReason,
};
use crate::db::now_ms;
use crate::dive::event_log as dive_event_log;
use crate::tools::ToolContext;

use super::state::ActiveTurnGuard;
use super::{
    app_data_dir_from_environment, log_error_event, log_event, AppState, ProviderKind,
    ProviderRuntime, RuntimeChoice,
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

fn runtime_unavailable_reason_code(reason: RuntimeUnavailableReason) -> &'static str {
    match reason {
        RuntimeUnavailableReason::ProviderNotConfigured => "provider_not_configured",
        RuntimeUnavailableReason::ProviderNotPiCapable => "provider_not_pi_capable",
        RuntimeUnavailableReason::LegacyRequested => "legacy_requested",
        RuntimeUnavailableReason::MissingCredentials => "missing_credentials",
        RuntimeUnavailableReason::MissingProjectRoot => "missing_project_root",
        RuntimeUnavailableReason::RuntimeUnavailable => "runtime_unavailable",
    }
}

fn runtime_setup_action_code(action: RuntimeSetupAction) -> &'static str {
    match action {
        RuntimeSetupAction::ConfigureProvider => "configure_provider",
        RuntimeSetupAction::ChooseSupportedProvider => "choose_supported_provider",
        RuntimeSetupAction::AddCredentials => "add_credentials",
        RuntimeSetupAction::OpenProject => "open_project",
        RuntimeSetupAction::RetryRuntime => "retry_runtime",
    }
}

fn ready_runtime_capability(
    kind: &ProviderKind,
    model: Option<&str>,
    recorded_at: i64,
) -> RuntimeCapabilityState {
    RuntimeCapabilityState {
        state: RuntimeCapabilityStatus::Ready,
        provider_kind: kind.as_str().into(),
        model: model.map(str::to_owned),
        reason_code: None,
        message: "Supervised Pi runtime ready.".into(),
        setup_action: None,
        recorded_at,
    }
}

fn unavailable_runtime_capability(
    kind: &ProviderKind,
    model: Option<&str>,
    reason_code: RuntimeUnavailableReason,
    message: impl Into<String>,
    setup_action: Option<RuntimeSetupAction>,
    recorded_at: i64,
) -> RuntimeCapabilityState {
    RuntimeCapabilityState {
        state: RuntimeCapabilityStatus::Unavailable,
        provider_kind: kind.as_str().into(),
        model: model.map(str::to_owned),
        reason_code: Some(reason_code),
        message: message.into(),
        setup_action,
        recorded_at,
    }
}

fn provider_not_pi_capable_capability(
    kind: &ProviderKind,
    model: Option<&str>,
    recorded_at: i64,
) -> RuntimeCapabilityState {
    unavailable_runtime_capability(
        kind,
        model,
        RuntimeUnavailableReason::ProviderNotPiCapable,
        format!(
            "Provider {} does not have confirmed Pi runtime support.",
            kind.as_str()
        ),
        Some(RuntimeSetupAction::ChooseSupportedProvider),
        recorded_at,
    )
}

/// `env_override` is `std::env::var("DIVE_RUNTIME").ok()` at the call site
/// (passed in so this is unit-testable). V2 user work never selects the legacy
/// loop: unsupported providers or legacy overrides become blocked capability
/// states before a turn can start.
pub(super) fn select_runtime_at(
    kind: ProviderKind,
    model: Option<&str>,
    has_provider_config: bool,
    env_override: Option<&str>,
    recorded_at: i64,
) -> RuntimeChoice {
    match env_override {
        Some("legacy") => RuntimeChoice::Blocked {
            capability: unavailable_runtime_capability(
                &kind,
                model,
                RuntimeUnavailableReason::LegacyRequested,
                "The requested runtime is unavailable for DIVE v2 work.",
                Some(RuntimeSetupAction::RetryRuntime),
                recorded_at,
            ),
        },
        Some("pi") => {
            if crate::pi_sidecar::parity::pi_provider_descriptor(kind.clone()).is_some() {
                if has_provider_config {
                    RuntimeChoice::Pi {
                        capability: ready_runtime_capability(&kind, model, recorded_at),
                    }
                } else {
                    RuntimeChoice::Blocked {
                        capability: unavailable_runtime_capability(
                            &kind,
                            model,
                            RuntimeUnavailableReason::MissingCredentials,
                            "Provider credentials are missing or unavailable.",
                            Some(RuntimeSetupAction::AddCredentials),
                            recorded_at,
                        ),
                    }
                }
            } else {
                tracing::warn!(
                    provider = kind.as_str(),
                    "DIVE_RUNTIME=pi ignored because provider has no Pi sidecar support"
                );
                RuntimeChoice::Blocked {
                    capability: provider_not_pi_capable_capability(&kind, model, recorded_at),
                }
            }
        }
        _ => {
            if crate::pi_sidecar::parity::pi_provider_descriptor(kind.clone()).is_some() {
                if has_provider_config {
                    RuntimeChoice::Pi {
                        capability: ready_runtime_capability(&kind, model, recorded_at),
                    }
                } else {
                    RuntimeChoice::Blocked {
                        capability: unavailable_runtime_capability(
                            &kind,
                            model,
                            RuntimeUnavailableReason::MissingCredentials,
                            "Provider credentials are missing or unavailable.",
                            Some(RuntimeSetupAction::AddCredentials),
                            recorded_at,
                        ),
                    }
                }
            } else {
                RuntimeChoice::Blocked {
                    capability: provider_not_pi_capable_capability(&kind, model, recorded_at),
                }
            }
        }
    }
}

pub(super) fn select_runtime(kind: ProviderKind, env_override: Option<&str>) -> RuntimeChoice {
    select_runtime_at(kind, None, true, env_override, now_ms())
}

fn runtime_selection_reason() -> String {
    match std::env::var("DIVE_RUNTIME").ok().as_deref() {
        Some("pi") => "DIVE_RUNTIME=pi selected supervised Pi runtime".into(),
        _ => "provider is eligible for supervised Pi runtime".into(),
    }
}

fn runtime_capability_event_payload(capability: &RuntimeCapabilityState) -> serde_json::Value {
    dive_event_log::runtime_capability_evaluated_payload(
        match capability.state {
            RuntimeCapabilityStatus::Ready => "ready",
            RuntimeCapabilityStatus::Unavailable => "unavailable",
        },
        capability.provider_kind.clone(),
        capability.model.clone(),
        capability
            .reason_code
            .map(runtime_unavailable_reason_code)
            .map(str::to_owned),
        capability
            .setup_action
            .map(runtime_setup_action_code)
            .map(str::to_owned),
        capability.message.clone(),
        capability.recorded_at,
    )
}

fn record_runtime_capability(
    state: &AppState,
    session_id: i64,
    capability: &RuntimeCapabilityState,
) {
    let _ = log_event(
        state,
        Some(session_id),
        dive_event_log::RUNTIME_CAPABILITY_EVALUATED_EVENT,
        runtime_capability_event_payload(capability),
    );
}

fn emit_chat_event(app: &AppHandle, session_id: i64, evt: AgentEvent) {
    let envelope = ChatEventEnvelope {
        session_id,
        event: evt,
    };
    let _ = app.emit(&format!("chat://event/{session_id}"), &envelope);
}

fn emit_blocked_runtime_capability(
    app: &AppHandle,
    state: &AppState,
    session_id: i64,
    capability: RuntimeCapabilityState,
) -> Result<(), String> {
    record_runtime_capability(state, session_id, &capability);
    emit_chat_event(
        app,
        session_id,
        AgentEvent::RuntimeCapabilityEvaluated {
            capability: capability.clone(),
        },
    );
    Err(capability.message)
}

fn missing_provider_runtime_capability(
    state: &AppState,
    recorded_at: i64,
) -> RuntimeCapabilityState {
    let latest_config = state
        .db
        .lock()
        .ok()
        .and_then(|db| provider_dao::list(db.conn()).ok())
        .and_then(|rows| rows.into_iter().last());
    if let Some(row) = latest_config {
        let kind = ProviderKind::parse(&row.kind);
        let model = crate::providers::normalize_model_for_kind(
            &row.kind,
            row.config
                .get("selected_model")
                .or_else(|| row.config.get("model"))
                .and_then(|value| value.as_str()),
        );
        unavailable_runtime_capability(
            &kind,
            Some(&model),
            RuntimeUnavailableReason::MissingCredentials,
            "Provider credentials are missing or unavailable.",
            Some(RuntimeSetupAction::AddCredentials),
            recorded_at,
        )
    } else {
        unavailable_runtime_capability(
            &ProviderKind::None,
            None,
            RuntimeUnavailableReason::ProviderNotConfigured,
            "No AI provider is configured.",
            Some(RuntimeSetupAction::ConfigureProvider),
            recorded_at,
        )
    }
}

fn runtime_credentials_available(
    state: &AppState,
    descriptor: &crate::pi_sidecar::parity::PiProviderDescriptor,
    provider_config_id: i64,
) -> Result<bool, String> {
    match descriptor.credential_mode {
        crate::pi_sidecar::parity::CredentialMode::OauthFile => {
            crate::auth::load_codex_tokens(state.keyring.as_ref(), provider_config_id)
                .map(|tokens| tokens.is_some())
                .map_err(|err| format!("keyring: {err}"))
        }
        crate::pi_sidecar::parity::CredentialMode::ApiKey => {
            crate::auth::load_provider_api_key(state.keyring.as_ref(), provider_config_id)
                .map(|key| key.is_some())
                .map_err(|err| format!("keyring: {err}"))
        }
    }
}

struct ChatRuntimeGate {
    snap: ProviderRuntime,
    capability: RuntimeCapabilityState,
    descriptor: crate::pi_sidecar::parity::PiProviderDescriptor,
    provider_config_id: i64,
    project_root: PathBuf,
}

async fn evaluate_chat_runtime_gate(
    state: &AppState,
    env_override: Option<&str>,
    recorded_at: i64,
) -> Result<ChatRuntimeGate, RuntimeCapabilityState> {
    let snap = match state.ensure_provider_runtime().await {
        Ok(snap) => snap,
        Err(err) => {
            let snapshot = state.runtime_snapshot();
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "chat runtime gate rejected because provider runtime is unavailable"
            );
            return Err(unavailable_runtime_capability(
                &snapshot.kind,
                Some(&snapshot.model),
                RuntimeUnavailableReason::RuntimeUnavailable,
                "The supervised runtime is unavailable.",
                Some(RuntimeSetupAction::RetryRuntime),
                recorded_at,
            ));
        }
    };
    if snap.kind.is_none() {
        tracing::warn!("chat runtime gate rejected because provider is not configured");
        return Err(missing_provider_runtime_capability(state, recorded_at));
    }

    let runtime_choice = select_runtime_at(
        snap.kind.clone(),
        Some(&snap.model),
        snap.config_id.is_some(),
        env_override,
        recorded_at,
    );
    tracing::info!(
        provider = ?snap.kind,
        runtime = ?runtime_choice,
        "chat runtime gate selected runtime capability"
    );
    let capability = match runtime_choice {
        RuntimeChoice::Pi { capability } => capability,
        RuntimeChoice::Blocked { capability } => return Err(capability),
    };

    let project_root = match state.project_root_required() {
        Ok(root) => root,
        Err(err) => {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "chat runtime gate rejected because project root is missing"
            );
            return Err(unavailable_runtime_capability(
                &snap.kind,
                Some(&snap.model),
                RuntimeUnavailableReason::MissingProjectRoot,
                "Select a project before starting work.",
                Some(RuntimeSetupAction::OpenProject),
                recorded_at,
            ));
        }
    };

    let descriptor = crate::pi_sidecar::parity::pi_provider_descriptor(snap.kind.clone())
        .expect("select_runtime_at guarantees eligibility");
    let provider_config_id = snap
        .config_id
        .expect("select_runtime_at blocks missing provider config id");
    match runtime_credentials_available(state, &descriptor, provider_config_id) {
        Ok(true) => {}
        Ok(false) => {
            tracing::warn!(
                provider_config_id,
                provider = snap.kind.as_str(),
                "chat runtime gate rejected because provider credentials are missing"
            );
            return Err(unavailable_runtime_capability(
                &snap.kind,
                Some(&snap.model),
                RuntimeUnavailableReason::MissingCredentials,
                "Provider credentials are missing or unavailable.",
                Some(RuntimeSetupAction::AddCredentials),
                recorded_at,
            ));
        }
        Err(err) => {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "chat runtime gate rejected because runtime credential check failed"
            );
            return Err(unavailable_runtime_capability(
                &snap.kind,
                Some(&snap.model),
                RuntimeUnavailableReason::RuntimeUnavailable,
                "The supervised runtime is unavailable.",
                Some(RuntimeSetupAction::RetryRuntime),
                recorded_at,
            ));
        }
    }

    Ok(ChatRuntimeGate {
        snap,
        capability,
        descriptor,
        provider_config_id,
        project_root,
    })
}

#[cfg(any(test, feature = "dev-mock"))]
pub async fn chat_runtime_capability_state_for_test(
    state: &AppState,
    env_override: Option<&str>,
    recorded_at: i64,
) -> RuntimeCapabilityState {
    match evaluate_chat_runtime_gate(state, env_override, recorded_at).await {
        Ok(gate) => gate.capability,
        Err(capability) => capability,
    }
}

#[cfg(any(test, feature = "dev-mock"))]
pub fn runtime_capability_event_payload_for_test(
    capability: &RuntimeCapabilityState,
) -> serde_json::Value {
    runtime_capability_event_payload(capability)
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
        requested_stage = stage.as_deref().unwrap_or("default"),
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
    let runtime_gate = match evaluate_chat_runtime_gate(
        &state,
        std::env::var("DIVE_RUNTIME").ok().as_deref(),
        now_ms(),
    )
    .await
    {
        Ok(gate) => gate,
        Err(capability) => {
            return emit_blocked_runtime_capability(&app, &state, session_id, capability)
        }
    };
    record_runtime_capability(&state, session_id, &runtime_gate.capability);
    let snap = runtime_gate.snap;
    let project_root = runtime_gate.project_root;
    let descriptor = runtime_gate.descriptor;
    let provider_config_id = runtime_gate.provider_config_id;
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
        emit_chat_event(&app_clone, session_id, evt);
    };
    emit_event(AgentEvent::RuntimeSelected {
        runtime: "pi_sidecar".into(),
        provider: snap.kind.as_str().into(),
        model: loop_.model.clone(),
        reason: runtime_selection_reason(),
        created_at: now_ms(),
    });
    let res = {
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
