use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
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

use crate::agent::{AgentError, AgentEvent, AgentLoop};
use crate::auth::{self, Keyring};
use crate::providers::{FinishReason, Message as ProviderMessage, ToolCall, ToolDef};

mod command;
mod credential;
mod protocol;
mod runtime_state;
mod transport;

pub mod parity;

#[cfg(test)]
use command::set_test_sidecar_script_path;
use command::{bundled_sidecar_path, resolve_sidecar_command, SidecarCommand};
use credential::{
    decode_jwt_exp_ms, default_expiry_ms, file_mode_string, now_epoch_ms,
    prepare_runtime_credential, write_codex_auth_file, TempAuthDir,
};
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
    sidecar_timing, spawn_sidecar_stdout_reader, wait_for_cancel,
};

const PROVIDER_ID: &str = "openai-codex";
const DEFAULT_MODEL: &str = "gpt-5.4-mini";
const SMOKE_MARKER: &str = "DIVE_PI_SIDECAR_TOOL_OK";
const SMOKE_PROMPT: &str = "Use the dive_context tool exactly once with request \"phase2-smoke\". After the tool result, reply exactly DIVE_PI_SIDECAR_TOOL_OK and nothing else.";
const PI_TURN_TIMEOUT: Duration = Duration::from_secs(120);
const SUPERVISOR_TURN_TIMEOUT_DEFAULT_MS: u64 = 8_000;
const SUPERVISOR_TURN_TIMEOUT_MIN_MS: u64 = 1_200;
const SUPERVISOR_TURN_TIMEOUT_MAX_MS: u64 = 15_000;
pub const SUPERVISOR_TURN_TIMEOUT: Duration =
    Duration::from_millis(SUPERVISOR_TURN_TIMEOUT_DEFAULT_MS);
