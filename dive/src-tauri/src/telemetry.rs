use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::Manager;
use thiserror::Error;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

static LOG_GUARD: OnceLock<tracing_appender::non_blocking::WorkerGuard> = OnceLock::new();
static PANIC_HOOK_INSTALLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Error)]
pub enum TelemetryError {
    #[error("tauri: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub(crate) fn logs_dir_from_app_data(app_data_dir: impl AsRef<Path>) -> PathBuf {
    app_data_dir.as_ref().join("logs")
}

pub(crate) fn redact_log_text(text: &str) -> String {
    crate::dive::event_log::redact_text(text)
}

pub(crate) fn init_file_logging(app: &tauri::AppHandle) -> Result<Option<PathBuf>, TelemetryError> {
    let logs_dir = logs_dir_from_app_data(app_data_dir_from_environment(app)?);
    init_file_logging_at(&logs_dir)?;
    Ok(Some(logs_dir))
}

fn app_data_dir_from_environment(app: &tauri::AppHandle) -> Result<PathBuf, tauri::Error> {
    if let Some(path) = std::env::var_os("DIVE_QA_APP_DATA_DIR").map(PathBuf::from) {
        return Ok(path);
    }
    app.path().app_local_data_dir()
}

fn init_file_logging_at(logs_dir: &Path) -> Result<(), TelemetryError> {
    std::fs::create_dir_all(logs_dir)?;
    let file_appender = tracing_appender::rolling::daily(logs_dir, "dive.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(true)
        .with_thread_names(true);
    let subscriber = tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer);

    if subscriber.try_init().is_ok() {
        let _ = LOG_GUARD.set(guard);
    }
    Ok(())
}

pub(crate) fn install_panic_hook() {
    if PANIC_HOOK_INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!(
            target: "dive::panic",
            "{}",
            format_panic_hook_info(info)
        );
        previous_hook(info);
    }));
}

#[allow(deprecated)]
fn format_panic_hook_info(info: &std::panic::PanicInfo<'_>) -> String {
    let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
        *s
    } else if let Some(s) = info.payload().downcast_ref::<String>() {
        s.as_str()
    } else {
        "<non-string panic payload>"
    };
    let location = info
        .location()
        .map(|location| (location.file(), location.line(), location.column()));
    format_panic_log_message(payload, location)
}

pub(crate) fn format_panic_log_message(
    payload: &str,
    location: Option<(&str, u32, u32)>,
) -> String {
    let payload = redact_log_text(payload);
    match location {
        Some((file, line, column)) => {
            format!("panic captured at {file}:{line}:{column}: {payload}")
        }
        None => format!("panic captured: {payload}"),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    #[test]
    fn logs_dir_is_under_app_local_data_dir() {
        let base = PathBuf::from("/tmp/dive-data");

        assert_eq!(super::logs_dir_from_app_data(&base), base.join("logs"));
    }

    #[test]
    fn redact_log_text_masks_common_secret_fields() {
        let input = "api_key=sk-test password=hunter2 token: abc.def";
        let redacted = super::redact_log_text(input);

        assert!(!redacted.contains("sk-test"));
        assert!(!redacted.contains("hunter2"));
        assert!(!redacted.contains("abc.def"));
        assert!(redacted.contains("[REDACTED_SECRET]"));
    }

    #[test]
    fn panic_log_message_redacts_payload_and_includes_location() {
        let message = super::format_panic_log_message(
            "crashed with token=secret-token",
            Some(("src/main.rs", 12, 34)),
        );

        assert!(message.contains("src/main.rs:12:34"));
        assert!(!message.contains("secret-token"));
        assert!(message.contains("[REDACTED_SECRET]"));
    }
}
