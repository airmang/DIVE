use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(test)]
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration, Instant};

use crate::agent::{AgentError, AgentEvent, AgentLoop};
use crate::auth::{self, Keyring};
use crate::providers::{FinishReason, Message as ProviderMessage, ToolCall, ToolDef};

pub mod parity;

use parity::{CredentialMode, PiProviderDescriptor};

const PROVIDER_ID: &str = "openai-codex";
const DEFAULT_MODEL: &str = "gpt-5.4-mini";
const SMOKE_MARKER: &str = "DIVE_PI_SIDECAR_TOOL_OK";
const SMOKE_PROMPT: &str = "Use the dive_context tool exactly once with request \"phase2-smoke\". After the tool result, reply exactly DIVE_PI_SIDECAR_TOOL_OK and nothing else.";
const PI_TURN_TIMEOUT: Duration = Duration::from_secs(120);
const SIDECAR_HEARTBEAT_STALL_TIMEOUT: Duration = Duration::from_secs(20);
const RUNTIME_STATE_PROTOCOL_VERSION: u32 = 1;
const SIDECAR_CANCELLED: &str = "pi sidecar turn cancelled";

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PiRuntimeState {
    pub protocol_version: u32,
    pub session_id: i64,
    pub request_id: String,
    pub provider_config_id: i64,
    pub provider: String,
    pub model: String,
    pub cwd: String,
    pub tool_names: Vec<String>,
    pub message_count: usize,
    pub auth_file_mode: String,
    pub status: String,
    pub tool_calls_seen: usize,
    pub started_at: u64,
    pub updated_at: u64,
    pub completed_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum SidecarEvent {
    Ready {
        model: String,
        enabled_tools: Vec<String>,
    },
    ToolCall {
        tool_call_id: String,
        name: String,
        #[allow(dead_code)]
        params: serde_json::Value,
    },
    AssistantDelta {
        delta: String,
    },
    ReasoningDelta {
        delta: String,
    },
    ToolCallEnd {
        #[allow(dead_code)]
        tool_call_id: String,
    },
    TurnSucceeded {
        assistant_text: String,
    },
    Error {
        message: String,
    },
    Heartbeat {
        #[allow(dead_code)]
        request_id: Option<String>,
        #[allow(dead_code)]
        turn_id: Option<String>,
        #[allow(dead_code)]
        ts: Option<u64>,
    },
}

fn map_sidecar_delta_event(event: &SidecarEvent, assistant_id: &str) -> Option<AgentEvent> {
    match event {
        SidecarEvent::AssistantDelta { delta } => Some(AgentEvent::AssistantDelta {
            id: assistant_id.to_string(),
            delta: delta.clone(),
        }),
        // Legacy provider streaming stores reasoning deltas for assistant-message
        // persistence, but does not emit a UI-facing AgentEvent per token.
        SidecarEvent::ReasoningDelta { .. } => None,
        _ => None,
    }
}

#[derive(Debug, Clone, Copy)]
struct SidecarTiming {
    turn_timeout: Duration,
    heartbeat_stall_timeout: Duration,
}

fn sidecar_timing() -> SidecarTiming {
    #[cfg(test)]
    {
        if let Some(timing) = TEST_SIDECAR_TIMING
            .get_or_init(|| Mutex::new(None))
            .lock()
            .ok()
            .and_then(|guard| *guard)
        {
            return timing;
        }
    }

    SidecarTiming {
        turn_timeout: PI_TURN_TIMEOUT,
        heartbeat_stall_timeout: SIDECAR_HEARTBEAT_STALL_TIMEOUT,
    }
}

enum SidecarReadMessage {
    Event(SidecarEvent),
    Eof,
    Error(String),
}

fn spawn_sidecar_stdout_reader(
    stdout: tokio::process::ChildStdout,
) -> mpsc::Receiver<SidecarReadMessage> {
    let (tx, rx) = mpsc::channel(64);
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    let message = match serde_json::from_str::<SidecarEvent>(&line) {
                        Ok(event) => SidecarReadMessage::Event(event),
                        Err(err) => SidecarReadMessage::Error(format!(
                            "parse sidecar event: {err}: {}",
                            redact_line(&line)
                        )),
                    };
                    if tx.send(message).await.is_err() {
                        return;
                    }
                }
                Ok(None) => {
                    let _ = tx.send(SidecarReadMessage::Eof).await;
                    return;
                }
                Err(err) => {
                    let _ = tx
                        .send(SidecarReadMessage::Error(format!(
                            "read sidecar event: {err}"
                        )))
                        .await;
                    return;
                }
            }
        }
    });
    rx
}

