use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::agent::AgentEvent;
use crate::db::now_ms;
use crate::dive::event_log as dive_event_log;
use crate::tools::runtime::{PreviewRequestKind, PreviewRequestSource};

use super::AppState;
use super::ChatEventEnvelope;

const INSTALL_TIMEOUT: Duration = Duration::from_secs(180);
const SERVER_READY_TIMEOUT: Duration = Duration::from_secs(75);
const HTTP_PROBE_TIMEOUT: Duration = Duration::from_millis(850);
const MAX_LOG_LINES: usize = 80;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReusedPreviewLogCode {
    RunningServerDetected,
    PreviouslyStartedReused,
}

impl ReusedPreviewLogCode {
    fn code(self) -> &'static str {
        match self {
            Self::RunningServerDetected => "running_server_detected",
            Self::PreviouslyStartedReused => "previously_started_reused",
        }
    }
}

#[derive(Debug)]
pub(crate) struct PreviewProcess {
    pub root: PathBuf,
    pub url: String,
    pub child: Child,
}

#[derive(Debug)]
pub(crate) struct StaticPreviewServer {
    pub root: PathBuf,
    pub base_url: String,
    pub handle: JoinHandle<()>,
}

impl StaticPreviewServer {
    pub(crate) fn abort(self) {
        self.handle.abort();
    }
}

#[derive(Debug, Serialize)]
pub struct PreviewStartResult {
    pub url: String,
    pub package_manager: String,
    pub install_ran: bool,
    pub reused: bool,
    pub command: Vec<String>,
    pub logs: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PreviewStartOptions {
    #[serde(default)]
    pub force_install: bool,
}

#[derive(Debug, Clone)]
struct PreviewStartError {
    reason_code: &'static str,
    message: String,
}

impl PreviewStartError {
    fn new(reason_code: &'static str, message: impl Into<String>) -> Self {
        Self {
            reason_code,
            message: message.into(),
        }
    }

    fn dev_server_unavailable(message: impl Into<String>) -> Self {
        Self::new("dev_server_unavailable", message)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewOpenRequest {
    #[serde(default)]
    pub session_id: Option<i64>,
    #[serde(default)]
    pub card_id: Option<i64>,
    pub kind: PreviewRequestKind,
    #[serde(default)]
    pub target: String,
    #[serde(default = "default_preview_source")]
    pub source: PreviewRequestSource,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PreviewOpenStatus {
    Ready,
    Unavailable,
    Failed,
}

impl PreviewOpenStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Unavailable => "unavailable",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewOpenResponse {
    pub request_id: String,
    pub status: PreviewOpenStatus,
    pub kind: PreviewRequestKind,
    pub preview_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_file_path: Option<String>,
    pub target_label: String,
    pub reason_code: Option<String>,
    pub message: String,
    pub logs: Vec<String>,
    pub command_summary: Option<String>,
    pub resolved_at: i64,
}

#[derive(Debug, Clone)]
pub struct StaticPreviewTarget {
    pub target_label: String,
    pub asset_file_path: PathBuf,
}

fn default_preview_source() -> PreviewRequestSource {
    PreviewRequestSource::StudentAction
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PackageManager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
}

impl PackageManager {
    fn executable(self) -> &'static str {
        match self {
            Self::Npm => "npm",
            Self::Pnpm => "pnpm",
            Self::Yarn => "yarn",
            Self::Bun => "bun",
        }
    }

    fn install_args(self) -> &'static [&'static str] {
        match self {
            Self::Npm => &["install"],
            Self::Pnpm => &["install"],
            Self::Yarn => &["install"],
            Self::Bun => &["install"],
        }
    }

    fn run_args(self, script: &str) -> Vec<String> {
        match self {
            Self::Npm => vec!["run".into(), script.into()],
            Self::Pnpm => vec![script.into()],
            Self::Yarn => vec![script.into()],
            Self::Bun => vec!["run".into(), script.into()],
        }
    }
}

impl std::fmt::Display for PackageManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.executable())
    }
}

#[derive(Debug)]
struct PackageInfo {
    manager: PackageManager,
    script: String,
    likely_ports: Vec<u16>,
}