const SIDECAR_HEARTBEAT_STALL_TIMEOUT: Duration = Duration::from_secs(20);
const SIDECAR_CANCELLED: &str = "pi sidecar turn cancelled";
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
    fn runtime_unavailable(message: impl Into<String>, started: Instant) -> Self {
        Self {
            kind: PiSidecarSupervisorErrorKind::RuntimeUnavailable,
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

pub async fn run_codex_smoke(
    keyring: &dyn Keyring,
    provider_config_id: i64,
    cwd: PathBuf,
    model: Option<String>,
) -> Result<PiSidecarSmokeResult, String> {
    let (access_token, refresh_token, id_token) =
        auth::load_codex_tokens(keyring, provider_config_id)
            .map_err(|e| format!("keyring: {e}"))?
            .ok_or_else(|| {
                format!("codex OAuth tokens not found for provider {provider_config_id}")
            })?;

    let access_account_id = auth::codex_oauth::decode_account_id(&access_token).ok();
    let id_account_id = if id_token.trim().is_empty() {
        None
    } else {
        auth::codex_oauth::decode_account_id(&id_token).ok()
    };
    let account_id = access_account_id
        .clone()
        .or(id_account_id)
        .ok_or_else(|| "codex OAuth tokens do not expose a ChatGPT account id".to_string())?;

    if access_account_id.is_none() {
        return Err(
            "Pi Codex OAuth requires the ChatGPT account id claim in the access token".to_string(),
        );
    }

    let expires = decode_jwt_exp_ms(&access_token).unwrap_or_else(default_expiry_ms);
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

    let mut child = new_sidecar_process(&sidecar_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn pi sidecar: {e}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "pi sidecar stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "pi sidecar stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "pi sidecar stderr unavailable".to_string())?;

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut lines = Vec::new();
        while let Ok(Some(line)) = reader.next_line().await {
            lines.push(redact_line(&line));
        }
        lines
    });

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
        .map_err(|err| PiSidecarSupervisorError::runtime_unavailable(err, started))?;
    let auth_file_mode = credential.auth_file_mode().to_string();
    let request_id = uuid::Uuid::new_v4().to_string();
    let sidecar_cmd = resolve_sidecar_command(bundled_sidecar_path())
        .map_err(|err| PiSidecarSupervisorError::runtime_unavailable(err, started))?;
    let cwd = cwd.display().to_string();
    let tools: Vec<ToolDef> = Vec::new();

    let mut child = new_sidecar_process(&sidecar_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| {
            PiSidecarSupervisorError::runtime_unavailable(
                format!("spawn pi sidecar: {err}"),
                started,
            )
        })?;

    let mut stdin = child.stdin.take().ok_or_else(|| {
        PiSidecarSupervisorError::runtime_unavailable("pi sidecar stdin unavailable", started)
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        PiSidecarSupervisorError::runtime_unavailable("pi sidecar stdout unavailable", started)
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        PiSidecarSupervisorError::runtime_unavailable("pi sidecar stderr unavailable", started)
    })?;

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut lines = Vec::new();
        while let Ok(Some(line)) = reader.next_line().await {
            lines.push(redact_line(&line));
        }
        lines
    });

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

    let mut child = new_sidecar_process(&sidecar_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("spawn pi sidecar: {e}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "pi sidecar stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "pi sidecar stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "pi sidecar stderr unavailable".to_string())?;

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut lines = Vec::new();
        while let Ok(Some(line)) = reader.next_line().await {
            lines.push(redact_line(&line));
        }
        lines
    });

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
                    let event = SidecarEvent::AssistantDelta { delta };
                    if let SidecarEvent::AssistantDelta { delta } = &event {
                        assistant_text.push_str(delta);
                    }
                    if let Some(agent_event) = map_sidecar_delta_event(&event, &assistant_id) {
                        emit(agent_event);
                    }
                }
                SidecarEvent::ReasoningDelta { delta } => {
                    let event = SidecarEvent::ReasoningDelta { delta };
                    if let SidecarEvent::ReasoningDelta { delta } = &event {
                        reasoning_text.push_str(delta);
                    }
                    if let Some(agent_event) = map_sidecar_delta_event(&event, &assistant_id) {
                        emit(agent_event);
                    }
                }
                SidecarEvent::ToolCallEnd { .. } => {
                    // DIVE owns the authoritative tool result event from Rust.
                }
                SidecarEvent::Heartbeat { .. } => {}
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
        } else if err == "pi sidecar stdout closed before turn completion" {
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
mod tests {
    // Fake-sidecar tests hold a serial-execution MutexGuard across `.await`; the
    // guard only serializes the test process-spawn path, so the deadlock risk the
    // lint guards against does not apply here.
    #![allow(clippy::await_holding_lock)]
    use super::*;
    use async_trait::async_trait;
    use serde_json::json;
    use std::sync::atomic::AtomicUsize;

    use crate::agent::{
        AgentRunMode, AlwaysApproveHook, AwaitUserHook, PendingApprovals, PermissionDecision,
        PermissionHook, PermissionRequestContext, RunModePermissionHook, StepContext,
    };
    use crate::db::models::{CardState, NewCard};
    use crate::tools::RiskLevel;

    struct RecordingApproveHook {
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl PermissionHook for RecordingApproveHook {
        async fn intercept(
            &self,
            _call: &ToolCall,
            _risk: RiskLevel,
            _context: PermissionRequestContext,
        ) -> PermissionDecision {
            self.calls.fetch_add(1, Ordering::SeqCst);
            PermissionDecision::approved()
        }
    }

    /// Approves only after `delay`, modelling a student who deliberates on the
    /// approval card longer than the turn budget.
    struct SlowApproveHook {
        delay: Duration,
    }

    #[async_trait]
    impl PermissionHook for SlowApproveHook {
        async fn intercept(
            &self,
            _call: &ToolCall,
            _risk: RiskLevel,
            _context: PermissionRequestContext,
        ) -> PermissionDecision {
            tokio::time::sleep(self.delay).await;
            PermissionDecision::approved()
        }
    }

    struct DelayedApproveHook {
        delay: Duration,
    }

    #[async_trait]
    impl PermissionHook for DelayedApproveHook {
        async fn intercept(
            &self,
            _call: &ToolCall,
            _risk: RiskLevel,
            _context: PermissionRequestContext,
        ) -> PermissionDecision {
            tokio::time::sleep(self.delay).await;
            PermissionDecision::approved()
        }
    }

    fn create_test_db(project: &Path) -> (Arc<Mutex<crate::db::Database>>, i64) {
        let mut db = crate::db::Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let project_id = crate::db::dao::project::insert(
            db.conn(),
            &crate::db::models::NewProject {
                name: "phase-d".into(),
                path: project.display().to_string(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let session_id = crate::db::dao::session::insert(
            db.conn(),
            &crate::db::models::NewSession {
                project_id,
                title: "phase-d".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap();
        (Arc::new(Mutex::new(db)), session_id)
    }

    fn make_loop(
        project: &Path,
        db: Arc<Mutex<crate::db::Database>>,
        session_id: i64,
        run_mode: AgentRunMode,
        permission: Arc<dyn PermissionHook>,
        cancel: Option<Arc<AtomicBool>>,
    ) -> AgentLoop {
        let mut builder = AgentLoop::builder()
            .provider(std::sync::Arc::new(crate::providers::MockProvider::new(
                Vec::new(),
            )))
            .registry(std::sync::Arc::new(
                crate::tools::ToolRegistry::with_builtins(),
            ))
            .permission(permission)
            .db(db)
            .tool_ctx(crate::tools::ToolContext::new(project, session_id))
            .model(DEFAULT_MODEL)
            .run_mode(run_mode);
        if let Some(cancel) = cancel {
            builder = builder.cancel(cancel);
        }
        builder.build().unwrap()
    }

    fn run_mode_permission(
        mode: AgentRunMode,
        plan_accepted: bool,
        active_step_id: Option<i64>,
        inner: Arc<dyn PermissionHook>,
    ) -> Arc<dyn PermissionHook> {
        Arc::new(
            RunModePermissionHook::new(mode, inner)
                .with_plan_accepted(plan_accepted)
                .with_active_step_id(active_step_id),
        )
    }

    fn insert_current_card(
        db: &Arc<Mutex<crate::db::Database>>,
        session_id: i64,
        title: &str,
    ) -> i64 {
        let db = db.lock().unwrap();
        let card_id = crate::db::dao::card::insert(
            db.conn(),
            &NewCard {
                session_id,
                title: title.into(),
                instruction: Some("implement the current card".into()),
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
        crate::db::dao::workmap::set_current_card(db.conn(), session_id, Some(card_id)).unwrap();
        card_id
    }

    fn insert_active_step_mapping(
        db: &Arc<Mutex<crate::db::Database>>,
        session_id: i64,
    ) -> StepContext {
        let db = db.lock().unwrap();
        let session = crate::db::dao::session::get_by_id(db.conn(), session_id)
            .unwrap()
            .unwrap();
        let plan_id = crate::db::dao::plan::insert(
            db.conn(),
            &crate::db::models::NewPlan {
                project_id: session.project_id,
                interview_id: None,
                goal: "Phase E active step".into(),
                intent_summary: None,
                scope: None,
                non_goals: None,
                constraints: None,
                acceptance_criteria: None,
                status: "approved".into(),
            },
        )
        .unwrap();
        let step_id = crate::db::dao::step::insert(
            db.conn(),
            &crate::db::models::NewStep {
                plan_id,
                step_id: "step-001".into(),
                title: "Harden Pi runtime".into(),
                summary: None,
                instruction_seed: Some("Exercise runtime abort handling".into()),
                expected_files: Some(json!(["src/pi_sidecar.rs"])),
                acceptance_criteria: Some(json!(["runtime aborts are retryable"])),
                verification_kind: None,
                verification_command: None,
                verification_manual_check: None,
                dependencies: Some(json!([])),
                parallel_group: None,
                position: 1,
            },
        )
        .unwrap();
        crate::db::dao::step_session_mapping::insert(
            db.conn(),
            &crate::db::models::NewStepSessionMapping {
                step_id,
                session_id: Some(session_id),
                card_id: None,
                state_path: None,
                status: "in_progress".into(),
                started_at: Some(crate::db::now_ms()),
                completed_at: None,
                checkpoint_ids: Some(json!([])),
                verification_status: None,
                verification_evidence: None,
                user_decision: None,
            },
        )
        .unwrap();
        StepContext {
            step_id,
            title: "Harden Pi runtime".into(),
            instruction_seed: Some("Exercise runtime abort handling".into()),
            acceptance_criteria: Some("[\"runtime aborts are retryable\"]".into()),
            linked_criterion_ids: Vec::new(),
            decomposition_rationale: None,
            expected_files: Some("[\"src/pi_sidecar.rs\"]".into()),
        }
    }

    fn tool_call(id: &str, name: &str, arguments: serde_json::Value) -> ToolCall {
        ToolCall {
            id: id.into(),
            name: name.into(),
            arguments: arguments.to_string(),
        }
    }

    fn event_kind(event: &AgentEvent) -> &'static str {
        match event {
            AgentEvent::UserMessage { .. } => "user_message",
            AgentEvent::RuntimeSelected { .. } => "runtime_selected",
            AgentEvent::RuntimeCapabilityEvaluated { .. } => "runtime_capability_evaluated",
            AgentEvent::RuntimeRoutingDecision { .. } => "runtime_routing_decision",
            AgentEvent::PreviewOpenRequested { .. } => "preview_open_requested",
            AgentEvent::PreviewOpenResult { .. } => "preview_open_result",
            AgentEvent::ProjectCommandResult { .. } => "project_command_result",
            AgentEvent::TerminalScriptResult { .. } => "terminal_script_result",
            AgentEvent::ToolApprovalStale { .. } => "tool_approval_stale",
            AgentEvent::AssistantStart { .. } => "assistant_start",
            AgentEvent::AssistantDelta { .. } => "assistant_delta",
            AgentEvent::AssistantEnd { .. } => "assistant_end",
            AgentEvent::Reasoning { .. } => "reasoning",
            AgentEvent::ToolCallStart { .. } => "tool_call_start",
            AgentEvent::ToolCallApproved { .. } => "tool_call_approved",
            AgentEvent::ToolCallDenied { .. } => "tool_call_denied",
            AgentEvent::ToolCallBlocked { .. } => "tool_call_blocked",
            AgentEvent::ToolResult { .. } => "tool_result",
            AgentEvent::Error { .. } => "error",
            AgentEvent::Done { .. } => "done",
        }
    }

    fn event_kinds(events: &[AgentEvent]) -> Vec<&'static str> {
        events.iter().map(event_kind).collect()
    }

    fn write_fake_sidecar(dir: &Path, name: &str, body: &str) -> PathBuf {
        let script = dir.join(name);
        std::fs::write(&script, body).unwrap();
        script
    }

    static FAKE_SIDECAR_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn fake_sidecar_test_lock() -> std::sync::MutexGuard<'static, ()> {
        FAKE_SIDECAR_TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn fake_sidecar_prelude() -> &'static str {
        r#"
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
function emit(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function ready(message) {
  const tools = (message.tools ?? []).map((tool) => tool.name).sort();
  emit({ type: "ready", request_id: message.request_id, model: `${message.provider}/${message.model}`, enabled_tools: tools });
}
"#
    }

    fn api_key_descriptor() -> PiProviderDescriptor {
        PiProviderDescriptor {
            pi_provider_id: "test-provider",
            credential_mode: CredentialMode::ApiKey,
        }
    }

    fn api_keyring(provider_config_id: i64) -> auth::InMemoryKeyring {
        let keyring = auth::InMemoryKeyring::new();
        auth::upsert_provider_api_key(&keyring, provider_config_id, "sk-test-secret").unwrap();
        keyring
    }

    fn set_supervisor_timeout_env(value: Option<&str>) {
        const KEY: &str = "DIVE_SUPERVISOR_TURN_TIMEOUT_MS";
        match value {
            Some(value) => std::env::set_var(KEY, value),
            None => std::env::remove_var(KEY),
        }
    }

    #[test]
    fn supervisor_turn_timeout_defaults_to_realistic_budget() {
        let _serial = fake_sidecar_test_lock();
        set_supervisor_timeout_env(None);

        assert_eq!(supervisor_turn_timeout(), Duration::from_secs(8));
    }

    #[test]
    fn supervisor_turn_timeout_env_override_is_bounded() {
        let _serial = fake_sidecar_test_lock();

        set_supervisor_timeout_env(Some("250"));
        assert_eq!(supervisor_turn_timeout(), Duration::from_millis(1_200));

        set_supervisor_timeout_env(Some("6000"));
        assert_eq!(supervisor_turn_timeout(), Duration::from_secs(6));

        set_supervisor_timeout_env(Some("60000"));
        assert_eq!(supervisor_turn_timeout(), Duration::from_secs(15));

        set_supervisor_timeout_env(None);
    }

    async fn live_api_key_provider_parity_smoke(
        pi_provider_id: &'static str,
        api_key_env: &str,
        model_env: &str,
    ) {
        let api_key = std::env::var(api_key_env)
            .unwrap_or_else(|_| panic!("set {api_key_env} for live Pi parity smoke"));
        let model =
            std::env::var(model_env).unwrap_or_else(|_| panic!("set {model_env} for live smoke"));
        let provider_config_id = 9001;
        let keyring = auth::InMemoryKeyring::new();
        auth::upsert_provider_api_key(&keyring, provider_config_id, api_key.trim()).unwrap();

        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("provider-parity.txt"),
            "provider parity",
        )
        .unwrap();
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db,
            session_id,
            AgentRunMode::Plan,
            run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
            None,
        );
        let descriptor = PiProviderDescriptor {
            pi_provider_id,
            credential_mode: CredentialMode::ApiKey,
        };
        let mut loop_with_model = loop_;
        loop_with_model.model = model;
        let mut events = Vec::new();
        let result = run_supervised_turn(
            &keyring,
            &descriptor,
            provider_config_id,
            &loop_with_model,
            session_id,
            "Use the read_file tool exactly once with path \"provider-parity.txt\". Then reply exactly DIVE_PI_PROVIDER_PARITY_OK and nothing else.",
            None,
            &mut |event| events.push(event),
        )
        .await
        .expect("live provider Pi parity smoke");

        assert_eq!(result.tool_calls_seen, 1);
        assert_eq!(result.assistant_text, "DIVE_PI_PROVIDER_PARITY_OK");
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::ToolResult { success: true, .. })));
    }

    #[test]
    fn renders_external_messages_for_pi_with_role_boundaries() {
        let rendered = render_messages_for_pi(&[
            ProviderMessage::System {
                content: "system hint".into(),
            },
            ProviderMessage::User {
                content: "latest request".into(),
            },
        ]);
        assert!(rendered.contains("<system>\nsystem hint\n</system>"));
        assert!(rendered.contains("<user>\nlatest request\n</user>"));
        assert!(rendered.contains("Use only the DIVE tools"));
    }

    #[test]
    fn sorted_tool_names_is_stable() {
        let tools = vec![
            ToolDef {
                name: "write_file".into(),
                description: String::new(),
                parameters: serde_json::json!({"type":"object"}),
            },
            ToolDef {
                name: "read_file".into(),
                description: String::new(),
                parameters: serde_json::json!({"type":"object"}),
            },
        ];
        assert_eq!(sorted_tool_names(&tools), ["read_file", "write_file"]);
    }

    #[test]
    fn run_message_carries_provider_descriptor_not_hardcoded_codex() {
        let msg = build_run_message(
            "req-1",
            &parity::PiProviderDescriptor {
                pi_provider_id: "openai",
                credential_mode: parity::CredentialMode::ApiKey,
            },
            "gpt-5.4-mini",
            "/proj",
            None,
            Some("sk-test"),
            "hi",
            &[],
        );
        assert_eq!(msg["provider"], "openai");
        assert_eq!(msg["model"], "gpt-5.4-mini");
        assert_eq!(msg["api_key"], "sk-test");
        assert!(msg.get("auth_path").is_none() || msg["auth_path"].is_null());
    }

    #[test]
    fn run_message_sends_explicit_empty_tools_for_interview_turns() {
        // Interview-mode turns expose zero tools. The `tools` field must be present
        // and empty so the sidecar does NOT fall back to its smoke `dive_context`
        // default (which would fail the enabled-tools parity check).
        let msg = build_run_message(
            "req-interview",
            &parity::PiProviderDescriptor {
                pi_provider_id: "anthropic",
                credential_mode: parity::CredentialMode::ApiKey,
            },
            "claude-test",
            "/proj",
            None,
            Some("sk-test"),
            "hi",
            &[],
        );
        assert_eq!(msg["tools"], json!([]));
    }

    #[test]
    fn pi_sidecar_supervisor_run_message_sends_explicit_zero_tools() {
        let msg = build_run_message(
            "req-supervisor",
            &parity::PiProviderDescriptor {
                pi_provider_id: "openai-codex",
                credential_mode: parity::CredentialMode::OauthFile,
            },
            "gpt-5.4-mini",
            "/proj",
            Some(Path::new("/tmp/auth.json")),
            None,
            "{\"schemaVersion\":1,\"event\":\"verify_entered\"}",
            &[],
        );

        assert_eq!(msg["tools"], json!([]));
        assert!(
            !msg.to_string().contains("dive_context"),
            "SupervisorAgent must not inherit the smoke fallback tool"
        );
    }

    #[test]
    fn pi_sidecar_supervisor_boundary_scaffold_rejects_resource_discovered_tools() {
        fn assert_supervisor_enabled_tools_empty(enabled_tools: &[String]) -> Result<(), String> {
            if enabled_tools.is_empty() {
                Ok(())
            } else {
                Err(format!(
                    "SupervisorAgent ready.enabled_tools must be empty, got {:?}",
                    enabled_tools
                ))
            }
        }

        assert!(assert_supervisor_enabled_tools_empty(&[]).is_ok());
        let resource_discovered_tools = vec!["dive_context".to_string()];
        let err = assert_supervisor_enabled_tools_empty(&resource_discovered_tools).unwrap_err();
        assert!(err.contains("ready.enabled_tools must be empty"));
        assert!(err.contains("dive_context"));
    }

    #[tokio::test]
    async fn pi_sidecar_supervisor_turn_uses_explicit_zero_tools_and_no_resource_prompt() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "supervisor-zero-tools.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  if (!Array.isArray(message.tools) || message.tools.length !== 0) {{
    emit({{ type: "error", request_id: message.request_id, message: "supervisor tools were not []" }});
    return;
  }}
  if (message.prompt.includes("dive_context") || message.prompt.includes("AGENTS.md") || message.prompt.includes(".specify")) {{
    emit({{ type: "error", request_id: message.request_id, message: "resource-discovered instruction leaked" }});
    return;
  }}
  ready(message);
  emit({{
    type: "turn_succeeded",
    request_id: message.request_id,
    assistant_text: "{{\"schemaVersion\":1,\"provoke\":false}}"
  }});
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let provider_config_id = 601;
        let keyring = api_keyring(provider_config_id);

        let result = run_supervisor_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            project.path().to_path_buf(),
            "test-model".to_string(),
            "Return exactly one JSON object. SupervisorContext JSON: {}".to_string(),
            Duration::from_secs(2),
        )
        .await
        .unwrap();

        assert_eq!(result.enabled_tools, Vec::<String>::new());
        assert_eq!(
            result.assistant_text,
            "{\"schemaVersion\":1,\"provoke\":false}"
        );
        assert_eq!(result.provider_config_id, provider_config_id);
    }

    #[tokio::test]
    async fn pi_sidecar_supervisor_turn_rejects_enabled_tools_from_ready_event() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "supervisor-ready-tools.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  emit({{
    type: "ready",
    request_id: message.request_id,
    model: `${{message.provider}}/${{message.model}}`,
    enabled_tools: ["dive_context"]
  }});
  emit({{ type: "turn_succeeded", request_id: message.request_id, assistant_text: "{{}}" }});
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let provider_config_id = 602;
        let keyring = api_keyring(provider_config_id);

        let err = run_supervisor_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            project.path().to_path_buf(),
            "test-model".to_string(),
            "supervisor prompt".to_string(),
            Duration::from_secs(2),
        )
        .await
        .unwrap_err();

        assert_eq!(err.kind, PiSidecarSupervisorErrorKind::SidecarError);
        assert!(err.message.contains("ready.enabled_tools must be empty"));
        assert!(err.message.contains("dive_context"));
    }

    #[tokio::test]
    async fn pi_sidecar_supervisor_turn_rejects_any_tool_call() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "supervisor-tool-call.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{
    type: "tool_call",
    request_id: message.request_id,
    tool_call_id: "bad_tool",
    name: "read_file",
    params: {{ path: "secret.txt" }}
  }});
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let provider_config_id = 603;
        let keyring = api_keyring(provider_config_id);

        let err = run_supervisor_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            project.path().to_path_buf(),
            "test-model".to_string(),
            "supervisor prompt".to_string(),
            Duration::from_secs(2),
        )
        .await
        .unwrap_err();

        assert_eq!(err.kind, PiSidecarSupervisorErrorKind::SidecarError);
        assert!(err.message.contains("unexpected tool call"));
        assert!(err.message.contains("read_file"));
    }

    #[tokio::test]
    async fn supervised_tool_execution_uses_run_mode_permission() {
        let project = tempfile::tempdir().unwrap();
        let mut db = crate::db::Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let project_id = crate::db::dao::project::insert(
            db.conn(),
            &crate::db::models::NewProject {
                name: "phase3-permission".into(),
                path: project.path().display().to_string(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let session_id = crate::db::dao::session::insert(
            db.conn(),
            &crate::db::models::NewSession {
                project_id,
                title: "phase3-permission".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap();
        let loop_ = AgentLoop::builder()
            .provider(std::sync::Arc::new(crate::providers::MockProvider::new(
                Vec::new(),
            )))
            .registry(std::sync::Arc::new(
                crate::tools::ToolRegistry::with_builtins(),
            ))
            .permission(std::sync::Arc::new(
                crate::agent::RunModePermissionHook::new(
                    crate::agent::AgentRunMode::Plan,
                    std::sync::Arc::new(crate::agent::AlwaysApproveHook),
                ),
            ))
            .db(std::sync::Arc::new(std::sync::Mutex::new(db)))
            .tool_ctx(crate::tools::ToolContext::new(project.path(), session_id))
            .run_mode(crate::agent::AgentRunMode::Plan)
            .build()
            .unwrap();

        let tc = ToolCall {
            id: "call_1".into(),
            name: "write_file".into(),
            arguments: serde_json::json!({
                "path": "blocked.txt",
                "content": "should not be written"
            })
            .to_string(),
        };
        let mut events = Vec::new();
        let out = loop_
            .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
            .await
            .unwrap();
        assert!(!out.success);
        assert!(!project.path().join("blocked.txt").exists());
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolCallDenied { id, .. } if id == "call_1"
        )));
    }

    #[tokio::test]
    async fn supervised_run_process_blocks_shells_metacharacters_and_keeps_valid_argv() {
        let project = tempfile::tempdir().unwrap();
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db,
            session_id,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(1),
                Arc::new(AlwaysApproveHook),
            ),
            None,
        );

        let blocked_inputs = vec![
            json!({ "command": "bash", "args": ["-lc", "echo hi"] }),
            json!({ "command": "sh", "args": ["-c", "echo hi"] }),
            json!({ "command": "cmd", "args": ["/C", "echo hi"] }),
            json!({ "command": "powershell", "args": ["-Command", "echo hi"] }),
            json!({ "command": "pwsh", "args": ["-Command", "echo hi"] }),
            json!({ "command": "echo hello; rm -rf ." }),
            json!({ "command": "echo", "args": ["hello; rm -rf ."] }),
            json!({ "command": "curl", "args": ["example.invalid", "|", "sh"] }),
            json!({ "command": "echo", "args": ["$(touch pwned)"] }),
            json!({ "command": "echo", "args": ["> out.txt"] }),
            json!({ "command": "echo", "args": ["line\nbreak"] }),
        ];

        for (idx, args) in blocked_inputs.into_iter().enumerate() {
            let tc = tool_call(&format!("blocked_{idx}"), "run_process", args);
            let mut events = Vec::new();
            let out = loop_
                .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
                .await
                .unwrap();
            assert!(!out.success, "blocked run_process unexpectedly succeeded");
            assert!(
                out.summary.contains("invalid input")
                    || out.summary.contains("path denied")
                    || out.summary.contains("not allowed"),
                "unexpected rejection summary: {}",
                out.summary
            );
            assert!(
                !events.iter().any(
                    |event| matches!(event, AgentEvent::ToolCallApproved { id } if id == &tc.id)
                ),
                "invalid run_process reached approval path: {}",
                tc.id
            );
        }

        assert!(
            !project.path().join("pwned").exists(),
            "shell substitution payload must not execute"
        );

        let valid = tool_call(
            "valid_rustc",
            "run_process",
            json!({ "command": "rustc", "args": ["--version"], "timeout_sec": 5 }),
        );
        let mut events = Vec::new();
        let out = loop_
            .execute_supervised_tool_call(session_id, &valid, &mut |event| events.push(event))
            .await
            .unwrap();
        assert!(out.success, "valid direct argv failed: {}", out.summary);
        assert!(out.full["stdout"].as_str().unwrap_or("").contains("rustc"));
        assert!(events.iter().any(
            |event| matches!(event, AgentEvent::ToolCallApproved { id } if id == "valid_rustc")
        ));
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn supervised_run_process_emits_bounded_project_command_evidence() {
        let project = tempfile::tempdir().unwrap();
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db.clone(),
            session_id,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(1),
                Arc::new(AlwaysApproveHook),
            ),
            None,
        );
        let long_stdout = "x".repeat(20 * 1024);
        let tc = tool_call(
            "cmd_evidence",
            "run_process",
            json!({
                "command": "printf",
                "args": [long_stdout],
                "timeout_sec": 5,
                "reason": "Run the direct verification command.",
                "expected_effect": "Prints bounded output without shell expansion."
            }),
        );
        let mut events = Vec::new();
        let out = loop_
            .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
            .await
            .unwrap();
        assert!(out.success);

        let command_event = events
            .iter()
            .find_map(|event| match event {
                AgentEvent::ProjectCommandResult {
                    tool_call_id,
                    command_label,
                    executable,
                    timeout_sec,
                    reason,
                    expected_effect,
                    success,
                    exit_code,
                    stdout_summary,
                    ..
                } if tool_call_id == "cmd_evidence" => Some((
                    command_label,
                    executable,
                    timeout_sec,
                    reason,
                    expected_effect,
                    success,
                    exit_code,
                    stdout_summary,
                )),
                _ => None,
            })
            .expect("project command evidence event");
        assert!(command_event.0.starts_with("printf "));
        assert_eq!(command_event.1, "printf");
        assert_eq!(*command_event.2, 5);
        assert_eq!(
            command_event.3.as_deref(),
            Some("Run the direct verification command.")
        );
        assert_eq!(
            command_event.4.as_deref(),
            Some("Prints bounded output without shell expansion.")
        );
        assert!(*command_event.5);
        assert_eq!(*command_event.6, Some(0));
        assert!(
            command_event
                .7
                .as_deref()
                .is_some_and(|value| value.contains("[truncated]")),
            "stdout summary should be bounded"
        );

        let db_guard = db.lock().unwrap();
        let rows = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
        let logged = rows
            .iter()
            .find(|row| row.r#type == crate::dive::event_log::PROJECT_COMMAND_RESULT_EVENT)
            .expect("project_command.result log");
        assert_eq!(
            logged.payload["commandLabel"].as_str(),
            Some(command_event.0.as_str())
        );
        assert_eq!(logged.payload["timeoutSec"].as_u64(), Some(5));
        assert_eq!(
            logged.payload["expectedEffect"].as_str(),
            Some("Prints bounded output without shell expansion.")
        );
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn supervised_terminal_script_logs_one_shot_approval_and_bounded_result() {
        let project = tempfile::tempdir().unwrap();
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db.clone(),
            session_id,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(1),
                Arc::new(AlwaysApproveHook),
            ),
            None,
        );
        let tc = tool_call(
            "script_evidence",
            "run_terminal_script",
            json!({
                "script": "printf '%0300d' 1; printf warn >&2",
                "shell_family": "posix",
                "reason": "Need shell sequencing for a bounded verification fixture.",
                "expected_effect": "Captures stdout and stderr without editing files.",
                "timeout_sec": 30,
                "output_limit": 256
            }),
        );
        let mut events = Vec::new();
        let out = loop_
            .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
            .await
            .unwrap();
        assert!(out.success, "terminal script failed: {}", out.summary);
        assert_eq!(out.full["runtimeAction"], "terminal_script");
        assert_eq!(out.full["truncated"], true);
        assert!(events.iter().any(
            |event| matches!(event, AgentEvent::ToolCallApproved { id } if id == "script_evidence")
        ));

        let script_event = events
            .iter()
            .find_map(|event| match event {
                AgentEvent::TerminalScriptResult {
                    tool_call_id,
                    success,
                    exit_code,
                    stdout_summary,
                    stderr_summary,
                    truncated,
                    ..
                } if tool_call_id == "script_evidence" => Some((
                    success,
                    exit_code,
                    stdout_summary,
                    stderr_summary,
                    truncated,
                )),
                _ => None,
            })
            .expect("terminal_script.result event");
        assert!(*script_event.0);
        assert_eq!(*script_event.1, Some(0));
        assert!(
            script_event
                .2
                .as_deref()
                .is_some_and(|value| value.contains("[truncated]")),
            "stdout should be bounded"
        );
        assert_eq!(script_event.3.as_deref(), Some("warn"));
        assert!(*script_event.4);

        let db_guard = db.lock().unwrap();
        let rows = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
        let approval = rows
            .iter()
            .find(|row| {
                row.r#type == crate::dive::event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT
            })
            .expect("terminal_script.approval_requested log");
        assert_eq!(approval.payload["oneShot"], true);
        assert_eq!(approval.payload["approvalReuse"], false);
        assert_eq!(approval.payload["shellFamily"].as_str(), Some("posix"));
        assert_eq!(
            approval.payload["reason"].as_str(),
            Some("Need shell sequencing for a bounded verification fixture.")
        );
        assert_eq!(
            approval.payload["expectedEffect"].as_str(),
            Some("Captures stdout and stderr without editing files.")
        );

        let result = rows
            .iter()
            .find(|row| row.r#type == crate::dive::event_log::TERMINAL_SCRIPT_RESULT_EVENT)
            .expect("terminal_script.result log");
        assert_eq!(
            result.payload["toolCallId"].as_str(),
            Some("script_evidence")
        );
        assert_eq!(result.payload["truncated"], true);
    }

    #[tokio::test]
    async fn supervised_run_process_reroutes_preview_open_before_approval() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("index.html"), "<h1>Preview</h1>").unwrap();
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db.clone(),
            session_id,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(1),
                Arc::new(AlwaysApproveHook),
            ),
            None,
        );
        let tc = tool_call(
            "preview_reroute",
            "run_process",
            json!({ "command": "open", "args": ["index.html"], "timeout_sec": 5 }),
        );
        let mut events = Vec::new();
        let out = loop_
            .execute_supervised_tool_call(session_id, &tc, &mut |event| events.push(event))
            .await
            .unwrap();

        assert!(!out.success);
        assert_eq!(out.full["commandRan"], false);
        assert!(
            !events.iter().any(
                |event| matches!(event, AgentEvent::ToolCallApproved { id } if id == "preview_reroute")
            ),
            "preview-open workaround must not reach approval"
        );
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::RuntimeRoutingDecision {
                tool_call_id: Some(id),
                outcome: crate::tools::runtime::RuntimeRoutingOutcome::Rerouted,
                reason_code,
                ..
            } if id == "preview_reroute" && reason_code == "preview_open_shell_workaround"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::ProjectCommandResult {
                tool_call_id,
                status,
                success,
                summary,
                ..
            } if tool_call_id == "preview_reroute"
                && status == "blocked"
                && !success
                && summary.contains("DIVE did not run")
        )));

        let db_guard = db.lock().unwrap();
        let rows = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
        assert!(rows.iter().any(|row| row.r#type
            == crate::dive::event_log::RUNTIME_ROUTING_DECISION_EVENT
            && row.payload["outcome"] == "rerouted"
            && row.payload["commandRan"] == false));
        assert!(rows.iter().any(|row| row.r#type
            == crate::dive::event_log::PROJECT_COMMAND_RESULT_EVENT
            && row.payload["summary"]
                .as_str()
                .is_some_and(|summary| summary.contains("DIVE did not run"))));
    }

    #[tokio::test]
    async fn pi_path_run_mode_gating_preserves_interview_plan_and_build_rules() {
        let project = tempfile::tempdir().unwrap();

        let (interview_db, interview_session) = create_test_db(project.path());
        let interview_loop = make_loop(
            project.path(),
            interview_db,
            interview_session,
            AgentRunMode::Interview,
            run_mode_permission(
                AgentRunMode::Interview,
                false,
                None,
                Arc::new(AlwaysApproveHook),
            ),
            None,
        );
        assert!(
            interview_loop.tool_defs_for_external_turn().is_empty(),
            "Interview mode must send no tools to Pi"
        );

        let (plan_db, plan_session) = create_test_db(project.path());
        let plan_loop = make_loop(
            project.path(),
            plan_db,
            plan_session,
            AgentRunMode::Plan,
            run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
            None,
        );
        let plan_write = tool_call(
            "plan_write",
            "write_file",
            json!({ "path": "plan-blocked.txt", "content": "no" }),
        );
        let mut plan_events = Vec::new();
        let plan_out = plan_loop
            .execute_supervised_tool_call(plan_session, &plan_write, &mut |event| {
                plan_events.push(event)
            })
            .await
            .unwrap();
        assert!(!plan_out.success);
        assert!(!project.path().join("plan-blocked.txt").exists());
        assert!(plan_events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolCallDenied { id, reason }
                if id == "plan_write" && reason.contains("plan-first")
        )));

        let (build_db, build_session) = create_test_db(project.path());
        let build_loop = make_loop(
            project.path(),
            build_db,
            build_session,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                false,
                None,
                Arc::new(AlwaysApproveHook),
            ),
            None,
        );
        let build_write = tool_call(
            "build_write_blocked",
            "write_file",
            json!({ "path": "build-blocked.txt", "content": "no" }),
        );
        let mut build_events = Vec::new();
        let build_out = build_loop
            .execute_supervised_tool_call(build_session, &build_write, &mut |event| {
                build_events.push(event)
            })
            .await
            .unwrap();
        assert!(!build_out.success);
        assert!(!project.path().join("build-blocked.txt").exists());
        assert!(build_events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolCallDenied { id, reason }
                if id == "build_write_blocked" && reason.contains("approved plan with an active step")
        )));

        let calls = Arc::new(AtomicUsize::new(0));
        let (allowed_db, allowed_session) = create_test_db(project.path());
        let allowed_loop = make_loop(
            project.path(),
            allowed_db,
            allowed_session,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(123),
                Arc::new(RecordingApproveHook {
                    calls: calls.clone(),
                }),
            ),
            None,
        );
        let allowed_write = tool_call(
            "build_write_allowed",
            "write_file",
            json!({ "path": "build-allowed.txt", "content": "yes" }),
        );
        let mut allowed_events = Vec::new();
        let allowed_out = allowed_loop
            .execute_supervised_tool_call(allowed_session, &allowed_write, &mut |event| {
                allowed_events.push(event)
            })
            .await
            .unwrap();
        assert!(allowed_out.success);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            std::fs::read_to_string(project.path().join("build-allowed.txt")).unwrap(),
            "yes"
        );
        assert!(allowed_events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolCallApproved { id } if id == "build_write_allowed"
        )));
    }

    #[tokio::test]
    async fn supervised_write_and_edit_record_card_changed_files_without_checkpoint() {
        let project = tempfile::tempdir().unwrap();
        let (db, session_id) = create_test_db(project.path());
        let card_id = insert_current_card(&db, session_id, "changed-files");
        let loop_ = make_loop(
            project.path(),
            db.clone(),
            session_id,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(1),
                Arc::new(AlwaysApproveHook),
            ),
            None,
        );

        let write = tool_call(
            "write_changed_file",
            "write_file",
            json!({ "path": "src/phase-d.txt", "content": "old" }),
        );
        let edit = tool_call(
            "edit_changed_file",
            "edit_file",
            json!({ "path": "src/phase-d.txt", "find": "old", "replace": "new" }),
        );
        let mut events = Vec::new();
        let write_out = loop_
            .execute_supervised_tool_call(session_id, &write, &mut |event| events.push(event))
            .await
            .unwrap();
        let edit_out = loop_
            .execute_supervised_tool_call(session_id, &edit, &mut |event| events.push(event))
            .await
            .unwrap();
        assert!(write_out.success);
        assert!(edit_out.success);
        assert_eq!(
            std::fs::read_to_string(project.path().join("src/phase-d.txt")).unwrap(),
            "new"
        );

        let db_guard = db.lock().unwrap();
        let card = crate::db::dao::card::get_by_id(db_guard.conn(), card_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            card.changed_files,
            Some(json!([{
                "path": "src/phase-d.txt",
                "diff": {
                    "path": "src/phase-d.txt",
                    "before": "",
                    "after": "old"
                }
            }]))
        );
        let logs = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
        assert_eq!(
            logs.iter()
                .filter(|row| row.r#type == "card_changed_files")
                .count(),
            2
        );
        assert!(logs.iter().any(|row| {
            row.r#type == "card_changed_files"
                && row.payload["paths"] == json!(["src/phase-d.txt"])
                && row.payload["card_id"] == json!(card_id)
        }));
        assert!(
            crate::db::dao::checkpoint::list_by_session(db_guard.conn(), session_id)
                .unwrap()
                .is_empty(),
            "tool execution must not create auto checkpoints; card transitions own that timing"
        );
    }

    #[tokio::test]
    async fn sidecar_cancel_during_streaming_marks_state_cancelled_and_preserves_db() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "stream-cancel.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{ type: "assistant_delta", request_id: message.request_id, delta: "partial" }});
  setInterval(() => {{}}, 1000);
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let (db, session_id) = create_test_db(project.path());
        let cancel = Arc::new(AtomicBool::new(false));
        let loop_ = make_loop(
            project.path(),
            db.clone(),
            session_id,
            AgentRunMode::Plan,
            run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
            Some(cancel.clone()),
        );
        let provider_config_id = 501;
        let keyring = api_keyring(provider_config_id);
        let state_root = tempfile::tempdir().unwrap();
        let cancel_task = tokio::spawn({
            let cancel = cancel.clone();
            async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                cancel.store(true, Ordering::SeqCst);
            }
        });

        let mut events = Vec::new();
        let err = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "cancel during streaming",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .unwrap_err();
        cancel_task.await.unwrap();

        assert!(
            matches!(err, AgentError::Cancelled),
            "unexpected cancel result: {err:?}"
        );
        let state_path = runtime_state_path(state_root.path(), session_id);
        let state: PiRuntimeState =
            serde_json::from_slice(&std::fs::read(&state_path).unwrap()).unwrap();
        assert_eq!(state.status, "cancelled");
        assert_eq!(state.tool_calls_seen, 0);
        assert!(!std::fs::read_to_string(&state_path)
            .unwrap()
            .contains("sk-test-secret"));
        assert!(events.iter().any(
            |event| matches!(event, AgentEvent::AssistantDelta { delta, .. } if delta == "partial")
        ));
        let db_guard = db.lock().unwrap();
        let messages =
            crate::db::dao::message::list_by_session(db_guard.conn(), session_id, 100).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "user");
    }

    #[tokio::test]
    async fn sidecar_crash_after_mutation_does_not_auto_replay_on_next_turn() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let crash_script = write_fake_sidecar(
            scripts.path(),
            "crash-after-tool.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "mutating_call",
      name: "write_file",
      params: {{ path: "replay.txt", content: "once" }}
    }});
  }} else if (message.type === "tool_result") {{
    process.exit(1);
  }}
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let success_script = write_fake_sidecar(
            scripts.path(),
            "success-no-tool.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{ type: "assistant_delta", request_id: message.request_id, delta: "recovered" }});
  emit({{ type: "turn_succeeded", request_id: message.request_id, assistant_text: "recovered" }});
}});
"#,
                fake_sidecar_prelude()
            ),
        );

        let (db, session_id) = create_test_db(project.path());
        insert_current_card(&db, session_id, "no-replay");
        let loop_ = make_loop(
            project.path(),
            db.clone(),
            session_id,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(1),
                Arc::new(AlwaysApproveHook),
            ),
            None,
        );
        let provider_config_id = 502;
        let keyring = api_keyring(provider_config_id);
        let state_root = tempfile::tempdir().unwrap();

        {
            let _guard = set_test_sidecar_script_path(crash_script);
            let mut events = Vec::new();
            let err = run_supervised_turn(
                &keyring,
                &api_key_descriptor(),
                provider_config_id,
                &loop_,
                session_id,
                "run a mutating tool then crash",
                Some(state_root.path().to_path_buf()),
                &mut |event| events.push(event),
            )
            .await
            .unwrap_err();
            assert!(
                matches!(err, AgentError::Internal(message) if message.contains("pi sidecar exited"))
            );
            assert!(events.iter().any(|event| matches!(
                event,
                AgentEvent::ToolResult { call_id, success: true, .. } if call_id == "mutating_call"
            )));
        }

        assert_eq!(
            std::fs::read_to_string(project.path().join("replay.txt")).unwrap(),
            "once"
        );
        let first_state: PiRuntimeState = serde_json::from_slice(
            &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
        )
        .expect("synthetic sidecar event parity turn");
        assert_eq!(first_state.status, "crashed");
        assert_eq!(first_state.tool_calls_seen, 1);

        {
            let _guard = set_test_sidecar_script_path(success_script);
            let mut events = Vec::new();
            let result = run_supervised_turn(
                &keyring,
                &api_key_descriptor(),
                provider_config_id,
                &loop_,
                session_id,
                "recover without replay",
                Some(state_root.path().to_path_buf()),
                &mut |event| events.push(event),
            )
            .await
            .unwrap();
            assert_eq!(result.tool_calls_seen, 0);
            assert_eq!(result.assistant_text, "recovered");
            assert!(!events.iter().any(|event| matches!(
                event,
                AgentEvent::ToolCallStart { id, .. } if id == "mutating_call"
            )));
        }

        assert_eq!(
            std::fs::read_to_string(project.path().join("replay.txt")).unwrap(),
            "once"
        );
        let db_guard = db.lock().unwrap();
        let tool_result_logs =
            crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id)
                .unwrap()
                .into_iter()
                .filter(|row| row.r#type == "tool_result")
                .count();
        assert_eq!(tool_result_logs, 1);
    }

    #[tokio::test]
    async fn synthetic_sidecar_events_map_to_legacy_agent_event_surface() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("phase-d.txt"), "sidecar input").unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "event-parity.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{ type: "reasoning_delta", request_id: message.request_id, delta: "think " }});
    emit({{ type: "assistant_delta", request_id: message.request_id, delta: "before " }});
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "read_call",
      name: "read_file",
      params: {{ path: "phase-d.txt" }}
    }});
  }} else if (message.type === "tool_result") {{
    emit({{ type: "tool_call_end", request_id: "event-parity", tool_call_id: message.tool_call_id }});
    emit({{ type: "assistant_delta", request_id: "event-parity", delta: "after" }});
    emit({{ type: "turn_succeeded", request_id: "event-parity", assistant_text: "before after" }});
  }}
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db.clone(),
            session_id,
            AgentRunMode::Plan,
            run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
            None,
        );
        let provider_config_id = 503;
        let keyring = api_keyring(provider_config_id);
        let mut events = Vec::new();
        let result = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "feed synthetic sidecar events",
            None,
            &mut |event| events.push(event),
        )
        .await
        .unwrap();

        assert_eq!(result.assistant_text, "before after");
        assert_eq!(result.tool_calls_seen, 1);
        assert_eq!(
            event_kinds(&events),
            vec![
                "user_message",
                "assistant_start",
                "assistant_delta",
                "reasoning",
                "tool_call_start",
                "tool_call_approved",
                "tool_result",
                "assistant_delta",
                "assistant_end",
            ]
        );
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolResult { call_id, success: true, .. } if call_id == "read_call"
        )));
        let db_guard = db.lock().unwrap();
        let messages =
            crate::db::dao::message::list_by_session(db_guard.conn(), session_id, 100).unwrap();
        let assistant = messages
            .iter()
            .find(|message| message.role == "assistant")
            .unwrap();
        assert_eq!(assistant.content, "before after");
        assert_eq!(assistant.reasoning_content.as_deref(), Some("think"));

        let mapped_reasoning = map_sidecar_delta_event(
            &serde_json::from_value::<SidecarEvent>(json!({
                "type": "reasoning_delta",
                "delta": "hidden"
            }))
            .unwrap(),
            "assistant",
        );
        assert!(
            mapped_reasoning.is_none(),
            "reasoning deltas must not create extra UI AgentEvents compared with legacy streaming"
        );
    }

    #[tokio::test]
    async fn sidecar_tool_calls_arriving_during_tool_execution_are_buffered() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("first.txt"), "one").unwrap();
        std::fs::write(project.path().join("second.txt"), "two").unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "queued-tool-calls.mjs",
            &format!(
                r#"{}
let resultsSeen = 0;
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "first_read",
      name: "read_file",
      params: {{ path: "first.txt" }}
    }});
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "second_read",
      name: "read_file",
      params: {{ path: "second.txt" }}
    }});
  }} else if (message.type === "tool_result") {{
    resultsSeen += 1;
    emit({{ type: "tool_call_end", request_id: "queued-tool-calls", tool_call_id: message.tool_call_id }});
    if (resultsSeen === 2) {{
      emit({{ type: "assistant_delta", request_id: "queued-tool-calls", delta: "done" }});
      emit({{ type: "turn_succeeded", request_id: "queued-tool-calls", assistant_text: "done" }});
    }}
  }}
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db,
            session_id,
            AgentRunMode::Plan,
            run_mode_permission(
                AgentRunMode::Plan,
                false,
                None,
                Arc::new(DelayedApproveHook {
                    delay: Duration::from_millis(50),
                }),
            ),
            None,
        );
        let provider_config_id = 504;
        let keyring = api_keyring(provider_config_id);
        let mut events = Vec::new();
        let result = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "read two files",
            None,
            &mut |event| events.push(event),
        )
        .await
        .unwrap();

        assert_eq!(result.assistant_text, "done");
        assert_eq!(result.tool_calls_seen, 2);
        let tool_results = events
            .iter()
            .filter(|event| matches!(event, AgentEvent::ToolResult { success: true, .. }))
            .count();
        assert_eq!(tool_results, 2);
    }

    #[tokio::test]
    async fn sidecar_error_event_emits_retryable_agent_error_and_error_state() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "error-event.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{ type: "error", request_id: message.request_id, message: "synthetic sidecar failure" }});
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db,
            session_id,
            AgentRunMode::Plan,
            run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
            None,
        );
        let provider_config_id = 504;
        let keyring = api_keyring(provider_config_id);
        let state_root = tempfile::tempdir().unwrap();
        let mut events = Vec::new();
        let err = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "error mapping",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, AgentError::Internal(ref message) if message.contains("synthetic sidecar failure")),
            "unexpected sidecar error mapping result: {err:?}"
        );
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::Error { message, retryable: true }
                if message.contains("synthetic sidecar failure")
        )));
        let state: PiRuntimeState = serde_json::from_slice(
            &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(state.status, "error");
        assert!(state
            .error
            .as_deref()
            .unwrap_or("")
            .contains("synthetic sidecar failure"));
    }

    #[tokio::test]
    async fn sidecar_heartbeat_stall_is_retryable_runtime_error_and_error_state() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "heartbeat-stall.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  setInterval(() => {{}}, 1000);
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let _timing = set_test_sidecar_timing(Duration::from_secs(2), Duration::from_millis(100));
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db,
            session_id,
            AgentRunMode::Plan,
            run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
            None,
        );
        let provider_config_id = 505;
        let keyring = api_keyring(provider_config_id);
        let state_root = tempfile::tempdir().unwrap();
        let mut events = Vec::new();
        let err = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "stall without heartbeat",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .unwrap_err();

        assert!(
            matches!(err, AgentError::Internal(ref message) if message.contains("heartbeat stalled")),
            "unexpected heartbeat stall result: {err:?}"
        );
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::Error { message, retryable: true } if message.contains("heartbeat stalled")
        )));
        let state: PiRuntimeState = serde_json::from_slice(
            &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(state.status, "error");
        assert!(state
            .error
            .as_deref()
            .unwrap_or("")
            .contains("heartbeat stalled"));
    }

    #[tokio::test]
    async fn long_pi_turn_with_heartbeats_is_bounded_by_turn_timeout() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "heartbeat-timeout.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  setInterval(() => emit({{ type: "heartbeat", request_id: message.request_id, ts: Date.now() }}), 20);
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let _timing = set_test_sidecar_timing(Duration::from_millis(250), Duration::from_secs(60));
        let (db, session_id) = create_test_db(project.path());
        let loop_ = make_loop(
            project.path(),
            db,
            session_id,
            AgentRunMode::Plan,
            run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
            None,
        );
        let provider_config_id = 506;
        let keyring = api_keyring(provider_config_id);
        let state_root = tempfile::tempdir().unwrap();
        let started = Instant::now();
        let mut events = Vec::new();
        let err = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "keep running until bounded",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .unwrap_err();

        assert!(
            started.elapsed() < Duration::from_secs(5),
            "turn timeout test exceeded expected bound"
        );
        assert!(
            matches!(err, AgentError::Internal(ref message) if message.contains("turn timed out")),
            "unexpected turn timeout result: {err:?}"
        );
        let state: PiRuntimeState = serde_json::from_slice(
            &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(state.status, "error");
        assert!(state
            .error
            .as_deref()
            .unwrap_or("")
            .contains("turn timed out"));
    }

    #[tokio::test]
    async fn slow_human_approval_does_not_expire_the_turn_budget() {
        // Regression for Critical-5 (2026-06-10): the 120s Pi turn budget used to
        // include human approval time, so a student deliberating on a permission
        // card past the budget killed the turn and discarded the approved write.
        // Here the turn budget is 200ms but the approval takes 600ms; the turn
        // must still succeed and the file must be written.
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "slow-approval.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "slow_call",
      name: "write_file",
      params: {{ path: "slow.txt", content: "approved" }}
    }});
  }} else if (message.type === "tool_result") {{
    emit({{ type: "turn_succeeded", request_id: message.request_id, assistant_text: "done" }});
  }}
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        // Tiny turn budget, generous heartbeat-stall so only the budget could
        // (wrongly) fire during the approval wait.
        let _timing = set_test_sidecar_timing(Duration::from_millis(200), Duration::from_secs(60));
        let (db, session_id) = create_test_db(project.path());
        insert_current_card(&db, session_id, "slow-approval");
        let loop_ = make_loop(
            project.path(),
            db,
            session_id,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(1),
                Arc::new(SlowApproveHook {
                    delay: Duration::from_millis(600),
                }),
            ),
            None,
        );
        let provider_config_id = 507;
        let keyring = api_keyring(provider_config_id);
        let state_root = tempfile::tempdir().unwrap();
        let mut events = Vec::new();
        let result = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "write a file but approve slowly",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .expect("slow approval should not time out the turn");

        assert_eq!(result.tool_calls_seen, 1);
        assert_eq!(
            std::fs::read_to_string(project.path().join("slow.txt")).unwrap(),
            "approved"
        );
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolResult { call_id, success: true, .. } if call_id == "slow_call"
        )));
        let state: PiRuntimeState = serde_json::from_slice(
            &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(state.status, "completed");
    }

    #[tokio::test]
    async fn long_pi_turn_with_heartbeats_is_cancellable_mid_turn() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "heartbeat-cancel.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type !== "run") return;
  ready(message);
  emit({{ type: "assistant_delta", request_id: message.request_id, delta: "." }});
  setInterval(() => emit({{ type: "heartbeat", request_id: message.request_id, ts: Date.now() }}), 20);
  setInterval(() => emit({{ type: "assistant_delta", request_id: message.request_id, delta: "." }}), 20);
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let _timing = set_test_sidecar_timing(Duration::from_secs(2), Duration::from_secs(60));
        let (db, session_id) = create_test_db(project.path());
        let cancel = Arc::new(AtomicBool::new(false));
        let loop_ = make_loop(
            project.path(),
            db,
            session_id,
            AgentRunMode::Plan,
            run_mode_permission(AgentRunMode::Plan, false, None, Arc::new(AlwaysApproveHook)),
            Some(cancel.clone()),
        );
        let provider_config_id = 507;
        let keyring = api_keyring(provider_config_id);
        let state_root = tempfile::tempdir().unwrap();
        let cancel_task = tokio::spawn({
            let cancel = cancel.clone();
            async move {
                tokio::time::sleep(Duration::from_millis(100)).await;
                cancel.store(true, Ordering::SeqCst);
            }
        });

        let started = Instant::now();
        let mut events = Vec::new();
        let err = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "cancel long Pi turn",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .unwrap_err();
        cancel_task.await.unwrap();

        assert!(
            started.elapsed() < Duration::from_secs(5),
            "cancel did not interrupt the long Pi turn"
        );
        assert!(
            matches!(err, AgentError::Cancelled),
            "unexpected long-turn cancel result: {err:?}"
        );
        assert!(events.iter().any(
            |event| matches!(event, AgentEvent::AssistantDelta { delta, .. } if delta == ".")
        ));
        let state: PiRuntimeState = serde_json::from_slice(
            &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(state.status, "cancelled");
    }

    #[tokio::test]
    async fn pending_tool_approval_cancel_aborts_sidecar_and_clears_pending_approvals() {
        let _serial = fake_sidecar_test_lock();
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("approval.txt"), "pending").unwrap();
        let scripts = tempfile::tempdir().unwrap();
        let script = write_fake_sidecar(
            scripts.path(),
            "pending-approval-cancel.mjs",
            &format!(
                r#"{}
rl.on("line", (line) => {{
  const message = JSON.parse(line);
  if (message.type === "run") {{
    ready(message);
    emit({{
      type: "tool_call",
      request_id: message.request_id,
      tool_call_id: "approval_call",
      name: "read_file",
      params: {{ path: "approval.txt" }}
    }});
    setInterval(() => emit({{ type: "heartbeat", request_id: message.request_id, ts: Date.now() }}), 20);
  }} else if (message.type === "tool_result") {{
    emit({{ type: "turn_succeeded", request_id: "pending-approval-cancel", assistant_text: "unexpected" }});
  }}
}});
"#,
                fake_sidecar_prelude()
            ),
        );
        let _guard = set_test_sidecar_script_path(script);
        let _timing = set_test_sidecar_timing(Duration::from_secs(2), Duration::from_secs(60));
        let (db, session_id) = create_test_db(project.path());
        let step_context = insert_active_step_mapping(&db, session_id);
        let pending = PendingApprovals::new();
        let cancel = Arc::new(AtomicBool::new(false));
        let mut loop_ = make_loop(
            project.path(),
            db.clone(),
            session_id,
            AgentRunMode::Build,
            run_mode_permission(
                AgentRunMode::Build,
                true,
                Some(step_context.step_id),
                Arc::new(AwaitUserHook::new(pending.clone(), false)),
            ),
            Some(cancel.clone()),
        );
        loop_.step_context = Some(step_context.clone());
        let provider_config_id = 508;
        let keyring = api_keyring(provider_config_id);
        let state_root = tempfile::tempdir().unwrap();
        let cancel_task = tokio::spawn({
            let pending = pending.clone();
            let cancel = cancel.clone();
            async move {
                for _ in 0..100 {
                    if pending.pending_count() > 0 {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                assert_eq!(pending.pending_count(), 1);
                cancel.store(true, Ordering::SeqCst);
            }
        });

        let mut events = Vec::new();
        let err = run_supervised_turn(
            &keyring,
            &api_key_descriptor(),
            provider_config_id,
            &loop_,
            session_id,
            "cancel while approval is pending",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .unwrap_err();
        cancel_task.await.unwrap();

        assert!(
            matches!(err, AgentError::Cancelled),
            "unexpected pending approval cancel result: {err:?}"
        );
        assert_eq!(pending.pending_count(), 0);
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolCallStart { id, .. } if id == "approval_call"
        )));
        assert!(!events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolResult { call_id, .. } if call_id == "approval_call"
        )));
        let state: PiRuntimeState = serde_json::from_slice(
            &std::fs::read(runtime_state_path(state_root.path(), session_id)).unwrap(),
        )
        .unwrap();
        assert_eq!(state.status, "cancelled");
        assert_eq!(state.tool_calls_seen, 1);

        let db_guard = db.lock().unwrap();
        let mapping = crate::db::dao::step_session_mapping::get_by_step(
            db_guard.conn(),
            step_context.step_id,
        )
        .unwrap()
        .unwrap();
        assert_eq!(mapping.status, "blocked");
        let logs = crate::db::dao::event_log::list_by_session(db_guard.conn(), session_id).unwrap();
        assert!(logs.iter().any(|row| {
            row.r#type == "plan_step_state_changed"
                && row.payload["message"] == "Step blocked by retryable Pi runtime error"
                && row.payload["runtime"] == "pi_sidecar"
        }));
    }

    #[tokio::test]
    #[ignore = "requires DIVE_PI_OPENAI_API_KEY and DIVE_PI_OPENAI_MODEL; widens allowlist only after this passes on a real host"]
    async fn live_openai_provider_parity_smoke() {
        live_api_key_provider_parity_smoke(
            "openai",
            "DIVE_PI_OPENAI_API_KEY",
            "DIVE_PI_OPENAI_MODEL",
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requires DIVE_PI_ANTHROPIC_API_KEY and DIVE_PI_ANTHROPIC_MODEL; widens allowlist only after this passes on a real host"]
    async fn live_anthropic_provider_parity_smoke() {
        live_api_key_provider_parity_smoke(
            "anthropic",
            "DIVE_PI_ANTHROPIC_API_KEY",
            "DIVE_PI_ANTHROPIC_MODEL",
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requires DIVE_PI_OPENROUTER_API_KEY and DIVE_PI_OPENROUTER_MODEL; widens allowlist only after this passes on a real host"]
    async fn live_openrouter_provider_parity_smoke() {
        live_api_key_provider_parity_smoke(
            "openrouter",
            "DIVE_PI_OPENROUTER_API_KEY",
            "DIVE_PI_OPENROUTER_MODEL",
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "custom OpenAI-compatible Pi provider registration/base URL is explicitly deferred; scaffold only"]
    async fn live_custom_openai_provider_parity_smoke_deferred() {
        panic!(
            "manual/live scaffold: custom provider parity requires Phase A2/A3 custom base-url registration before it can run"
        );
    }

    #[tokio::test]
    #[ignore = "requires local DIVE Codex OAuth keyring credentials and performs a live model turn"]
    async fn live_codex_smoke_uses_dive_keyring_and_custom_tool() {
        let provider_config_id = std::env::var("DIVE_PI_SIDECAR_LIVE_PROVIDER_CONFIG_ID")
            .expect("set DIVE_PI_SIDECAR_LIVE_PROVIDER_CONFIG_ID")
            .parse::<i64>()
            .expect("provider id must be an integer");
        let cwd = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("app dir")
            .parent()
            .expect("repo dir")
            .to_path_buf();
        let keyring = auth::OsKeyring::new();
        let model = std::env::var("DIVE_PI_SIDECAR_LIVE_MODEL").ok();
        let result = run_codex_smoke(&keyring, provider_config_id, cwd, model)
            .await
            .expect("live pi sidecar smoke");
        #[cfg(unix)]
        assert_eq!(result.auth_file_mode, "600");
        #[cfg(not(unix))]
        assert_eq!(result.auth_file_mode, "platform-default");
        assert_eq!(result.enabled_tools, ["dive_context"]);
        assert_eq!(result.tool_calls_seen, 1);
        assert_eq!(result.assistant_text, SMOKE_MARKER);
    }

    #[tokio::test]
    #[ignore = "requires local DIVE Codex OAuth keyring credentials and performs a live supervised DIVE tool turn"]
    async fn live_supervised_turn_uses_dive_tool_execution() {
        let provider_config_id = std::env::var("DIVE_PI_SIDECAR_LIVE_PROVIDER_CONFIG_ID")
            .expect("set DIVE_PI_SIDECAR_LIVE_PROVIDER_CONFIG_ID")
            .parse::<i64>()
            .expect("provider id must be an integer");
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("phase3.txt"),
            "phase3 supervised tool body",
        )
        .unwrap();

        let mut db = crate::db::Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let project_id = crate::db::dao::project::insert(
            db.conn(),
            &crate::db::models::NewProject {
                name: "phase3".into(),
                path: project.path().display().to_string(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let session_id = crate::db::dao::session::insert(
            db.conn(),
            &crate::db::models::NewSession {
                project_id,
                title: "phase3".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap();

        let loop_ = AgentLoop::builder()
            .provider(std::sync::Arc::new(crate::providers::MockProvider::new(
                Vec::new(),
            )))
            .registry(std::sync::Arc::new(
                crate::tools::ToolRegistry::with_builtins(),
            ))
            .permission(std::sync::Arc::new(
                crate::agent::RunModePermissionHook::new(
                    crate::agent::AgentRunMode::Plan,
                    std::sync::Arc::new(crate::agent::AlwaysApproveHook),
                ),
            ))
            .db(std::sync::Arc::new(std::sync::Mutex::new(db)))
            .tool_ctx(crate::tools::ToolContext::new(project.path(), session_id))
            .model(DEFAULT_MODEL)
            .run_mode(crate::agent::AgentRunMode::Plan)
            .build()
            .unwrap();

        let keyring = auth::OsKeyring::new();
        let state_root = tempfile::tempdir().unwrap();
        let mut events = Vec::new();
        let result = run_codex_supervised_turn(
            &keyring,
            provider_config_id,
            &loop_,
            session_id,
            "Use the read_file tool exactly once with path \"phase3.txt\". After the tool result, reply exactly DIVE_PI_SUPERVISED_TOOL_OK and nothing else.",
            Some(state_root.path().to_path_buf()),
            &mut |event| events.push(event),
        )
        .await
        .expect("live supervised turn");

        assert_eq!(result.auth_file_mode, "600");
        assert_eq!(
            result.enabled_tools,
            [
                "delete_file",
                "edit_file",
                "list_dir",
                "mkdir",
                "preview_open",
                "read_file",
                "run_process",
                "run_terminal_script",
                "search_files",
                "write_file"
            ]
        );
        assert_eq!(result.tool_calls_seen, 1);
        assert_eq!(result.assistant_text, "DIVE_PI_SUPERVISED_TOOL_OK");
        let state_path = runtime_state_path(state_root.path(), session_id);
        let state: PiRuntimeState =
            serde_json::from_slice(&std::fs::read(&state_path).unwrap()).unwrap();
        assert_eq!(state.status, "completed");
        assert_eq!(state.tool_calls_seen, 1);
        assert_eq!(state.message_count, 1);
        assert_eq!(file_mode_string(&state_path).unwrap(), "600");
        assert!(state.error.is_none());
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::ToolResult { success: true, .. })));
    }
}
