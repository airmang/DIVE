use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::agent::AgentLoop;

pub(super) const RUNTIME_STATE_PROTOCOL_VERSION: u32 = 1;

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

pub(super) fn runtime_state_path(root: &Path, session_id: i64) -> PathBuf {
    root.join("pi-sidecar")
        .join("sessions")
        .join(session_id.to_string())
        .join("state.json")
}

pub(super) fn write_runtime_state(path: &Path, state: &PiRuntimeState) -> Result<(), String> {
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

pub(super) fn mark_active_step_blocked_by_pi_runtime_error(
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

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::super::credential::file_mode_string;
    use super::super::{DEFAULT_MODEL, PROVIDER_ID};
    use super::*;

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
}