#[tauri::command]
pub async fn preview_start(
    state: State<'_, AppState>,
    options: Option<PreviewStartOptions>,
) -> Result<PreviewStartResult, String> {
    preview_start_impl(
        &state,
        options.unwrap_or(PreviewStartOptions {
            force_install: false,
        }),
    )
    .await
    .map_err(|err| err.message)
}

#[tauri::command]
pub async fn preview_open(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PreviewOpenRequest,
) -> Result<PreviewOpenResponse, String> {
    let response = preview_open_impl(&state, request.clone()).await?;
    record_preview_events(&state, request.session_id, &request, &response);
    if let Some(session_id) = request.session_id {
        emit_preview_events(&app, session_id, &request, &response);
    }
    Ok(response)
}

pub async fn preview_open_impl(
    state: &AppState,
    request: PreviewOpenRequest,
) -> Result<PreviewOpenResponse, String> {
    let request_id = Uuid::new_v4().to_string();
    let requested_at = now_ms();
    let root = match state.project_root_required() {
        Ok(root) => root,
        Err(message) => {
            return Ok(unavailable_preview_response(
                request_id,
                request.kind,
                target_label_for_request(&request),
                "missing_project",
                message,
            ));
        }
    };

    let target_label = target_label_for_request(&request);
    let _requested_at = requested_at;

    match request.kind {
        PreviewRequestKind::StaticFile => {
            match validate_static_preview_target(&root, &request.target) {
                Ok(target) => {
                    let base_url = static_preview_base_url(state, &root).await?;
                    Ok(PreviewOpenResponse {
                        request_id,
                        status: PreviewOpenStatus::Ready,
                        kind: request.kind,
                        preview_url: Some(format!(
                            "{}/{}",
                            base_url.trim_end_matches('/'),
                            url_path_for_target(&target.target_label)
                        )),
                        asset_file_path: Some(target.asset_file_path.display().to_string()),
                        target_label: target.target_label,
                        reason_code: None,
                        message: "Preview opened.".into(),
                        logs: Vec::new(),
                        command_summary: Some("Static project preview server".into()),
                        resolved_at: now_ms(),
                    })
                }
                Err(reason) => Ok(unavailable_preview_response(
                    request_id,
                    request.kind,
                    target_label,
                    reason.code,
                    reason.message,
                )),
            }
        }
        PreviewRequestKind::LocalUrl => match validate_local_preview_url(&request.target) {
            Ok(url) => {
                if probe_url(&url).await {
                    Ok(PreviewOpenResponse {
                        request_id,
                        status: PreviewOpenStatus::Ready,
                        kind: request.kind,
                        preview_url: Some(url.clone()),
                        asset_file_path: None,
                        target_label: url,
                        reason_code: None,
                        message: "Preview opened.".into(),
                        logs: Vec::new(),
                        command_summary: None,
                        resolved_at: now_ms(),
                    })
                } else {
                    Ok(failed_preview_response(
                        request_id,
                        request.kind,
                        url,
                        "local_url_unreachable",
                        "The local preview URL did not respond.",
                        Vec::new(),
                        None,
                    ))
                }
            }
            Err(reason) => Ok(unavailable_preview_response(
                request_id,
                request.kind,
                target_label,
                reason.code,
                reason.message,
            )),
        },
        PreviewRequestKind::DevServer => match preview_start_impl(
            state,
            PreviewStartOptions {
                force_install: false,
            },
        )
        .await
        {
            Ok(start) => Ok(PreviewOpenResponse {
                request_id,
                status: PreviewOpenStatus::Ready,
                kind: request.kind,
                preview_url: Some(start.url.clone()),
                asset_file_path: None,
                target_label: start.url.clone(),
                reason_code: None,
                message: if start.reused {
                    "Connected to the running preview.".into()
                } else {
                    "Preview opened.".into()
                },
                logs: start.logs,
                command_summary: Some(start.command.join(" ")),
                resolved_at: now_ms(),
            }),
            Err(error) => Ok(failed_preview_response(
                request_id,
                request.kind,
                target_label,
                error.reason_code,
                error.message,
                Vec::new(),
                None,
            )),
        },
        PreviewRequestKind::Auto => {
            if root.join("index.html").is_file() {
                match validate_static_preview_target(&root, "index.html") {
                    Ok(target) => {
                        let base_url = static_preview_base_url(state, &root).await?;
                        Ok(PreviewOpenResponse {
                            request_id,
                            status: PreviewOpenStatus::Ready,
                            kind: PreviewRequestKind::StaticFile,
                            preview_url: Some(format!(
                                "{}/{}",
                                base_url.trim_end_matches('/'),
                                url_path_for_target(&target.target_label)
                            )),
                            asset_file_path: Some(target.asset_file_path.display().to_string()),
                            target_label: target.target_label,
                            reason_code: None,
                            message: "Preview opened.".into(),
                            logs: Vec::new(),
                            command_summary: Some("Static project preview server".into()),
                            resolved_at: now_ms(),
                        })
                    }
                    Err(reason) => Ok(unavailable_preview_response(
                        request_id,
                        PreviewRequestKind::StaticFile,
                        "index.html".into(),
                        reason.code,
                        reason.message,
                    )),
                }
            } else {
                match preview_start_impl(
                    state,
                    PreviewStartOptions {
                        force_install: false,
                    },
                )
                .await
                {
                    Ok(start) => Ok(PreviewOpenResponse {
                        request_id,
                        status: PreviewOpenStatus::Ready,
                        kind: PreviewRequestKind::DevServer,
                        preview_url: Some(start.url.clone()),
                        asset_file_path: None,
                        target_label: start.url.clone(),
                        reason_code: None,
                        message: if start.reused {
                            "Connected to the running preview.".into()
                        } else {
                            "Preview opened.".into()
                        },
                        logs: start.logs,
                        command_summary: Some(start.command.join(" ")),
                        resolved_at: now_ms(),
                    }),
                    Err(error) => Ok(failed_preview_response(
                        request_id,
                        PreviewRequestKind::DevServer,
                        target_label,
                        error.reason_code,
                        error.message,
                        Vec::new(),
                        None,
                    )),
                }
            }
        }
    }
}

