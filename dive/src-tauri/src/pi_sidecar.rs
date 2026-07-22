use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
#[cfg(test)]
use std::sync::Arc;
#[cfg(test)]
use std::sync::{Mutex, OnceLock};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration, Instant};

use crate::agent::{event::AgentProgressKind, AgentError, AgentEvent, AgentLoop};
#[cfg(test)]
use crate::auth;
use crate::auth::Keyring;
use crate::providers::{FinishReason, Message as ProviderMessage, ToolCall, ToolDef};

mod command;
mod credential;
mod model_registry;
mod protocol;
mod runtime_state;
mod transport;

pub mod parity;

#[cfg(test)]
use command::set_test_sidecar_script_path;
use command::{bundled_sidecar_path, resolve_sidecar_command, SidecarCommand};
use credential::{now_epoch_ms, prepare_runtime_credential};
// Startup hygiene: sweep dive-pi-sidecar-* temp dirs stranded by a prior
// process exit that skipped `TempAuthDir::drop` (see credential.rs). Call
// once during app setup, before the first turn.
pub(crate) use credential::sweep_stale_temp_auth_dirs;
// QA smoke harness only (see `run_codex_smoke` below, S-060) — no production caller.
#[cfg(test)]
use credential::{file_mode_string, load_codex_auth_entry, write_codex_auth_file, TempAuthDir};
pub use model_registry::PiModelRegistryCache;
#[cfg(test)]
use parity::CredentialMode;
use parity::PiProviderDescriptor;
use protocol::{assert_supervisor_ready_boundary, map_sidecar_delta_event, SidecarEvent};
pub use runtime_state::PiRuntimeState;
use runtime_state::{
    mark_active_step_blocked_by_pi_runtime_error, runtime_state_path, write_runtime_state,
    RUNTIME_STATE_PROTOCOL_VERSION,
};
#[cfg(test)]
use transport::set_test_sidecar_timing;
use transport::{
    next_sidecar_event, next_sidecar_event_during_tool, redact_line, send_sidecar_cancel,
    sidecar_timing, spawn_sidecar, spawn_sidecar_stdout_reader, wait_for_cancel, SpawnedSidecar,
    SIDECAR_STDOUT_CLOSED,
};

const PROVIDER_ID: &str = "openai-codex";
// QA smoke harness only (see `run_codex_smoke` below, S-060) — no production caller.
#[cfg(test)]
const DEFAULT_MODEL: &str = "gpt-5.4-mini";
#[cfg(test)]
const SMOKE_MARKER: &str = "DIVE_PI_SIDECAR_TOOL_OK";
#[cfg(test)]
const SMOKE_PROMPT: &str = "Use the dive_context tool exactly once with request \"phase2-smoke\". After the tool result, reply exactly DIVE_PI_SIDECAR_TOOL_OK and nothing else.";
const PI_TURN_TIMEOUT: Duration = Duration::from_secs(120);
const SUPERVISOR_TURN_TIMEOUT_DEFAULT_MS: u64 = 12_000;
const SUPERVISOR_TURN_TIMEOUT_MIN_MS: u64 = 1_200;
const SUPERVISOR_TURN_TIMEOUT_MAX_MS: u64 = 15_000;
pub const SUPERVISOR_TURN_TIMEOUT: Duration =
    Duration::from_millis(SUPERVISOR_TURN_TIMEOUT_DEFAULT_MS);
const SIDECAR_HEARTBEAT_STALL_TIMEOUT: Duration = Duration::from_secs(20);
const SIDECAR_CANCELLED: &str = "pi sidecar turn cancelled";
const PROGRESS_EVENT_MIN_INTERVAL: Duration = Duration::from_secs(5);
/// Cap on sidecar events buffered while a DIVE tool is executing. Legitimate parallel
/// tool calls stay well under this; exceeding it fails the turn (retryable) instead of
/// letting the buffer grow unbounded under a misbehaving sidecar.
const MAX_BUFFERED_SIDECAR_EVENTS: usize = 256;

