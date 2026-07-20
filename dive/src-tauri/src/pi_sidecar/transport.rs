use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(test)]
use std::sync::{Mutex, OnceLock};

use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration, Instant};

use super::command::SidecarCommand;
use super::protocol::SidecarEvent;
use super::{PI_TURN_TIMEOUT, SIDECAR_HEARTBEAT_STALL_TIMEOUT};

/// Error text emitted when the sidecar closes stdout before the turn completes.
/// This string is protocol between `next_sidecar_event*` (producer) and
/// `run_supervised_turn_inner` (which branches on it to distinguish a clean EOF
/// from a crash); keep it a shared symbol so the branch cannot silently break if
/// the wording changes. The text itself is surfaced as a runtime error and stays
/// unchanged.
pub(super) const SIDECAR_STDOUT_CLOSED: &str = "pi sidecar stdout closed before turn completion";

#[derive(Debug, Clone, Copy)]
pub(super) struct SidecarTiming {
    pub(super) turn_timeout: Duration,
    pub(super) heartbeat_stall_timeout: Duration,
}

pub(super) fn sidecar_timing() -> SidecarTiming {
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

pub(super) enum SidecarReadMessage {
    Event(SidecarEvent),
    Eof,
    Error(String),
}

pub(super) fn spawn_sidecar_stdout_reader(
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

pub(super) struct SpawnedSidecar {
    pub(super) child: tokio::process::Child,
    pub(super) stdin: tokio::process::ChildStdin,
    pub(super) stdout: tokio::process::ChildStdout,
    pub(super) stderr_task: tokio::task::JoinHandle<Vec<String>>,
}

/// Spawn the Node sidecar with piped stdio, take the three pipes, and start the
/// stderr redaction collector. Every caller (`run_codex_smoke`,
/// `run_supervisor_turn`, `run_supervised_turn_inner`, `query_model_registry`)
/// repeated this block verbatim except for the spawn-failure prefix, which
/// varies per path — so `spawn_error_label` keeps each site's existing error
/// text while the pipe-take and stderr messages stay shared. Callers that need a
/// typed error (`PiSidecarSupervisorError`) map the returned `String` at the
/// call site, preserving the original variant.
pub(super) fn spawn_sidecar(
    sidecar_cmd: &SidecarCommand,
    spawn_error_label: &str,
) -> Result<SpawnedSidecar, String> {
    let mut child = super::new_sidecar_process(sidecar_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("{spawn_error_label}: {e}"))?;

    let stdin = child
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

    Ok(SpawnedSidecar {
        child,
        stdin,
        stdout,
        stderr_task,
    })
}

pub(super) fn remaining_turn_budget(
    started: Instant,
    timeout: Duration,
) -> Result<Duration, String> {
    timeout
        .checked_sub(started.elapsed())
        .ok_or_else(|| "pi sidecar turn timed out".to_string())
}

pub(super) async fn next_sidecar_event(
    rx: &mut mpsc::Receiver<SidecarReadMessage>,
    started: Instant,
    timing: SidecarTiming,
) -> Result<SidecarEvent, String> {
    let remaining = remaining_turn_budget(started, timing.turn_timeout)?;
    let wait_for = remaining.min(timing.heartbeat_stall_timeout);
    match timeout(wait_for, rx.recv()).await {
        Ok(Some(SidecarReadMessage::Event(event))) => Ok(event),
        Ok(Some(SidecarReadMessage::Eof)) => Err(SIDECAR_STDOUT_CLOSED.to_string()),
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

/// Wait for the next sidecar event while a DIVE tool (which may block on a human
/// approval card) is executing. The 120s turn budget is intentionally NOT
/// enforced here: a student deliberating on an approval is the supervision the
/// product is teaching, so their thinking time must not kill the turn. Sidecar
/// liveness is still guarded by the heartbeat-stall timeout (the sidecar
/// heartbeats every 5s while awaiting the tool result), so a dead sidecar is
/// caught even while we wait on the human.
pub(super) async fn next_sidecar_event_during_tool(
    rx: &mut mpsc::Receiver<SidecarReadMessage>,
    timing: SidecarTiming,
) -> Result<SidecarEvent, String> {
    match timeout(timing.heartbeat_stall_timeout, rx.recv()).await {
        Ok(Some(SidecarReadMessage::Event(event))) => Ok(event),
        Ok(Some(SidecarReadMessage::Eof)) => Err(SIDECAR_STDOUT_CLOSED.to_string()),
        Ok(Some(SidecarReadMessage::Error(err))) => Err(err),
        Ok(None) => Err("pi sidecar event reader stopped before turn completion".to_string()),
        Err(_) => Err(format!(
            "pi sidecar heartbeat stalled for {}ms",
            timing.heartbeat_stall_timeout.as_millis()
        )),
    }
}

pub(super) async fn wait_for_cancel(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

pub(super) async fn send_sidecar_cancel(
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

#[cfg(test)]
static TEST_SIDECAR_TIMING: OnceLock<Mutex<Option<SidecarTiming>>> = OnceLock::new();

#[cfg(test)]
pub(super) struct TestSidecarTimingGuard;

#[cfg(test)]
pub(super) fn set_test_sidecar_timing(
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
impl Drop for TestSidecarTimingGuard {
    fn drop(&mut self) {
        if let Some(lock) = TEST_SIDECAR_TIMING.get() {
            *lock.lock().unwrap() = None;
        }
    }
}

/// Redact long secret-shaped tokens from an error/log line before it is
/// surfaced. The old whitespace-split version matched only when an *entire*
/// space-delimited token was token-shaped, so a secret embedded in compact JSON
/// (`{"access":"eyJhbGciOi…"}`) slipped through untouched. Scan the characters
/// instead and mask every maximal run of `[A-Za-z0-9_-]` of 32+ chars — the same
/// rule the Node sidecar's `redactError` applies (index.mjs).
pub(super) fn redact_line(line: &str) -> String {
    const MIN_TOKEN_LEN: usize = 32;
    let mut out = String::with_capacity(line.len());
    let mut run = String::new();
    for ch in line.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            run.push(ch);
        } else {
            flush_redacted_run(&mut run, &mut out, MIN_TOKEN_LEN);
            out.push(ch);
        }
    }
    flush_redacted_run(&mut run, &mut out, MIN_TOKEN_LEN);
    out
}

fn flush_redacted_run(run: &mut String, out: &mut String, min_len: usize) {
    if run.len() >= min_len {
        out.push_str("[REDACTED]");
    } else {
        out.push_str(run);
    }
    run.clear();
}

#[cfg(test)]
mod redact_line_tests {
    use super::redact_line;

    #[test]
    fn masks_long_token_inside_compact_json() {
        let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
        assert!(token.len() >= 32);
        let line = format!(r#"parse failed: {{"access":"{token}"}}"#);
        let redacted = redact_line(&line);
        assert!(!redacted.contains(token), "token leaked: {redacted}");
        assert!(redacted.contains("[REDACTED]"));
        // Surrounding JSON punctuation is preserved.
        assert!(redacted.contains(r#"{"access":"#));
    }

    #[test]
    fn masks_long_whitespace_delimited_token() {
        let token = "AKIAIOSFODNN7EXAMPLEabcdefghijklmnop";
        let redacted = redact_line(&format!("key = {token} trailing"));
        assert_eq!(redacted, "key = [REDACTED] trailing");
    }

    #[test]
    fn leaves_short_tokens_and_structure_untouched() {
        assert_eq!(redact_line("ok short-abc123 done"), "ok short-abc123 done");
        assert_eq!(redact_line("no secrets here"), "no secrets here");
    }
}