async fn static_preview_base_url(state: &AppState, root: &Path) -> Result<String, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("resolve preview root: {e}"))?;
    if let Some(url) = {
        let guard = state
            .static_preview_server
            .lock()
            .map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .filter(|server| server.root == canonical_root && !server.handle.is_finished())
            .map(|server| server.base_url.clone())
    } {
        return Ok(url);
    }

    if let Some(server) = state
        .static_preview_server
        .lock()
        .map_err(|e| e.to_string())?
        .take()
    {
        server.abort();
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("start static preview server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("read static preview address: {e}"))?
        .port();
    let base_url = format!("http://127.0.0.1:{port}");
    let server_root = canonical_root.clone();
    let handle = tokio::spawn(async move {
        run_static_preview_server(listener, server_root).await;
    });
    let mut guard = state
        .static_preview_server
        .lock()
        .map_err(|e| e.to_string())?;
    *guard = Some(StaticPreviewServer {
        root: canonical_root,
        base_url: base_url.clone(),
        handle,
    });
    Ok(base_url)
}

async fn run_static_preview_server(listener: TcpListener, root: PathBuf) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            break;
        };
        let root = root.clone();
        tokio::spawn(async move {
            let _ = serve_static_preview_request(stream, root).await;
        });
    }
}

async fn serve_static_preview_request(mut stream: TcpStream, root: PathBuf) -> std::io::Result<()> {
    let mut buffer = vec![0_u8; 8192];
    let read = stream.read(&mut buffer).await?;
    if read == 0 {
        return Ok(());
    }
    let request = String::from_utf8_lossy(&buffer[..read]);
    let mut parts = request
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = parts.next().unwrap_or_default();
    let raw_path = parts.next().unwrap_or("/");
    if method != "GET" && method != "HEAD" {
        return write_static_response(
            &mut stream,
            405,
            "text/plain; charset=utf-8",
            b"method not allowed",
            method == "HEAD",
        )
        .await;
    }
    let Some(path) = resolve_static_request_path(&root, raw_path) else {
        return write_static_response(
            &mut stream,
            404,
            "text/plain; charset=utf-8",
            b"not found",
            method == "HEAD",
        )
        .await;
    };
    match tokio::fs::read(&path).await {
        Ok(body) => {
            let content_type = content_type_for_path(&path);
            write_static_response(&mut stream, 200, content_type, &body, method == "HEAD").await
        }
        Err(_) => {
            write_static_response(
                &mut stream,
                404,
                "text/plain; charset=utf-8",
                b"not found",
                method == "HEAD",
            )
            .await
        }
    }
}