fn remaining_turn_budget(started: Instant, timeout: Duration) -> Result<Duration, String> {
    timeout
        .checked_sub(started.elapsed())
        .ok_or_else(|| "pi sidecar turn timed out".to_string())
}

async fn next_sidecar_event(
    rx: &mut mpsc::Receiver<SidecarReadMessage>,
    started: Instant,
    timing: SidecarTiming,
) -> Result<SidecarEvent, String> {
    let remaining = remaining_turn_budget(started, timing.turn_timeout)?;
    let wait_for = remaining.min(timing.heartbeat_stall_timeout);
    match timeout(wait_for, rx.recv()).await {
        Ok(Some(SidecarReadMessage::Event(event))) => Ok(event),
        Ok(Some(SidecarReadMessage::Eof)) => {
            Err("pi sidecar stdout closed before turn completion".to_string())
        }
        Ok(Some(SidecarReadMessage::Error(err))) => Err(err),
        Ok(None) => Err("pi sidecar event reader stopped before turn completion".to_string()),
        Err(_) if started.elapsed() >= timing.turn_timeout => {
            Err("pi sidecar turn timed out".to_string())
        }
        Err(_) => Err(format!(
            "pi sidecar heartbeat stalled for {}ms",
            timing.heartbeat_stall_timeout.as_millis()
        )),
    }
}

fn sidecar_event_name(event: &SidecarEvent) -> &'static str {
    match event {
        SidecarEvent::Ready { .. } => "ready",
        SidecarEvent::ToolCall { .. } => "tool_call",
        SidecarEvent::AssistantDelta { .. } => "assistant_delta",
        SidecarEvent::ReasoningDelta { .. } => "reasoning_delta",
        SidecarEvent::ToolCallEnd { .. } => "tool_call_end",
        SidecarEvent::TurnSucceeded { .. } => "turn_succeeded",
        SidecarEvent::Error { .. } => "error",
        SidecarEvent::Heartbeat { .. } => "heartbeat",
    }
}

struct TempAuthDir {
    path: PathBuf,
}

impl TempAuthDir {
    fn create() -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("dive-pi-sidecar-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).map_err(|e| format!("temp auth dir: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("chmod temp auth dir: {e}"))?;
        }
        Ok(Self { path })
    }

    fn auth_path(&self) -> PathBuf {
        self.path.join("auth.json")
    }

    fn agent_dir(&self) -> PathBuf {
        self.path.join("agent")
    }
}

impl Drop for TempAuthDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

enum RuntimeCredential {
    OauthFile {
        _temp: TempAuthDir,
        auth_path: PathBuf,
        auth_file_mode: String,
    },
    ApiKey {
        api_key: String,
        auth_file_mode: String,
    },
}

impl RuntimeCredential {
    fn auth_path(&self) -> Option<&Path> {
        match self {
            Self::OauthFile { auth_path, .. } => Some(auth_path.as_path()),
            Self::ApiKey { .. } => None,
        }
    }

    fn api_key(&self) -> Option<&str> {
        match self {
            Self::OauthFile { .. } => None,
            Self::ApiKey { api_key, .. } => Some(api_key),
        }
    }

