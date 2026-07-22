//! Shared child-process execution helpers for the process/terminal tools.
//!
//! Two safety concerns live here so `run_process` and `run_terminal_script`
//! apply them identically (S-063 F1/F3):
//!
//! 1. **Sensitive-environment scrubbing.** The agent's process tools run on the
//!    student's machine and their stdout/stderr is surfaced back to the LLM. A
//!    child must therefore not inherit provider/cloud credentials the app was
//!    launched with, or a command that prints its environment would exfiltrate
//!    them to the model provider.
//! 2. **Bounded output capture.** stdout/stderr are read through per-stream
//!    caps so a runaway writer (`yes`, `cat /dev/urandom`) can neither exhaust
//!    memory nor hang the turn: memory is bounded to the display cap, and a
//!    writer that keeps going past a much larger read ceiling is killed early
//!    instead of read to completion.

use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

/// Read ceiling (per stream) before a still-producing child is killed. Well
/// above any display cap so an ordinary verbose build/test run still finishes
/// with a correct exit code; only genuinely runaway output trips it. Memory
/// stays bounded to the (much smaller) display cap regardless — bytes past the
/// display cap are counted and discarded, not buffered.
pub const OUTPUT_READ_LIMIT: usize = 8 * 1024 * 1024;

/// Environment variable names whose values are secrets and must never reach a
/// child process the agent runs, because the child's output is shown to the LLM.
/// The denylist is aligned with `guard.rs`'s `SECRET_ASSIGNMENT_RE` key class
/// (api_key/token/secret/password/authorization/bearer/private_key/access_key/
/// database_url), plus cloud-credential and PAT conventions (I-3). Matching is
/// substring-based except the `_PAT` suffix, which is anchored so it cannot
/// misfire on `PATH`/`*_PATH`/`PATTERN`.
pub fn is_sensitive_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    upper.contains("API_KEY")
        || upper.contains("APIKEY")
        || upper.contains("TOKEN")
        || upper.contains("SECRET")
        || upper.contains("PASSWORD")
        || upper.contains("PASSWD")
        || upper.contains("PRIVATE_KEY")
        || upper.contains("PRIVATEKEY")
        || upper.contains("ACCESS_KEY")
        || upper.contains("ACCESSKEY")
        || upper.contains("DATABASE_URL")
        || upper.contains("AUTHORIZATION")
        || upper.contains("CREDENTIAL")
        || upper.contains("BEARER")
        || upper.starts_with("AWS_")
        || upper.ends_with("_PAT")
}

/// Remove sensitive variables from the child's inherited environment. We remove
/// by pattern rather than `env_clear()` on purpose: a full clear would also
/// strip PATH / HOME / language settings that ordinary build and test commands
/// need, whereas pattern removal keeps the child runnable while denying it the
/// student's credentials.
pub fn scrub_sensitive_env(cmd: &mut Command) {
    for (key, _value) in std::env::vars_os() {
        if key.to_str().map(is_sensitive_env_key).unwrap_or(false) {
            cmd.env_remove(&key);
        }
    }
}

/// Captured child output, each stream bounded to the display cap.
#[derive(Debug)]
pub struct CappedOutput {
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    /// The child produced more than the display cap on this stream (output is
    /// truncated for display).
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub status: ExitStatus,
}

#[derive(Debug)]
pub enum CappedRunError {
    Timeout,
    Spawn(std::io::Error),
    Io(std::io::Error),
}

#[derive(Default)]
struct StreamCapture {
    /// Bytes kept for display, never longer than `keep_cap`.
    buf: Vec<u8>,
    /// Total bytes read from the stream, including discarded ones.
    total: usize,
    /// The child produced more than `keep_cap` bytes.
    truncated: bool,
    /// Total exceeded the read ceiling → the child should be killed.
    over_limit: bool,
    /// EOF or read-ceiling reached; stop selecting on this stream.
    done: bool,
}

impl StreamCapture {
    fn ingest(&mut self, chunk: &[u8], keep_cap: usize, read_limit: usize) {
        self.total = self.total.saturating_add(chunk.len());
        if self.buf.len() < keep_cap {
            let remaining = keep_cap - self.buf.len();
            let take = remaining.min(chunk.len());
            self.buf.extend_from_slice(&chunk[..take]);
        }
        if self.total > keep_cap {
            self.truncated = true;
        }
        if self.total > read_limit {
            self.over_limit = true;
            self.done = true;
        }
    }
}