async fn write_static_response(
    stream: &mut TcpStream,
    status: u16,
    content_type: &str,
    body: &[u8],
    head_only: bool,
) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\ncache-control: no-store\r\nx-content-type-options: nosniff\r\nconnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).await?;
    if !head_only {
        stream.write_all(body).await?;
    }
    Ok(())
}

fn resolve_static_request_path(root: &Path, raw_path: &str) -> Option<PathBuf> {
    let path = raw_path.split(['?', '#']).next().unwrap_or("/");
    let decoded = percent_decode_path(path)?;
    let trimmed = decoded.trim_start_matches('/');
    let relative = if trimmed.is_empty() {
        PathBuf::from("index.html")
    } else {
        PathBuf::from(trimmed)
    };
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return None;
    }
    let candidate = root.join(relative);
    let canonical = candidate.canonicalize().ok()?;
    if canonical.is_file() && canonical.starts_with(root) {
        Some(canonical)
    } else {
        None
    }
}

fn percent_decode_path(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hi = bytes.get(index + 1).copied().and_then(hex_value)?;
            let lo = bytes.get(index + 2).copied().and_then(hex_value)?;
            out.push((hi << 4) | lo);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn url_path_for_target(target: &str) -> String {
    target
        .replace('\\', "/")
        .split('/')
        .map(percent_encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn percent_encode_segment(segment: &str) -> String {
    let mut out = String::new();
    for byte in segment.bytes() {
        let allowed = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~');
        if allowed {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn content_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

async fn preview_start_impl(
    state: &AppState,
    options: PreviewStartOptions,
) -> Result<PreviewStartResult, PreviewStartError> {
    let root = state
        .project_root_required()
        .map_err(|message| PreviewStartError::new("missing_project", message))?;
    let info = detect_package_info(&root)?;

    if let Some(result) = try_reuse_preview(state, &root, &info)
        .await
        .map_err(PreviewStartError::dev_server_unavailable)?
    {
        return Ok(result);
    }

    if let Some(url) = detect_running_preview(&info.likely_ports).await {
        return Ok(PreviewStartResult {
            url,
            package_manager: info.manager.to_string(),
            install_ran: false,
            reused: true,
            command: info.dev_command(),
            logs: vec![ReusedPreviewLogCode::RunningServerDetected
                .code()
                .to_string()],
        });
    }

    stop_preview_process(state).map_err(PreviewStartError::dev_server_unavailable)?;

    let mut logs = Vec::new();
    let install_ran = options.force_install || !root.join("node_modules").is_dir();
    if install_ran {
        logs.push(format!(
            "$ {} {}",
            info.manager.executable(),
            info.manager.install_args().join(" ")
        ));
        let install_output = run_install(&root, info.manager)
            .await
            .map_err(PreviewStartError::dev_server_unavailable)?;
        push_truncated_lines(&mut logs, &install_output);
    }

    let (mut child, mut rx) = spawn_dev_server(&root, &info)
        .await
        .map_err(PreviewStartError::dev_server_unavailable)?;
    logs.push(format!("$ {}", info.dev_command().join(" ")));

    let mut found_url = None;
    let started = tokio::time::Instant::now();
    while started.elapsed() < SERVER_READY_TIMEOUT {
        tokio::select! {
            line = rx.recv() => {
                if let Some(line) = line {
                    push_log_line(&mut logs, line.clone());
                    if let Some(url) = extract_local_url(&line) {
                        found_url = Some(url);
                        break;
                    }
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(350)) => {
                if let Some(url) = detect_running_preview(&info.likely_ports).await {
                    found_url = Some(url);
                    break;
                }
                if let Some(status) = child
                    .try_wait()
                    .map_err(|e| PreviewStartError::dev_server_unavailable(format!("dev server status: {e}")))? {
                    return Err(PreviewStartError::dev_server_unavailable(format!(
                        "dev server exited before preview URL was ready: {status}"
                    )));
                }
            }
        }
    }

    let Some(url) = found_url else {
        let _ = child.start_kill();
        return Err(PreviewStartError::dev_server_unavailable(
            "dev server started, but no localhost preview URL was detected.",
        ));
    };

    {
        let mut guard = state
            .preview_process
            .lock()
            .map_err(|e| PreviewStartError::dev_server_unavailable(e.to_string()))?;
        *guard = Some(PreviewProcess {
            root: root.clone(),
            url: url.clone(),
            child,
        });
    }

    Ok(PreviewStartResult {
        url,
        package_manager: info.manager.to_string(),
        install_ran,
        reused: false,
        command: info.dev_command(),
        logs,
    })
}

#[derive(Debug, Clone)]
pub struct PreviewValidationError {
    pub code: &'static str,
    pub message: String,
}

impl PreviewValidationError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub fn validate_static_preview_target(
    root: &Path,
    target: &str,
) -> Result<StaticPreviewTarget, PreviewValidationError> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err(PreviewValidationError::new(
            "missing_target",
            "Choose a project HTML file to preview.",
        ));
    }
    let relative = Path::new(trimmed);
    if relative.is_absolute() {
        return Err(PreviewValidationError::new(
            "project_escape",
            "DIVE can preview only files inside the selected project.",
        ));
    }
    let ext = relative
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ext != "html" && ext != "htm" {
        return Err(PreviewValidationError::new(
            "unsupported_extension",
            "Preview supports local .html and .htm files.",
        ));
    }

    let canonical_root = root.canonicalize().map_err(|_| {
        PreviewValidationError::new(
            "missing_project",
            "Select an existing project before opening Preview.",
        )
    })?;
    let candidate = canonical_root.join(relative);
    let canonical_candidate = candidate.canonicalize().map_err(|_| {
        PreviewValidationError::new(
            "missing_static_file",
            "The requested HTML file does not exist.",
        )
    })?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(PreviewValidationError::new(
            "project_escape",
            "DIVE can preview only files inside the selected project.",
        ));
    }

    Ok(StaticPreviewTarget {
        target_label: trimmed.replace('\\', "/"),
        asset_file_path: canonical_candidate,
    })
}

pub fn validate_local_preview_url(target: &str) -> Result<String, PreviewValidationError> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err(PreviewValidationError::new(
            "missing_target",
            "Enter a local preview URL.",
        ));
    }
    let url = reqwest::Url::parse(trimmed).map_err(|_| {
        PreviewValidationError::new("unsupported_url", "Enter a valid local preview URL.")
    })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(PreviewValidationError::new(
            "unsupported_url",
            "Preview supports http and https local URLs.",
        ));
    }
    let Some(host) = url.host_str() else {
        return Err(PreviewValidationError::new(
            "unsupported_url",
            "Enter a valid local preview URL.",
        ));
    };
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "::1"
        || host == "[::1]";
    if !is_loopback {
        return Err(PreviewValidationError::new(
            "external_url",
            "Preview is limited to local project URLs.",
        ));
    }
    let mut normalized = url;
    if normalized.host_str() == Some("localhost") {
        normalized.set_host(Some("127.0.0.1")).map_err(|_| {
            PreviewValidationError::new("unsupported_url", "Enter a valid local preview URL.")
        })?;
    }
    Ok(normalized.to_string())
}

fn target_label_for_request(request: &PreviewOpenRequest) -> String {
    let trimmed = request.target.trim();
    if trimmed.is_empty() {
        "project preview".into()
    } else {
        trimmed.into()
    }
}

fn unavailable_preview_response(
    request_id: String,
    kind: PreviewRequestKind,
    target_label: String,
    reason_code: impl Into<String>,
    message: impl Into<String>,
) -> PreviewOpenResponse {
    PreviewOpenResponse {
        request_id,
        status: PreviewOpenStatus::Unavailable,
        kind,
        preview_url: None,
        asset_file_path: None,
        target_label,
        reason_code: Some(reason_code.into()),
        message: message.into(),
        logs: Vec::new(),
        command_summary: None,
        resolved_at: now_ms(),
    }
}

fn failed_preview_response(
    request_id: String,
    kind: PreviewRequestKind,
    target_label: String,
    reason_code: impl Into<String>,
    message: impl Into<String>,
    logs: Vec<String>,
    command_summary: Option<String>,
) -> PreviewOpenResponse {
    PreviewOpenResponse {
        request_id,
        status: PreviewOpenStatus::Failed,
        kind,
        preview_url: None,
        asset_file_path: None,
        target_label,
        reason_code: Some(reason_code.into()),
        message: message.into(),
        logs,
        command_summary,
        resolved_at: now_ms(),
    }
}

fn record_preview_events(
    state: &AppState,
    session_id: Option<i64>,
    request: &PreviewOpenRequest,
    response: &PreviewOpenResponse,
) {
    let Ok(db) = state.db.lock() else {
        return;
    };
    let requested_at = now_ms();
    let _ = dive_event_log::append_to_conn(
        db.conn(),
        session_id,
        dive_event_log::PREVIEW_OPEN_REQUESTED_EVENT,
        json!({
            "requestId": response.request_id,
            "sessionId": session_id,
            "cardId": request.card_id,
            "kind": request.kind,
            "targetLabel": target_label_for_request(request),
            "source": source_as_str(request.source),
            "requestedAt": requested_at,
        }),
    );
    let _ = dive_event_log::append_to_conn(
        db.conn(),
        session_id,
        dive_event_log::PREVIEW_OPEN_RESULT_EVENT,
        json!({
            "requestId": response.request_id,
            "status": response.status,
            "kind": response.kind,
            "targetLabel": response.target_label,
            "reasonCode": response.reason_code,
            "message": response.message,
            "resolvedAt": response.resolved_at,
            "logs": response.logs,
            "commandSummary": response.command_summary,
        }),
    );
}

fn emit_preview_events(
    app: &AppHandle,
    session_id: i64,
    request: &PreviewOpenRequest,
    response: &PreviewOpenResponse,
) {
    let requested = ChatEventEnvelope {
        session_id,
        event: AgentEvent::PreviewOpenRequested {
            request_id: response.request_id.clone(),
            kind: request.kind,
            target_label: target_label_for_request(request),
            source: source_as_str(request.source).to_string(),
            requested_at: now_ms(),
        },
    };
    let _ = app.emit(&format!("chat://event/{session_id}"), &requested);
    let result = ChatEventEnvelope {
        session_id,
        event: preview_open_result_event(response),
    };
    let _ = app.emit(&format!("chat://event/{session_id}"), &result);
}

fn preview_open_result_event(response: &PreviewOpenResponse) -> AgentEvent {
    AgentEvent::PreviewOpenResult {
        request_id: response.request_id.clone(),
        kind: response.kind,
        status: response.status.as_str().to_string(),
        preview_url: response.preview_url.clone(),
        asset_file_path: response.asset_file_path.clone(),
        target_label: response.target_label.clone(),
        reason_code: response.reason_code.clone(),
        message: response.message.clone(),
        resolved_at: response.resolved_at,
    }
}

fn source_as_str(source: PreviewRequestSource) -> &'static str {
    match source {
        PreviewRequestSource::StudentAction => "student_action",
        PreviewRequestSource::AiTool => "ai_tool",
        PreviewRequestSource::ReviewAction => "review_action",
        PreviewRequestSource::Reroute => "reroute",
    }
}

