use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(test)]
use std::sync::{Mutex, OnceLock};

use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration, Instant};

use super::protocol::SidecarEvent;
use super::{PI_TURN_TIMEOUT, SIDECAR_HEARTBEAT_STALL_TIMEOUT};

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
        Ok(Some(SidecarReadMessage::Eof)) => {
            Err("pi sidecar stdout closed before turn completion".to_string())
        }
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

pub(super) fn redact_line(line: &str) -> String {
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