fn new_sidecar_process(sidecar_cmd: &SidecarCommand) -> Command {
    let mut command = Command::new(&sidecar_cmd.program);
    command.args(&sidecar_cmd.prefix_args);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PiSidecarSmokeResult {
    pub provider_config_id: i64,
    pub model: String,
    pub auth_file_mode: String,
    pub enabled_tools: Vec<String>,
    pub tool_calls_seen: usize,
    pub assistant_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PiSidecarTurnResult {
    pub provider_config_id: i64,
    pub model: String,
    pub auth_file_mode: String,
    pub enabled_tools: Vec<String>,
    pub tool_calls_seen: usize,
    pub assistant_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PiSidecarSupervisorTurnResult {
    pub provider_config_id: i64,
    pub model: String,
    pub auth_file_mode: String,
    pub enabled_tools: Vec<String>,
    pub assistant_text: String,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PiSidecarSupervisorErrorKind {
    RuntimeUnavailable,
    CredentialUnavailable,
    SidecarUnavailable,
    Timeout,
    SidecarError,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PiSidecarSupervisorError {
    pub kind: PiSidecarSupervisorErrorKind,
    pub message: String,
    pub latency_ms: u64,
}

impl PiSidecarSupervisorError {
    fn credential_unavailable(message: impl Into<String>, started: Instant) -> Self {
        Self {
            kind: PiSidecarSupervisorErrorKind::CredentialUnavailable,
            message: message.into(),
            latency_ms: duration_ms(started.elapsed()),
        }
    }

    fn sidecar_unavailable(message: impl Into<String>, started: Instant) -> Self {
        Self {
            kind: PiSidecarSupervisorErrorKind::SidecarUnavailable,
            message: message.into(),
            latency_ms: duration_ms(started.elapsed()),
        }
    }

    fn timeout(message: impl Into<String>, started: Instant) -> Self {
        Self {
            kind: PiSidecarSupervisorErrorKind::Timeout,
            message: message.into(),
            latency_ms: duration_ms(started.elapsed()),
        }
    }

    fn sidecar_error(message: impl Into<String>, started: Instant) -> Self {
        Self {
            kind: PiSidecarSupervisorErrorKind::SidecarError,
            message: message.into(),
            latency_ms: duration_ms(started.elapsed()),
        }
    }
}

// QA smoke harness — no production caller since the `pi_sidecar_codex_smoke`
// tauri command was removed (S-060); only the ignored
// `live_codex_smoke_uses_dive_keyring_and_custom_tool` unit test invokes this,
// run manually against real Codex OAuth credentials.
#[cfg(test)]
pub async fn run_codex_smoke(
    keyring: &dyn Keyring,
    provider_config_id: i64,
    cwd: PathBuf,
    model: Option<String>,
) -> Result<PiSidecarSmokeResult, String> {
    let (access_token, refresh_token, account_id, expires) =
        load_codex_auth_entry(keyring, provider_config_id)?;
    let temp = TempAuthDir::create()?;
    std::fs::create_dir_all(temp.agent_dir()).map_err(|e| format!("agent dir: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(temp.agent_dir(), std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("chmod agent dir: {e}"))?;
    }
    write_codex_auth_file(
        &temp.auth_path(),
        &access_token,
        &refresh_token,
        expires,
        &account_id,
    )?;

    let auth_file_mode = file_mode_string(&temp.auth_path())?;
    let model = model.unwrap_or_else(|| DEFAULT_MODEL.to_string());
    let request_id = uuid::Uuid::new_v4().to_string();
    let sidecar_cmd = resolve_sidecar_command(bundled_sidecar_path())?;

    let SpawnedSidecar {
        mut child,
        mut stdin,
        stdout,
        stderr_task,
    } = spawn_sidecar(&sidecar_cmd, "spawn pi sidecar")?;

    let run_message = json!({
        "type": "run",
        "request_id": request_id,
        "auth_path": temp.auth_path().display().to_string(),
        "agent_dir": temp.agent_dir().display().to_string(),
        "cwd": cwd.display().to_string(),
        "provider": PROVIDER_ID,
        "model": model,
        "prompt": SMOKE_PROMPT,
    });
    stdin
        .write_all(format!("{run_message}\n").as_bytes())
        .await
        .map_err(|e| format!("write sidecar run message: {e}"))?;

    let mut reader = BufReader::new(stdout).lines();
    let mut enabled_tools = Vec::new();
    let mut ready_model = format!("{PROVIDER_ID}/{model}");
    let mut tool_calls_seen = 0usize;
    let mut assistant_text = String::new();

    let read_loop = async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|e| format!("read sidecar event: {e}"))?
        {
            let event: SidecarEvent = serde_json::from_str(&line)
                .map_err(|e| format!("parse sidecar event: {e}: {}", redact_line(&line)))?;
            match event {
                SidecarEvent::Ready {
                    model,
                    enabled_tools: tools,
                } => {
                    ready_model = model;
                    enabled_tools = tools;
                }
                SidecarEvent::ToolCall {
                    tool_call_id, name, ..
                } => {
                    if name != "dive_context" {
                        return Err(format!("unexpected sidecar tool call: {name}"));
                    }
                    tool_calls_seen += 1;
                    let result = json!({
                        "type": "tool_result",
                        "tool_call_id": tool_call_id,
                        "success": true,
                        "content": "DIVE sidecar context acknowledged for phase2-smoke.",
                        "details": {
                            "source": "dive-tauri",
                            "phase": "S-005-PH-2"
                        }
                    });
                    stdin
                        .write_all(format!("{result}\n").as_bytes())
                        .await
                        .map_err(|e| format!("write sidecar tool result: {e}"))?;
                }
                SidecarEvent::AssistantDelta { delta } => {
                    assistant_text.push_str(&delta);
                }
                SidecarEvent::ReasoningDelta { .. }
                | SidecarEvent::ToolCallEnd { .. }
                | SidecarEvent::Heartbeat { .. } => {}
                SidecarEvent::TurnSucceeded {
                    assistant_text: text,
                } => {
                    if !text.trim().is_empty() {
                        assistant_text = text;
                    }
                    break;
                }
                SidecarEvent::Error { message } => {
                    return Err(format!("pi sidecar error: {message}"));
                }
                SidecarEvent::ListModelsResult { .. } => {
                    return Err("unexpected list_models_result during a run turn".to_string());
                }
            }
        }
        Ok::<(), String>(())
    };

    timeout(PI_TURN_TIMEOUT, read_loop)
        .await
        .map_err(|_| "pi sidecar smoke timed out".to_string())??;
    drop(stdin);

    let status = child
        .wait()
        .await
        .map_err(|e| format!("wait pi sidecar: {e}"))?;
    let stderr_lines = stderr_task.await.unwrap_or_default();
    if !status.success() {
        return Err(format!(
            "pi sidecar exited with {status}; stderr={}",
            stderr_lines.join("\\n")
        ));
    }

    if enabled_tools != ["dive_context"] {
        return Err(format!(
            "unexpected enabled tools from Pi sidecar: {:?}",
            enabled_tools
        ));
    }
    if tool_calls_seen == 0 {
        return Err("Pi sidecar smoke did not call DIVE custom tool".to_string());
    }
    if assistant_text.trim() != SMOKE_MARKER {
        return Err(format!(
            "unexpected assistant text from Pi sidecar: {:?}",
            assistant_text.trim()
        ));
    }

    Ok(PiSidecarSmokeResult {
        provider_config_id,
        model: ready_model,
        auth_file_mode,
        enabled_tools,
        tool_calls_seen,
        assistant_text: assistant_text.trim().to_string(),
    })
}

pub async fn run_supervisor_turn(
    keyring: &dyn Keyring,
    descriptor: &PiProviderDescriptor,
    provider_config_id: i64,
    cwd: PathBuf,
    model: String,
    prompt: String,
    timeout_budget: Duration,
) -> Result<PiSidecarSupervisorTurnResult, PiSidecarSupervisorError> {
    let started = Instant::now();
    let credential = prepare_runtime_credential(keyring, descriptor, provider_config_id)
        .map_err(|err| PiSidecarSupervisorError::credential_unavailable(err, started))?;
    let auth_file_mode = credential.auth_file_mode().to_string();
    let request_id = uuid::Uuid::new_v4().to_string();
    let sidecar_cmd = resolve_sidecar_command(bundled_sidecar_path())
        .map_err(|err| PiSidecarSupervisorError::sidecar_unavailable(err, started))?;
    let cwd = cwd.display().to_string();
    let tools: Vec<ToolDef> = Vec::new();

    let SpawnedSidecar {
        mut child,
        mut stdin,
        stdout,
        stderr_task,
    } = spawn_sidecar(&sidecar_cmd, "spawn pi sidecar")
        .map_err(|err| PiSidecarSupervisorError::sidecar_unavailable(err, started))?;

    let run_message = build_run_message(
        &request_id,
        descriptor,
        &model,
        &cwd,
        credential.auth_path(),
        credential.api_key(),
        &prompt,
        &tools,
    );
    stdin
        .write_all(format!("{run_message}\n").as_bytes())
        .await
        .map_err(|err| {
            PiSidecarSupervisorError::sidecar_error(
                format!("write sidecar run message: {err}"),
                started,
            )
        })?;

    let mut reader = BufReader::new(stdout).lines();
    let mut enabled_tools = Vec::new();
    let mut ready_seen = false;
    let mut ready_model = format!("{}/{model}", descriptor.pi_provider_id);
    let mut assistant_text = String::new();

    let read_loop = async {
        while let Some(line) = reader
            .next_line()
            .await
            .map_err(|err| format!("read sidecar event: {err}"))?
        {
            let event: SidecarEvent = serde_json::from_str(&line)
                .map_err(|err| format!("parse sidecar event: {err}: {}", redact_line(&line)))?;
            match event {
                SidecarEvent::Ready {
                    model,
                    enabled_tools: tools,
                } => {
                    assert_supervisor_ready_boundary(&tools)?;
                    ready_seen = true;
                    ready_model = model;
                    enabled_tools = tools;
                }
                SidecarEvent::ToolCall { name, .. } => {
                    return Err(format!(
                        "SupervisorAgent attempted unexpected tool call: {name}"
                    ));
                }
                SidecarEvent::AssistantDelta { delta } => {
                    assistant_text.push_str(&delta);
                }
                SidecarEvent::ReasoningDelta { .. }
                | SidecarEvent::ToolCallEnd { .. }
                | SidecarEvent::Heartbeat { .. } => {}
                SidecarEvent::TurnSucceeded {
                    assistant_text: text,
                } => {
                    if !text.trim().is_empty() {
                        assistant_text = text;
                    }
                    break;
                }
                SidecarEvent::Error { message } => {
                    return Err(format!("pi sidecar error: {message}"));
                }
                SidecarEvent::ListModelsResult { .. } => {
                    return Err("unexpected list_models_result during a run turn".to_string());
                }
            }
        }
        if !ready_seen {
            return Err("SupervisorAgent sidecar completed without ready event".to_string());
        }
        Ok::<(), String>(())
    };

    match timeout(timeout_budget, read_loop).await {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            send_sidecar_cancel(&mut stdin, &request_id, "supervisor_error").await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stderr_task.await;
            return Err(PiSidecarSupervisorError::sidecar_error(err, started));
        }
        Err(_) => {
            send_sidecar_cancel(&mut stdin, &request_id, "supervisor_timeout").await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stderr_task.await;
            return Err(PiSidecarSupervisorError::timeout(
                "pi supervisor turn timed out",
                started,
            ));
        }
    }
    drop(stdin);

    let status = child.wait().await.map_err(|err| {
        PiSidecarSupervisorError::sidecar_error(format!("wait pi sidecar: {err}"), started)
    })?;
    let stderr_lines = stderr_task.await.unwrap_or_default();
    if !status.success() {
        return Err(PiSidecarSupervisorError::sidecar_error(
            format!(
                "pi sidecar exited with {status}; stderr={}",
                stderr_lines.join("\\n")
            ),
            started,
        ));
    }
    assert_supervisor_ready_boundary(&enabled_tools)
        .map_err(|err| PiSidecarSupervisorError::sidecar_error(err, started))?;

    Ok(PiSidecarSupervisorTurnResult {
        provider_config_id,
        model: ready_model,
        auth_file_mode,
        enabled_tools,
        assistant_text: assistant_text.trim().to_string(),
        latency_ms: duration_ms(started.elapsed()),
        usage: None,
    })
}

pub fn supervisor_turn_timeout() -> Duration {
    std::env::var("DIVE_SUPERVISOR_TURN_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .map(|ms| {
            ms.clamp(
                SUPERVISOR_TURN_TIMEOUT_MIN_MS,
                SUPERVISOR_TURN_TIMEOUT_MAX_MS,
            )
        })
        .map(Duration::from_millis)
        .unwrap_or(SUPERVISOR_TURN_TIMEOUT)
}

pub async fn run_codex_supervised_turn(
    keyring: &dyn Keyring,
    provider_config_id: i64,
    agent_loop: &AgentLoop,
    session_id: i64,
    user_input: &str,
    runtime_state_root: Option<PathBuf>,
    emit: &mut (dyn FnMut(AgentEvent) + Send),
) -> Result<PiSidecarTurnResult, AgentError> {
    let descriptor =
        parity::pi_provider_descriptor(crate::ipc::provider_runtime::ProviderKind::Codex)
            .expect("Codex Pi descriptor must exist");
    run_supervised_turn(
        keyring,
        &descriptor,
        provider_config_id,
        agent_loop,
        session_id,
        user_input,
        runtime_state_root,
        emit,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn run_supervised_turn(
    keyring: &dyn Keyring,
    descriptor: &PiProviderDescriptor,
    provider_config_id: i64,
    agent_loop: &AgentLoop,
    session_id: i64,
    user_input: &str,
    runtime_state_root: Option<PathBuf>,
    emit: &mut (dyn FnMut(AgentEvent) + Send),
) -> Result<PiSidecarTurnResult, AgentError> {
    let turn = agent_loop
        .begin_external_turn(session_id, user_input, emit)
        .await?;
    let assistant_id = uuid::Uuid::new_v4().to_string();
    emit(AgentEvent::AssistantStart {
        id: assistant_id.clone(),
        created_at: crate::db::now_ms(),
    });

    let result = run_supervised_turn_inner(
        keyring,
        descriptor,
        provider_config_id,
        agent_loop,
        session_id,
        assistant_id.clone(),
        turn.messages,
        turn.current_card_id,
        runtime_state_root,
        emit,
    )
    .await
    .map_err(|err| {
        if err == SIDECAR_CANCELLED {
            return AgentError::Cancelled;
        }
        emit(AgentEvent::Error {
            message: err.clone(),
            retryable: true,
        });
        AgentError::Internal(err)
    })?;

    // 011 live-QA fix (tier1-run-log 재QA 2026-07-11, 재저니 3-D): the
    // supervised Pi path ended at `assistant_end` (a momentary in-turn clear
    // point) and never emitted the terminal `done` — only the legacy agent
    // loop did. The frontend's per-run terminal latch (S-052) therefore never
    // engaged in production, and a trailing tool/telemetry event could leave
    // the 45s stall timer armed after a fully successful turn. Failures
    // already emit `error` (above); successes now emit the matching terminal
    // event the frontend grammar has always handled.
    emit(AgentEvent::Done {
        reason: "turn_completed".into(),
    });

    Ok(result)
}

#[allow(clippy::too_many_arguments)]
async fn run_supervised_turn_inner(
    keyring: &dyn Keyring,
    descriptor: &PiProviderDescriptor,
    provider_config_id: i64,
    agent_loop: &AgentLoop,
    session_id: i64,
    assistant_id: String,
    messages: Vec<ProviderMessage>,
    current_card_id: Option<i64>,
    runtime_state_root: Option<PathBuf>,
    emit: &mut (dyn FnMut(AgentEvent) + Send),
) -> Result<PiSidecarTurnResult, String> {
    let credential = prepare_runtime_credential(keyring, descriptor, provider_config_id)?;
    let auth_file_mode = credential.auth_file_mode().to_string();
    let model = agent_loop.model.clone();
    let request_id = uuid::Uuid::new_v4().to_string();
    let sidecar_cmd = resolve_sidecar_command(bundled_sidecar_path())?;
    let tools = agent_loop.tool_defs_for_external_turn();
    let expected_tools = sorted_tool_names(&tools);
    let cwd = agent_loop.tool_ctx.project_root.display().to_string();
    let prompt = render_messages_for_pi(&messages);
    let state_path = runtime_state_root
        .as_ref()
        .map(|root| runtime_state_path(root, session_id));
    let mut runtime_state = PiRuntimeState {
        protocol_version: RUNTIME_STATE_PROTOCOL_VERSION,
        session_id,
        request_id: request_id.clone(),
        provider_config_id,
        provider: descriptor.pi_provider_id.to_string(),
        model: model.clone(),
        cwd: cwd.clone(),
        tool_names: expected_tools.clone(),
        message_count: messages.len(),
        auth_file_mode: auth_file_mode.clone(),
        status: "running".to_string(),
        tool_calls_seen: 0,
        started_at: now_epoch_ms(),
        updated_at: now_epoch_ms(),
        completed_at: None,
        error: None,
    };
    if let Some(path) = &state_path {
        write_runtime_state(path, &runtime_state)?;
    }

    let SpawnedSidecar {
        mut child,
        mut stdin,
        stdout,
        stderr_task,
    } = spawn_sidecar(&sidecar_cmd, "spawn pi sidecar")?;

    let run_message = build_run_message(
        &request_id,
        descriptor,
        &model,
        &cwd,
        credential.auth_path(),
        credential.api_key(),
        &prompt,
        &tools,
    );
    stdin
        .write_all(format!("{run_message}\n").as_bytes())
        .await
        .map_err(|e| format!("write sidecar run message: {e}"))?;

    let mut sidecar_events = spawn_sidecar_stdout_reader(stdout);
    let mut buffered_events = VecDeque::new();
    let mut enabled_tools = Vec::new();
    let mut ready_model = format!("{}/{model}", descriptor.pi_provider_id);
    let mut tool_calls_seen = 0usize;
    let mut assistant_text = String::new();
    let mut reasoning_text = String::new();
    let mut tool_calls = Vec::new();
    let mut pending_tool_call_ids = Vec::new();
    let timing = sidecar_timing();
    let mut last_progress_event_at: Option<Instant> = None;
    // The turn budget measures the model/sidecar's own wall-clock time. It is
    // advanced past any time spent awaiting a human approval (see the tool loop
    // below), so deliberating on an approval card never expires the turn.
    let mut budget_anchor = Instant::now();

    let read_loop = async {
        loop {
            if agent_loop.cancel.load(Ordering::SeqCst) {
                return Err(SIDECAR_CANCELLED.to_string());
            }
            let event = if let Some(event) = buffered_events.pop_front() {
                event
            } else {
                let cancel = wait_for_cancel(agent_loop.cancel.clone());
                tokio::select! {
                    event = next_sidecar_event(&mut sidecar_events, budget_anchor, timing) => event?,
                    _ = cancel => {
                        return Err(SIDECAR_CANCELLED.to_string());
                    }
                }
            };
            match event {
                SidecarEvent::Ready {
                    model,
                    enabled_tools: tools,
                } => {
                    ready_model = model;
                    enabled_tools = tools;
                }
                SidecarEvent::ToolCall {
                    tool_call_id,
                    name,
                    params,
                } => {
                    if !expected_tools.contains(&name) {
                        return Err(format!("unexpected sidecar tool call: {name}"));
                    }
                    tool_calls_seen += 1;
                    runtime_state.tool_calls_seen = tool_calls_seen;
                    runtime_state.updated_at = now_epoch_ms();
                    if let Some(path) = &state_path {
                        write_runtime_state(path, &runtime_state)?;
                    }
                    let tc = ToolCall {
                        id: tool_call_id.clone(),
                        name,
                        arguments: params.to_string(),
                    };
                    pending_tool_call_ids.push(tc.id.clone());
                    tool_calls.push(tc.clone());
                    emit_progress(
                        emit,
                        AgentProgressKind::ToolRunning,
                        "Pi runtime requested a DIVE tool.",
                    );
                    let execute = agent_loop.execute_supervised_tool_call(session_id, &tc, emit);
                    tokio::pin!(execute);
                    // Time spent here (incl. waiting on the human approval card)
                    // is excluded from the turn budget; advance the anchor by it
                    // once the tool resolves.
                    let tool_exec_started = Instant::now();
                    let out = loop {
                        let cancel = wait_for_cancel(agent_loop.cancel.clone());
                        let event = next_sidecar_event_during_tool(&mut sidecar_events, timing);
                        tokio::select! {
                            result = &mut execute => {
                                break result.map_err(|e| e.to_string())?;
                            }
                            event = event => {
                                match event? {
                                    SidecarEvent::Heartbeat { .. } | SidecarEvent::ToolCallEnd { .. } => {}
                                    SidecarEvent::Error { message } => {
                                        return Err(format!("pi sidecar error: {message}"));
                                    }
                                    other => {
                                        if buffered_events.len() >= MAX_BUFFERED_SIDECAR_EVENTS {
                                            return Err(format!(
                                                "pi sidecar buffered too many events (>{MAX_BUFFERED_SIDECAR_EVENTS}) while executing a DIVE tool"
                                            ));
                                        }
                                        buffered_events.push_back(other);
                                    }
                                }
                            }
                            _ = cancel => {
                                return Err(SIDECAR_CANCELLED.to_string());
                            }
                        }
                    };
                    budget_anchor += tool_exec_started.elapsed();
                    let result = json!({
                        "type": "tool_result",
                        "tool_call_id": tool_call_id,
                        "success": out.success,
                        "content": out.content,
                        "details": {
                            "source": "dive-tauri",
                            "summary": out.summary,
                            "full": out.full,
                        }
                    });
                    stdin
                        .write_all(format!("{result}\n").as_bytes())
                        .await
                        .map_err(|e| format!("write sidecar tool result: {e}"))?;
                }
                SidecarEvent::AssistantDelta { delta } => {
                    assistant_text.push_str(&delta);
                    let event = SidecarEvent::AssistantDelta { delta };
                    if let Some(agent_event) = map_sidecar_delta_event(&event, &assistant_id) {
                        emit(agent_event);
                    }
                }
                SidecarEvent::ReasoningDelta { delta } => {
                    reasoning_text.push_str(&delta);
                    emit_progress_throttled(
                        &mut last_progress_event_at,
                        emit,
                        AgentProgressKind::Reasoning,
                        "Pi runtime is reasoning.",
                    );
                    let event = SidecarEvent::ReasoningDelta { delta };
                    if let Some(agent_event) = map_sidecar_delta_event(&event, &assistant_id) {
                        emit(agent_event);
                    }
                }
                SidecarEvent::ToolCallEnd { .. } => {
                    // DIVE owns the authoritative tool result event from Rust.
                }
                SidecarEvent::Heartbeat { .. } => {
                    emit_progress_throttled(
                        &mut last_progress_event_at,
                        emit,
                        AgentProgressKind::Heartbeat,
                        "Pi runtime heartbeat received.",
                    );
                }
                SidecarEvent::TurnSucceeded {
                    assistant_text: text,
                } => {
                    if !text.trim().is_empty() {
                        assistant_text = text;
                    }
                    break;
                }
                SidecarEvent::Error { message } => {
                    return Err(format!("pi sidecar error: {message}"));
                }
                SidecarEvent::ListModelsResult { .. } => {
                    return Err("unexpected list_models_result during a run turn".to_string());
                }
            }
        }
        Ok::<(), String>(())
    };

    let read_result = read_loop.await;
    if let Err(err) = read_result {
        agent_loop.permission.cancel_pending(&pending_tool_call_ids);
        let mut runtime_error = err.clone();
        let status = if err == SIDECAR_CANCELLED {
            send_sidecar_cancel(&mut stdin, &request_id, "cancelled").await;
            let _ = child.kill().await;
            "cancelled".to_string()
        } else if err == SIDECAR_STDOUT_CLOSED {
            let status = child
                .wait()
                .await
                .map_err(|e| format!("wait pi sidecar: {e}"))?;
            let stderr_lines = stderr_task.await.unwrap_or_default();
            if status.success() {
                "error".to_string()
            } else {
                runtime_error = format!(
                    "pi sidecar exited with {status}; stderr={}",
                    stderr_lines.join("\\n")
                );
                "crashed".to_string()
            }
        } else {
            send_sidecar_cancel(&mut stdin, &request_id, "runtime_error").await;
            let _ = child.kill().await;
            "error".to_string()
        };
        runtime_state.status = if err == SIDECAR_CANCELLED {
            "cancelled".to_string()
        } else {
            status
        };
        runtime_state.error = Some(redact_line(&runtime_error));
        runtime_state.updated_at = now_epoch_ms();
        runtime_state.completed_at = Some(now_epoch_ms());
        if let Some(path) = &state_path {
            let _ = write_runtime_state(path, &runtime_state);
        }
        let _ =
            mark_active_step_blocked_by_pi_runtime_error(agent_loop, session_id, &runtime_error);
        return Err(runtime_error);
    }
    drop(stdin);

    let status = child
        .wait()
        .await
        .map_err(|e| format!("wait pi sidecar: {e}"))?;
    let stderr_lines = stderr_task.await.unwrap_or_default();
    if !status.success() {
        agent_loop.permission.cancel_pending(&pending_tool_call_ids);
        let message = format!(
            "pi sidecar exited with {status}; stderr={}",
            stderr_lines.join("\\n")
        );
        runtime_state.status = "crashed".to_string();
        runtime_state.error = Some(format!("pi sidecar exited with {status}"));
        runtime_state.updated_at = now_epoch_ms();
        runtime_state.completed_at = Some(now_epoch_ms());
        if let Some(path) = &state_path {
            let _ = write_runtime_state(path, &runtime_state);
        }
        let _ = mark_active_step_blocked_by_pi_runtime_error(agent_loop, session_id, &message);
        return Err(message);
    }
    if enabled_tools != expected_tools {
        runtime_state.status = "error".to_string();
        runtime_state.error = Some("unexpected enabled tools from Pi sidecar".to_string());
        runtime_state.updated_at = now_epoch_ms();
        runtime_state.completed_at = Some(now_epoch_ms());
        if let Some(path) = &state_path {
            let _ = write_runtime_state(path, &runtime_state);
        }
        return Err(format!(
            "unexpected enabled tools from Pi sidecar: {:?}; expected {:?}",
            enabled_tools, expected_tools
        ));
    }

    agent_loop
        .finish_external_turn(
            session_id,
            assistant_id,
            current_card_id,
            assistant_text.trim().to_string(),
            if reasoning_text.trim().is_empty() {
                None
            } else {
                Some(reasoning_text.trim().to_string())
            },
            &tool_calls,
            FinishReason::Stop,
            emit,
        )
        .map_err(|e| e.to_string())?;
    runtime_state.status = "completed".to_string();
    runtime_state.tool_calls_seen = tool_calls_seen;
    runtime_state.updated_at = now_epoch_ms();
    runtime_state.completed_at = Some(now_epoch_ms());
    runtime_state.error = None;
    if let Some(path) = &state_path {
        write_runtime_state(path, &runtime_state)?;
    }

    Ok(PiSidecarTurnResult {
        provider_config_id,
        model: ready_model,
        auth_file_mode,
        enabled_tools,
        tool_calls_seen,
        assistant_text: assistant_text.trim().to_string(),
    })
}

#[allow(clippy::too_many_arguments)]
fn build_run_message(
    request_id: &str,
    descriptor: &PiProviderDescriptor,
    model: &str,
    cwd: &str,
    auth_path: Option<&Path>,
    api_key: Option<&str>,
    prompt: &str,
    tools: &[ToolDef],
) -> serde_json::Value {
    debug_assert!(
        auth_path.is_some() ^ api_key.is_some(),
        "Pi run messages must carry either auth_path or api_key"
    );

    let mut message = json!({
        "type": "run",
        "request_id": request_id,
        "cwd": cwd,
        "provider": descriptor.pi_provider_id,
        "model": model,
        "prompt": prompt,
    });

    if let Some(auth_path) = auth_path {
        message["auth_path"] = json!(auth_path.display().to_string());
        if let Some(parent) = auth_path.parent() {
            message["agent_dir"] = json!(parent.join("agent").display().to_string());
        }
    }
    if let Some(api_key) = api_key {
        message["api_key"] = json!(api_key);
    }
    // Always send an explicit `tools` array, even when empty. The sidecar treats an
    // ABSENT `tools` field as the smoke-path default (a single `dive_context` tool),
    // so an interview-mode turn — which legitimately exposes zero tools — must
    // serialize as `tools: []`. Omitting it makes the sidecar enable `dive_context`
    // and trips the strict enabled-tools parity check.
    message["tools"] = json!(tools);

    message
}

fn sorted_tool_names(tools: &[ToolDef]) -> Vec<String> {
    let mut names = tools
        .iter()
        .map(|tool| tool.name.clone())
        .collect::<Vec<_>>();
    names.sort();
    names
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u128::from(u64::MAX)) as u64
}

fn emit_progress_throttled(
    last_progress_event_at: &mut Option<Instant>,
    emit: &mut (dyn FnMut(AgentEvent) + Send),
    kind: AgentProgressKind,
    message: &'static str,
) {
    let now = Instant::now();
    if last_progress_event_at
        .map(|last| now.duration_since(last) < PROGRESS_EVENT_MIN_INTERVAL)
        .unwrap_or(false)
    {
        return;
    }
    *last_progress_event_at = Some(now);
    emit_progress(emit, kind, message);
}

fn emit_progress(
    emit: &mut (dyn FnMut(AgentEvent) + Send),
    kind: AgentProgressKind,
    message: &'static str,
) {
    emit(AgentEvent::AgentProgress {
        kind,
        message: message.to_string(),
        created_at: crate::db::now_ms(),
    });
}

fn render_messages_for_pi(messages: &[ProviderMessage]) -> String {
    let mut rendered = String::from(
        "You are running inside DIVE's supervised Pi runtime. Use only the DIVE tools provided by this session. Do not claim that you executed a tool unless a DIVE tool result was returned.\n\n",
    );
    rendered.push_str(
        "Runtime tool guidance: use preview_open for inspecting local HTML, loopback URLs, or configured project previews; use run_process only for one executable plus explicit arguments such as tests or builds; never use run_process, shell wrappers, or platform open commands for Preview; use run_terminal_script only for justified shell-style verification that cannot be expressed as Preview or direct run_process, and expect high-risk one-shot approval.\n\n",
    );
    for message in messages {
        match message {
            ProviderMessage::System { content } => {
                rendered.push_str("<system>\n");
                rendered.push_str(content);
                rendered.push_str("\n</system>\n\n");
            }
            ProviderMessage::User { content } => {
                rendered.push_str("<user>\n");
                rendered.push_str(content);
                rendered.push_str("\n</user>\n\n");
            }
            ProviderMessage::Assistant { content, .. } => {
                rendered.push_str("<assistant>\n");
                rendered.push_str(content);
                rendered.push_str("\n</assistant>\n\n");
            }
            ProviderMessage::Tool {
                content,
                tool_call_id,
            } => {
                rendered.push_str("<tool_result id=\"");
                rendered.push_str(tool_call_id);
                rendered.push_str("\">\n");
                rendered.push_str(content);
                rendered.push_str("\n</tool_result>\n\n");
            }
        }
    }
    rendered.push_str("Respond to the latest user message now.");
    rendered
}

#[cfg(test)]
mod tests;