async fn try_reuse_preview(
    state: &AppState,
    root: &Path,
    info: &PackageInfo,
) -> Result<Option<PreviewStartResult>, String> {
    let existing = {
        let guard = state.preview_process.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .filter(|process| process.root == root)
            .map(|process| process.url.clone())
    };
    let Some(url) = existing else {
        return Ok(None);
    };
    if probe_url(&url).await {
        return Ok(Some(PreviewStartResult {
            url,
            package_manager: info.manager.to_string(),
            install_ran: false,
            reused: true,
            command: info.dev_command(),
            logs: vec![ReusedPreviewLogCode::PreviouslyStartedReused
                .code()
                .to_string()],
        }));
    }
    stop_preview_process(state)?;
    Ok(None)
}

fn stop_preview_process(state: &AppState) -> Result<(), String> {
    let mut existing = {
        let mut guard = state.preview_process.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(process) = existing.as_mut() {
        let _ = process.child.start_kill();
    }
    Ok(())
}

fn detect_package_info(root: &Path) -> Result<PackageInfo, PreviewStartError> {
    let package_json = root.join("package.json");
    if !package_json.is_file() {
        return Err(PreviewStartError::new(
            "missing_package_json",
            "The selected project does not include a package.json.",
        ));
    }
    let raw = std::fs::read_to_string(&package_json).map_err(|e| {
        PreviewStartError::dev_server_unavailable(format!("read package.json: {e}"))
    })?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| {
        PreviewStartError::dev_server_unavailable(format!("parse package.json: {e}"))
    })?;
    let scripts = value
        .get("scripts")
        .and_then(|v| v.as_object())
        .ok_or_else(|| {
            PreviewStartError::new(
                "missing_dev_or_start_script",
                "package.json does not define scripts.dev or scripts.start.",
            )
        })?;
    let script = if scripts.contains_key("dev") {
        "dev"
    } else if scripts.contains_key("start") {
        "start"
    } else {
        return Err(PreviewStartError::new(
            "missing_dev_or_start_script",
            "package.json does not define scripts.dev or scripts.start.",
        ));
    };
    let script_text = scripts
        .get(script)
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    Ok(PackageInfo {
        manager: detect_package_manager(root),
        script: script.into(),
        likely_ports: likely_ports(script_text),
    })
}

