use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

use super::AppState;

const INSTALL_TIMEOUT: Duration = Duration::from_secs(180);
const SERVER_READY_TIMEOUT: Duration = Duration::from_secs(75);
const HTTP_PROBE_TIMEOUT: Duration = Duration::from_millis(850);
const MAX_LOG_LINES: usize = 80;

#[derive(Debug)]
pub(crate) struct PreviewProcess {
    pub root: PathBuf,
    pub url: String,
    pub child: Child,
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
}

async fn preview_start_impl(
    state: &AppState,
    options: PreviewStartOptions,
) -> Result<PreviewStartResult, String> {
    let root = state.project_root_required()?;
    let info = detect_package_info(&root)?;

    if let Some(result) = try_reuse_preview(state, &root, &info).await? {
        return Ok(result);
    }

    if let Some(url) = detect_running_preview(&info.likely_ports).await {
        return Ok(PreviewStartResult {
            url,
            package_manager: info.manager.to_string(),
            install_ran: false,
            reused: true,
            command: info.dev_command(),
            logs: vec!["이미 실행 중인 로컬 미리보기 서버에 연결했습니다.".into()],
        });
    }

    stop_preview_process(state)?;

    let mut logs = Vec::new();
    let install_ran = options.force_install || !root.join("node_modules").is_dir();
    if install_ran {
        logs.push(format!(
            "$ {} {}",
            info.manager.executable(),
            info.manager.install_args().join(" ")
        ));
        let install_output = run_install(&root, info.manager).await?;
        push_truncated_lines(&mut logs, &install_output);
    }

    let (mut child, mut rx) = spawn_dev_server(&root, &info).await?;
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
                if let Some(status) = child.try_wait().map_err(|e| format!("dev server status: {e}"))? {
                    return Err(format!("dev server exited before preview URL was ready: {status}"));
                }
            }
        }
    }

    let Some(url) = found_url else {
        let _ = child.start_kill();
        return Err("dev server started, but no localhost preview URL was detected.".into());
    };

    {
        let mut guard = state.preview_process.lock().map_err(|e| e.to_string())?;
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
            logs: vec!["이전에 시작한 미리보기 서버를 재사용했습니다.".into()],
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

fn detect_package_info(root: &Path) -> Result<PackageInfo, String> {
    let package_json = root.join("package.json");
    if !package_json.is_file() {
        return Err("package.json이 있는 웹 프로젝트를 선택하세요.".into());
    }
    let raw =
        std::fs::read_to_string(&package_json).map_err(|e| format!("read package.json: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("parse package.json: {e}"))?;
    let scripts = value
        .get("scripts")
        .and_then(|v| v.as_object())
        .ok_or_else(|| "package.json에 scripts 항목이 없습니다.".to_owned())?;
    let script = if scripts.contains_key("dev") {
        "dev"
    } else if scripts.contains_key("start") {
        "start"
    } else {
        return Err("package.json에 dev 또는 start script가 없습니다.".into());
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
            .trim_end_matches(|c: char| matches!(c, ')' | ']' | ',' | '.'))
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
    fn package_info_requires_dev_or_start_script() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("package.json"),
            r#"{"scripts":{"test":"vitest"}}"#,
        )
        .unwrap();
        let err = detect_package_info(tmp.path()).unwrap_err();
        assert!(err.contains("dev 또는 start"));
    }
}