    fn auth_file_mode(&self) -> &str {
        match self {
            Self::OauthFile { auth_file_mode, .. } | Self::ApiKey { auth_file_mode, .. } => {
                auth_file_mode
            }
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

    let mut child = Command::new(&sidecar_cmd.program)
        .args(&sidecar_cmd.prefix_args)
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

    let mut child = Command::new(&sidecar_cmd.program)
        .args(&sidecar_cmd.prefix_args)
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
    let mut enabled_tools = Vec::new();
    let mut ready_model = format!("{}/{model}", descriptor.pi_provider_id);
    let mut tool_calls_seen = 0usize;
    let mut assistant_text = String::new();
    let mut reasoning_text = String::new();
    let mut tool_calls = Vec::new();
    let mut pending_tool_call_ids = Vec::new();
    let timing = sidecar_timing();
    let turn_started = Instant::now();

    let read_loop = async {
        loop {
            let cancel = wait_for_cancel(agent_loop.cancel.clone());
            let event = tokio::select! {
                event = next_sidecar_event(&mut sidecar_events, turn_started, timing) => event?,
                _ = cancel => {
                    return Err(SIDECAR_CANCELLED.to_string());
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
                    let out = loop {
                        let cancel = wait_for_cancel(agent_loop.cancel.clone());
                        let event = next_sidecar_event(&mut sidecar_events, turn_started, timing);
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
                                        return Err(format!(
                                            "unexpected sidecar event while executing DIVE tool: {}",
                                            sidecar_event_name(&other)
                                        ));
                                    }
                                }
                            }
                            _ = cancel => {
                                return Err(SIDECAR_CANCELLED.to_string());
                            }
                        }
                    };
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

fn write_codex_auth_file(
    path: &Path,
    access_token: &str,
    refresh_token: &str,
    expires: u64,
    account_id: &str,
) -> Result<(), String> {
    let body = json!({
        PROVIDER_ID: {
            "type": "oauth",
            "access": access_token,
            "refresh": refresh_token,
            "expires": expires,
            "accountId": account_id,
        }
    });
    std::fs::write(
        path,
        format!("{}\n", serde_json::to_string_pretty(&body).unwrap()),
    )
    .map_err(|e| format!("write pi auth.json: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("chmod pi auth.json: {e}"))?;
    }
    Ok(())
}

fn runtime_state_path(root: &Path, session_id: i64) -> PathBuf {
    root.join("pi-sidecar")
        .join("sessions")
        .join(session_id.to_string())
        .join("state.json")
}

fn write_runtime_state(path: &Path, state: &PiRuntimeState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "runtime state path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("create runtime state dir: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("chmod runtime state dir: {e}"))?;
    }
    std::fs::write(
        path,
        format!("{}\n", serde_json::to_string_pretty(state).unwrap()),
    )
    .map_err(|e| format!("write runtime state: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("chmod runtime state: {e}"))?;
    }
    Ok(())
}

fn mark_active_step_blocked_by_pi_runtime_error(
    agent_loop: &AgentLoop,
    session_id: i64,
    message: &str,
) -> Result<(), String> {
    let Some(step_context) = agent_loop.step_context.as_ref() else {
        return Ok(());
    };

    let db = agent_loop.db.lock().map_err(|e| e.to_string())?;
    let Some(mapping) =
        crate::db::dao::step_session_mapping::get_by_step(db.conn(), step_context.step_id)
            .map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    if mapping.status == "done" || mapping.status == "shipped" {
        return Ok(());
    }

    crate::db::dao::step_session_mapping::update_status(db.conn(), mapping.id, "blocked")
        .map_err(|e| e.to_string())?;
    let step = crate::db::dao::step::get_by_id(db.conn(), step_context.step_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {} not found", step_context.step_id))?;
    let plan = crate::db::dao::plan::get_by_id(db.conn(), step.plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {} not found", step.plan_id))?;
    let _ = crate::dive::event_log::append_to_conn(
        db.conn(),
        mapping.session_id.or(Some(session_id)),
        "plan_step_state_changed",
        serde_json::json!({
            "project_id": plan.project_id,
            "plan_id": plan.id,
            "step_id": step.id,
            "stable_step_id": step.step_id,
            "step_title": step.title,
            "message": "Step blocked by retryable Pi runtime error",
            "reason": crate::telemetry::redact_log_text(message),
            "runtime": "pi_sidecar",
        }),
    );
    Ok(())
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

async fn wait_for_cancel(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

async fn send_sidecar_cancel(
    stdin: &mut tokio::process::ChildStdin,
    request_id: &str,
    reason: &str,
) {
    let message = json!({
        "type": "turn_cancel",
        "request_id": request_id,
        "reason": reason,
    });
    let _ = stdin.write_all(format!("{message}\n").as_bytes()).await;
}

fn prepare_runtime_credential(
    keyring: &dyn Keyring,
    descriptor: &PiProviderDescriptor,
    provider_config_id: i64,
) -> Result<RuntimeCredential, String> {
    match descriptor.credential_mode {
        CredentialMode::OauthFile => {
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
            Ok(RuntimeCredential::OauthFile {
                auth_path: temp.auth_path(),
                auth_file_mode,
                _temp: temp,
            })
        }
        CredentialMode::ApiKey => {
            let api_key = auth::load_provider_api_key(keyring, provider_config_id)
                .map_err(|e| format!("keyring: {e}"))?
                .ok_or_else(|| format!("API key not found for provider {provider_config_id}"))?;
            Ok(RuntimeCredential::ApiKey {
                api_key,
                auth_file_mode: "runtime-api-key".to_string(),
            })
        }
    }
}

fn load_codex_auth_entry(
    keyring: &dyn Keyring,
    provider_config_id: i64,
) -> Result<(String, String, String, u64), String> {
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
    Ok((access_token, refresh_token, account_id, expires))
}

fn sorted_tool_names(tools: &[ToolDef]) -> Vec<String> {
    let mut names = tools
        .iter()
        .map(|tool| tool.name.clone())
        .collect::<Vec<_>>();
    names.sort();
    names
}

fn render_messages_for_pi(messages: &[ProviderMessage]) -> String {
    let mut rendered = String::from(
        "You are running inside DIVE's supervised Pi runtime. Use only the DIVE tools provided by this session. Do not claim that you executed a tool unless a DIVE tool result was returned.\n\n",
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

fn default_sidecar_script_path() -> Result<PathBuf, String> {
    #[cfg(test)]
    {
        if let Some(path) = TEST_SIDECAR_SCRIPT_PATH
            .get_or_init(|| Mutex::new(None))
            .lock()
            .map_err(|e| format!("test sidecar script lock: {e}"))?
            .clone()
        {
            return Ok(path);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dive_dir = manifest_dir
        .parent()
        .ok_or_else(|| "cannot resolve DIVE app directory".to_string())?;
    let script = dive_dir.join("pi-sidecar").join("src").join("main.mjs");
    if !script.exists() {
        return Err(format!("pi sidecar script not found: {}", script.display()));
    }
    Ok(script)
}

/// How to launch the sidecar process: a program plus any leading args.
struct SidecarCommand {
    program: String,
    prefix_args: Vec<String>,
}

/// Candidate path of the compiled sidecar binary shipped next to the app
/// executable via Tauri `externalBin`. `None` in contexts without a resolvable
/// executable path (e.g. some test harnesses).
fn bundled_sidecar_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = if cfg!(windows) {
        "dive-pi-sidecar.exe"
    } else {
        "dive-pi-sidecar"
    };
    Some(dir.join(name))
}

/// Resolve how to spawn the sidecar. The packaged app ships a compiled
/// standalone binary (`externalBin`) and runs it directly; development (and any
/// build without the bundled binary present) falls back to `node <script>`.
fn resolve_sidecar_command(bundled: Option<PathBuf>) -> Result<SidecarCommand, String> {
    if let Some(bin) = bundled {
        if bin.exists() {
            return Ok(SidecarCommand {
                program: bin.display().to_string(),
                prefix_args: Vec::new(),
            });
        }
    }
    let script_path = default_sidecar_script_path()?;
    Ok(SidecarCommand {
        program: "node".to_string(),
        prefix_args: vec![script_path.display().to_string()],
    })
}

#[cfg(test)]
static TEST_SIDECAR_SCRIPT_PATH: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();

#[cfg(test)]
static TEST_SIDECAR_TIMING: OnceLock<Mutex<Option<SidecarTiming>>> = OnceLock::new();

#[cfg(test)]
struct TestSidecarScriptPathGuard;

#[cfg(test)]
struct TestSidecarTimingGuard;

#[cfg(test)]
fn set_test_sidecar_script_path(path: PathBuf) -> TestSidecarScriptPathGuard {
    let lock = TEST_SIDECAR_SCRIPT_PATH.get_or_init(|| Mutex::new(None));
    *lock.lock().unwrap() = Some(path);
    TestSidecarScriptPathGuard
}

#[cfg(test)]
fn set_test_sidecar_timing(
    turn_timeout: Duration,
    heartbeat_stall_timeout: Duration,
) -> TestSidecarTimingGuard {
    let lock = TEST_SIDECAR_TIMING.get_or_init(|| Mutex::new(None));
    *lock.lock().unwrap() = Some(SidecarTiming {
        turn_timeout,
        heartbeat_stall_timeout,
    });
    TestSidecarTimingGuard
}

#[cfg(test)]
impl Drop for TestSidecarScriptPathGuard {
    fn drop(&mut self) {
        if let Some(lock) = TEST_SIDECAR_SCRIPT_PATH.get() {
            *lock.lock().unwrap() = None;
        }
    }
}

#[cfg(test)]
impl Drop for TestSidecarTimingGuard {
    fn drop(&mut self) {
        if let Some(lock) = TEST_SIDECAR_TIMING.get() {
            *lock.lock().unwrap() = None;
        }
    }
}

fn decode_jwt_exp_ms(token: &str) -> Option<u64> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload.as_bytes())
        .ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims.get("exp")?.as_u64().map(|seconds| seconds * 1000)
}

fn default_expiry_ms() -> u64 {
    now_epoch_ms() + 55 * 60 * 1000
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn file_mode_string(path: &Path) -> Result<String, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .map_err(|e| format!("stat pi auth.json: {e}"))?
            .permissions()
            .mode()
            & 0o777;
        Ok(format!("{mode:o}"))
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok("platform-default".to_string())
    }
}

fn redact_line(line: &str) -> String {
    line.split_whitespace()
        .map(|part| {
            if part.len() >= 32
                && part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
            {
                "[REDACTED]"
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
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
        PermissionHook, RunModePermissionHook, StepContext,
    };
    use crate::db::models::{CardState, NewCard};
    use crate::tools::RiskLevel;

    struct RecordingApproveHook {
        calls: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl PermissionHook for RecordingApproveHook {
        async fn intercept(&self, _call: &ToolCall, _risk: RiskLevel) -> PermissionDecision {
            self.calls.fetch_add(1, Ordering::SeqCst);
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
    fn writes_pi_codex_auth_file_shape_with_private_mode() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        write_codex_auth_file(&path, "access-token", "refresh-token", 12345, "acct_123").unwrap();

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value[PROVIDER_ID]["type"], "oauth");
        assert_eq!(value[PROVIDER_ID]["access"], "access-token");
        assert_eq!(value[PROVIDER_ID]["refresh"], "refresh-token");
        assert_eq!(value[PROVIDER_ID]["expires"], 12345);
        assert_eq!(value[PROVIDER_ID]["accountId"], "acct_123");

        #[cfg(unix)]
        assert_eq!(file_mode_string(&path).unwrap(), "600");
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
    fn dev_resolution_falls_back_to_node_with_a_script() {
        let cmd = resolve_sidecar_command(None).expect("dev resolution");
        assert_eq!(cmd.program, "node");
        assert_eq!(cmd.prefix_args.len(), 1);
        assert!(cmd.prefix_args[0].ends_with(".mjs"));
    }

    #[test]
    fn release_resolution_uses_bundled_binary_when_present() {
        // A path that exists stands in for a shipped bundled binary.
        let present = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("pi_sidecar.rs");
        let cmd = resolve_sidecar_command(Some(present.clone())).expect("release resolution");
        assert_eq!(cmd.program, present.display().to_string());
        assert!(cmd.prefix_args.is_empty());
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
    fn runtime_state_is_private_and_secret_free() {
        let dir = tempfile::tempdir().unwrap();
        let path = runtime_state_path(dir.path(), 42);
        let state = PiRuntimeState {
            protocol_version: RUNTIME_STATE_PROTOCOL_VERSION,
            session_id: 42,
            request_id: "req-test".into(),
            provider_config_id: 2,
            provider: PROVIDER_ID.into(),
            model: DEFAULT_MODEL.into(),
            cwd: "/tmp/project".into(),
            tool_names: vec!["read_file".into()],
            message_count: 3,
            auth_file_mode: "600".into(),
            status: "running".into(),
            tool_calls_seen: 0,
            started_at: 1,
            updated_at: 2,
            completed_at: None,
            error: None,
        };
        write_runtime_state(&path, &state).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"status\": \"running\""));
        assert!(!raw.contains("access"));
        assert!(!raw.contains("refresh"));
        assert!(!raw.contains("accountId"));
        #[cfg(unix)]
        assert_eq!(file_mode_string(&path).unwrap(), "600");
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
        assert_eq!(card.changed_files, Some(json!(["src/phase-d.txt"])));
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
        let result = run_codex_smoke(&keyring, provider_config_id, cwd, None)
            .await
            .expect("live pi sidecar smoke");
        assert_eq!(result.auth_file_mode, "600");
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
                "read_file",
                "run_process",
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