fn detect_package_manager(root: &Path) -> PackageManager {
    if root.join("pnpm-lock.yaml").is_file() {
        PackageManager::Pnpm
    } else if root.join("yarn.lock").is_file() {
        PackageManager::Yarn
    } else if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() {
        PackageManager::Bun
    } else {
        PackageManager::Npm
    }
}

impl PackageInfo {
    fn dev_command(&self) -> Vec<String> {
        let mut command = vec![self.manager.executable().into()];
        command.extend(self.manager.run_args(&self.script));
        command
    }
}

async fn run_install(root: &Path, manager: PackageManager) -> Result<String, String> {
    let mut command = Command::new(manager.executable());
    command
        .args(manager.install_args())
        .current_dir(root)
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = tokio::time::timeout(INSTALL_TIMEOUT, command.output())
        .await
        .map_err(|_| "dependency install timed out.".to_owned())?
        .map_err(|e| format!("run dependency install: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}");
    if !output.status.success() {
        return Err(format!(
            "dependency install failed with {}.\n{}",
            output.status, combined
        ));
    }
    Ok(combined)
}

async fn spawn_dev_server(
    root: &Path,
    info: &PackageInfo,
) -> Result<(Child, mpsc::Receiver<String>), String> {
    let args = info.manager.run_args(&info.script);
    let mut command = Command::new(info.manager.executable());
    command
        .args(&args)
        .current_dir(root)
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("start dev server: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "capture dev server stdout".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "capture dev server stderr".to_owned())?;
    let (tx, rx) = mpsc::channel(64);
    spawn_line_reader(stdout, tx.clone());
    spawn_line_reader(stderr, tx);
    Ok((child, rx))
}

fn spawn_line_reader<R>(reader: R, tx: mpsc::Sender<String>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let _ = tx.send(line).await;
                }
                Ok(None) => break,
                Err(err) => {
                    let _ = tx.send(format!("read dev server output: {err}")).await;
                    break;
                }
            }
        }
    });
}

