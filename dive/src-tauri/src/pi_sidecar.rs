use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::agent::{AgentError, AgentEvent, AgentLoop};
use crate::auth::{self, Keyring};
use crate::providers::{FinishReason, Message as ProviderMessage, ToolCall, ToolDef};

const PROVIDER_ID: &str = "openai-codex";
const DEFAULT_MODEL: &str = "gpt-5.4-mini";
const SMOKE_MARKER: &str = "DIVE_PI_SIDECAR_TOOL_OK";
const SMOKE_PROMPT: &str = "Use the dive_context tool exactly once with request \"phase2-smoke\". After the tool result, reply exactly DIVE_PI_SIDECAR_TOOL_OK and nothing else.";
const SIDECAR_TIMEOUT: Duration = Duration::from_secs(120);
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

#[derive(Debug, Deserialize)]
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
    TurnSucceeded {
        assistant_text: String,
    },
    Error {
        message: String,
    },
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
    let script = default_sidecar_script_path()?;

    let mut child = Command::new("node")
        .arg(script)
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

    timeout(SIDECAR_TIMEOUT, read_loop)
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
    let turn = agent_loop
        .begin_external_turn(session_id, user_input, emit)
        .await?;
    let assistant_id = uuid::Uuid::new_v4().to_string();
    emit(AgentEvent::AssistantStart {
        id: assistant_id.clone(),
        created_at: crate::db::now_ms(),
    });

    let result = run_codex_supervised_turn_inner(
        keyring,
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
async fn run_codex_supervised_turn_inner(
    keyring: &dyn Keyring,
    provider_config_id: i64,
    agent_loop: &AgentLoop,
    session_id: i64,
    assistant_id: String,
    messages: Vec<ProviderMessage>,
    current_card_id: Option<i64>,
    runtime_state_root: Option<PathBuf>,
    emit: &mut (dyn FnMut(AgentEvent) + Send),
) -> Result<PiSidecarTurnResult, String> {
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
    let model = agent_loop.model.clone();
    let request_id = uuid::Uuid::new_v4().to_string();
    let script = default_sidecar_script_path()?;
    let tools = agent_loop.tool_defs_for_external_turn();
    let expected_tools = sorted_tool_names(&tools);
    let state_path = runtime_state_root
        .as_ref()
        .map(|root| runtime_state_path(root, session_id));
    let mut runtime_state = PiRuntimeState {
        protocol_version: RUNTIME_STATE_PROTOCOL_VERSION,
        session_id,
        request_id: request_id.clone(),
        provider_config_id,
        provider: PROVIDER_ID.to_string(),
        model: model.clone(),
        cwd: agent_loop.tool_ctx.project_root.display().to_string(),
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

    let mut child = Command::new("node")
        .arg(script)
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
        "cwd": agent_loop.tool_ctx.project_root.display().to_string(),
        "provider": PROVIDER_ID,
        "model": model,
        "prompt": render_messages_for_pi(&messages),
        "tools": tools,
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
    let mut tool_calls = Vec::new();

    let read_loop = async {
        loop {
            let cancel = wait_for_cancel(agent_loop.cancel.clone());
            let line = tokio::select! {
                line = reader.next_line() => line.map_err(|e| format!("read sidecar event: {e}"))?,
                _ = cancel => {
                    return Err(SIDECAR_CANCELLED.to_string());
                }
            };
            let Some(line) = line else {
                break;
            };
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
                    tool_calls.push(tc.clone());
                    let out = agent_loop
                        .execute_supervised_tool_call(session_id, &tc, emit)
                        .await
                        .map_err(|e| e.to_string())?;
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
                    emit(AgentEvent::AssistantDelta {
                        id: assistant_id.clone(),
                        delta,
                    });
                }
                SidecarEvent::TurnSucceeded { assistant_text: text } => {
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

    let read_result = timeout(SIDECAR_TIMEOUT, read_loop)
        .await
        .map_err(|_| "pi sidecar turn timed out".to_string())?;
    if let Err(err) = read_result {
        let _ = child.kill().await;
        runtime_state.status = if err == SIDECAR_CANCELLED {
            "cancelled".to_string()
        } else {
            "error".to_string()
        };
        runtime_state.error = Some(redact_line(&err));
        runtime_state.updated_at = now_epoch_ms();
        runtime_state.completed_at = Some(now_epoch_ms());
        if let Some(path) = &state_path {
            let _ = write_runtime_state(path, &runtime_state);
        }
        return Err(err);
    }
    drop(stdin);

    let status = child
        .wait()
        .await
        .map_err(|e| format!("wait pi sidecar: {e}"))?;
    let stderr_lines = stderr_task.await.unwrap_or_default();
    if !status.success() {
        runtime_state.status = "crashed".to_string();
        runtime_state.error = Some(format!("pi sidecar exited with {status}"));
        runtime_state.updated_at = now_epoch_ms();
        runtime_state.completed_at = Some(now_epoch_ms());
        if let Some(path) = &state_path {
            let _ = write_runtime_state(path, &runtime_state);
        }
        return Err(format!(
            "pi sidecar exited with {status}; stderr={}",
            stderr_lines.join("\\n")
        ));
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
            None,
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

async fn wait_for_cancel(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(10)).await;
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
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dive_dir = manifest_dir
        .parent()
        .ok_or_else(|| "cannot resolve DIVE app directory".to_string())?;
    let script = dive_dir.join("pi-sidecar").join("src").join("index.mjs");
    if !script.exists() {
        return Err(format!("pi sidecar script not found: {}", script.display()));
    }
    Ok(script)
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
    use super::*;

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
            .registry(std::sync::Arc::new(crate::tools::ToolRegistry::with_builtins()))
            .permission(std::sync::Arc::new(crate::agent::RunModePermissionHook::new(
                crate::agent::AgentRunMode::Plan,
                std::sync::Arc::new(crate::agent::AlwaysApproveHook),
            )))
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
        std::fs::write(project.path().join("phase3.txt"), "phase3 supervised tool body").unwrap();

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
            .registry(std::sync::Arc::new(crate::tools::ToolRegistry::with_builtins()))
            .permission(std::sync::Arc::new(crate::agent::RunModePermissionHook::new(
                crate::agent::AgentRunMode::Plan,
                std::sync::Arc::new(crate::agent::AlwaysApproveHook),
            )))
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
        assert!(events.iter().any(|event| matches!(
            event,
            AgentEvent::ToolResult { success: true, .. }
        )));
    }
}