/// Spawn `cmd`, capturing stdout/stderr with each stream's displayable bytes
/// bounded to `keep_cap`. Reading continues (discarding beyond `keep_cap`) up to
/// `OUTPUT_READ_LIMIT`; a child still producing past that ceiling is killed so a
/// runaway writer cannot hang the turn. Both the read loop AND the subsequent
/// child-exit wait are bounded by `timeout`: a child that closes its stdout/
/// stderr while still running delivers EOF to the read loop immediately, so the
/// wait for its actual exit is a separate bounded phase — otherwise it could
/// block unbounded (`kill_on_drop` cannot fire while the child is awaited).
pub async fn run_capped(
    mut cmd: Command,
    timeout: Duration,
    keep_cap: usize,
) -> Result<CappedOutput, CappedRunError> {
    let read_limit = OUTPUT_READ_LIMIT.max(keep_cap);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(CappedRunError::Spawn)?;
    let mut out = child.stdout.take().expect("stdout piped");
    let mut err = child.stderr.take().expect("stderr piped");

    let mut out_cap = StreamCapture::default();
    let mut err_cap = StreamCapture::default();
    let mut out_chunk = [0u8; 8192];
    let mut err_chunk = [0u8; 8192];

    let read_loop = async {
        while !(out_cap.done && err_cap.done) {
            tokio::select! {
                r = out.read(&mut out_chunk), if !out_cap.done => match r {
                    Ok(0) => out_cap.done = true,
                    Ok(n) => {
                        out_cap.ingest(&out_chunk[..n], keep_cap, read_limit);
                        if out_cap.over_limit {
                            let _ = child.start_kill();
                        }
                    }
                    Err(e) => return Err(e),
                },
                r = err.read(&mut err_chunk), if !err_cap.done => match r {
                    Ok(0) => err_cap.done = true,
                    Ok(n) => {
                        err_cap.ingest(&err_chunk[..n], keep_cap, read_limit);
                        if err_cap.over_limit {
                            let _ = child.start_kill();
                        }
                    }
                    Err(e) => return Err(e),
                },
            }
        }
        Ok(())
    };

    match tokio::time::timeout(timeout, read_loop).await {
        Ok(Ok(())) => {
            if out_cap.over_limit || err_cap.over_limit {
                let _ = child.start_kill();
            }
            // The read loop returning does not mean the child has exited: it
            // may have closed stdout/stderr (delivering EOF immediately) while
            // continuing to run. Bound this wait too, otherwise a child in
            // that state hangs the turn indefinitely even though the overall
            // `timeout` already elapsed for the read phase.
            let status = match tokio::time::timeout(timeout, child.wait()).await {
                Ok(result) => result.map_err(CappedRunError::Io)?,
                Err(_) => {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    return Err(CappedRunError::Timeout);
                }
            };
            Ok(CappedOutput {
                stdout: out_cap.buf,
                stderr: err_cap.buf,
                stdout_truncated: out_cap.truncated,
                stderr_truncated: err_cap.truncated,
                status,
            })
        }
        Ok(Err(e)) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(CappedRunError::Io(e))
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            Err(CappedRunError::Timeout)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_env_key_matches_credential_patterns() {
        for key in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GITHUB_TOKEN",
            "MY_TOKEN",
            "CLIENT_SECRET",
            "DB_PASSWORD",
            "AWS_ACCESS_KEY_ID",
            "AWS_SECRET_ACCESS_KEY",
            // I-3 additions, aligned with guard.rs SECRET_ASSIGNMENT_RE.
            "GITHUB_PRIVATE_KEY",
            "SERVICE_PRIVATEKEY",
            "GCP_ACCESS_KEY",
            "DATABASE_URL",
            "HTTP_AUTHORIZATION",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "MY_BEARER",
            "GH_PAT",
            "GITHUB_PAT",
        ] {
            assert!(is_sensitive_env_key(key), "should scrub {key}");
        }
        // Must NOT over-remove ordinary variables — especially the `_PAT` suffix
        // vs `PATH`/`*_PATH`/`PATTERN`, and prose-y names.
        for key in [
            "PATH",
            "MY_PATH",
            "TEMPLATE_PATH",
            "PATTERN",
            "PATCH_LEVEL",
            "COMPATIBILITY",
            "LANG",
            "NODE_ENV",
            "CI",
            "TERM",
            "HOME",
            "EDITOR",
        ] {
            assert!(!is_sensitive_env_key(key), "should keep {key}");
        }
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_capped_keeps_small_output_and_exit_status() {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("printf hello; printf oops >&2");
        let out = run_capped(cmd, Duration::from_secs(5), 16 * 1024)
            .await
            .expect("run");
        assert_eq!(out.stdout, b"hello");
        assert_eq!(out.stderr, b"oops");
        assert!(!out.stdout_truncated);
        assert!(out.status.success());
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_capped_bounds_memory_but_lets_finite_verbose_command_succeed() {
        // Produces more than the display cap but well under the read ceiling:
        // memory is bounded to the cap, yet the command still exits 0.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("head -c 40000 /dev/zero | tr '\\0' 'a'");
        let cap = 4096;
        let out = run_capped(cmd, Duration::from_secs(10), cap)
            .await
            .expect("run");
        assert_eq!(out.stdout.len(), cap, "buffer bounded to display cap");
        assert!(out.stdout_truncated);
        assert!(
            out.status.success(),
            "finite verbose command still succeeds"
        );
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_capped_kills_child_that_closes_fds_but_keeps_running() {
        // A child that closes its own stdout/stderr while continuing to run
        // delivers EOF to the read loop almost immediately (no producer left),
        // but must still be killed at `timeout` rather than let `child.wait()`
        // block unbounded on the still-running process.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("exec 1>&- 2>&-; sleep 30");
        let cap = 4096;
        let started = std::time::Instant::now();
        let result = run_capped(cmd, Duration::from_secs(2), cap).await;
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "child.wait() must be bounded by the timeout too, not hang until the child exits on its own"
        );
        assert!(
            matches!(result, Err(CappedRunError::Timeout)),
            "expected Timeout, got {result:?}"
        );
    }

    #[tokio::test]
    #[cfg(unix)]
    async fn run_capped_kills_runaway_writer_early() {
        // An infinite producer must be killed well before the timeout, and the
        // buffered output must stay bounded to the display cap.
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg("while true; do printf 'yyyyyyyyyyyyyyyy'; done");
        let cap = 8 * 1024;
        let started = std::time::Instant::now();
        let out = run_capped(cmd, Duration::from_secs(30), cap)
            .await
            .expect("run");
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "runaway writer should be killed early, not run to timeout"
        );
        assert_eq!(out.stdout.len(), cap, "buffer bounded to display cap");
        assert!(out.stdout_truncated);
        assert!(!out.status.success(), "killed runaway is not a success");
    }
}