async fn detect_running_preview(ports: &[u16]) -> Option<String> {
    for port in ports {
        let url = format!("http://127.0.0.1:{port}");
        if probe_url(&url).await {
            return Some(url);
        }
    }
    None
}

async fn probe_url(url: &str) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(HTTP_PROBE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    client.get(url).send().await.is_ok()
}

fn extract_local_url(line: &str) -> Option<String> {
    let re = regex::Regex::new(r"https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:/[^\s]*)?")
        .ok()?;
    re.find(line).map(|m| {
        m.as_str()
            .trim_end_matches([')', ']', ',', '.'])
            .replace("localhost", "127.0.0.1")
    })
}

fn likely_ports(script_text: &str) -> Vec<u16> {
    let mut ports = Vec::new();
    let re = regex::Regex::new(r"(?:--port(?:=|\s+)|-p\s+)(\d{2,5})").expect("port regex");
    for capture in re.captures_iter(script_text) {
        if let Some(port) = capture.get(1).and_then(|m| m.as_str().parse::<u16>().ok()) {
            push_port(&mut ports, port);
        }
    }
    for port in [5173, 3000, 4173, 4321, 8080, 8000, 5000, 5174, 5175, 5176] {
        push_port(&mut ports, port);
    }
    ports
}

fn push_port(ports: &mut Vec<u16>, port: u16) {
    if !ports.contains(&port) {
        ports.push(port);
    }
}

fn push_truncated_lines(logs: &mut Vec<String>, output: &str) {
    for line in output.lines().take(MAX_LOG_LINES) {
        push_log_line(logs, line.to_owned());
    }
}

fn push_log_line(logs: &mut Vec<String>, line: String) {
    if logs.len() >= MAX_LOG_LINES {
        logs.remove(0);
    }
    logs.push(line);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn likely_ports_prefers_script_port_then_common_defaults() {
        let ports = likely_ports("vite --host 0.0.0.0 --port 4555");
        assert_eq!(ports[0], 4555);
        assert!(ports.contains(&5173));
        assert!(ports.contains(&3000));
    }

    #[test]
    fn reused_preview_log_codes_are_stable() {
        assert_eq!(
            ReusedPreviewLogCode::RunningServerDetected.code(),
            "running_server_detected"
        );
        assert_eq!(
            ReusedPreviewLogCode::PreviouslyStartedReused.code(),
            "previously_started_reused"
        );
    }

    #[test]
    fn extract_local_url_normalizes_localhost() {
        assert_eq!(
            extract_local_url("Local: http://localhost:5173/"),
            Some("http://127.0.0.1:5173/".into())
        );
    }

    #[test]
    fn package_manager_defaults_to_npm_without_lockfile() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(detect_package_manager(tmp.path()), PackageManager::Npm);
    }

    #[test]
    fn package_info_reports_missing_package_json_reason_code() {
        let tmp = tempfile::tempdir().unwrap();
        let err = detect_package_info(tmp.path()).unwrap_err();
        assert_eq!(err.reason_code, "missing_package_json");
    }

    #[test]
    fn package_info_reports_missing_dev_or_start_script_reason_code() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"test":"vitest"}}"#,
        )
        .unwrap();
        let err = detect_package_info(tmp.path()).unwrap_err();
        assert_eq!(err.reason_code, "missing_dev_or_start_script");
    }

    #[test]
    fn package_info_reports_missing_scripts_reason_code() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("package.json"), r#"{"name":"plain"}"#).unwrap();
        let err = detect_package_info(tmp.path()).unwrap_err();
        assert_eq!(err.reason_code, "missing_dev_or_start_script");
    }

    #[test]
    fn preview_open_result_event_carries_asset_file_path_from_response() {
        let response = PreviewOpenResponse {
            request_id: "preview-1".into(),
            status: PreviewOpenStatus::Ready,
            kind: PreviewRequestKind::StaticFile,
            preview_url: Some("asset://project/index.html".into()),
            asset_file_path: Some("/project/index.html".into()),
            target_label: "index.html".into(),
            reason_code: None,
            message: "Preview opened.".into(),
            logs: Vec::new(),
            command_summary: None,
            resolved_at: 123,
        };

        let value = serde_json::to_value(preview_open_result_event(&response)).unwrap();

        assert_eq!(value["type"], "preview_open_result");
        assert_eq!(value["previewUrl"], "asset://project/index.html");
        assert_eq!(value["assetFilePath"], "/project/index.html");
    }
}
