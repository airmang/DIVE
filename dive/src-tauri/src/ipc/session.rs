use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;
use tauri::State;

use crate::db::dao::session as session_dao;
use crate::db::models::{NewSession, SessionRow};

use super::AppState;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn default_session_title(now_ms: i64) -> String {
    let secs = now_ms / 1000;
    let local_secs = secs + 9 * 3600;
    let days = local_secs / 86_400;
    let rem = local_secs.rem_euclid(86_400);
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let (year, month, day) = civil_from_days(days);
    format!("새 세션 {year:04}-{month:02}-{day:02} {hour:02}:{minute:02}")
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[tauri::command]
pub async fn session_create(
    state: State<'_, AppState>,
    project_id: i64,
    title: Option<String>,
) -> Result<SessionRow, String> {
    let final_title = title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_owned())
        .unwrap_or_else(|| default_session_title(now_ms()));
    let id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        session_dao::insert(
            db.conn(),
            &NewSession {
                project_id,
                title: final_title,
                ended_at: None,
                status: "active".into(),
            },
        )
        .map_err(|e| e.to_string())?
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let row = session_dao::get_by_id(db.conn(), id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("session {id} not found after insert"))?;
    drop(db);
    super::log_event(
        &state,
        Some(id),
        "session_start",
        json!({ "project_id": project_id, "title_len": row.title.chars().count() }),
    )?;
    Ok(row)
}

#[tauri::command]
pub async fn session_list(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<Vec<SessionRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut rows: Vec<SessionRow> = session_dao::list(db.conn())
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|s| s.project_id == project_id)
        .collect();
    rows.sort_by(|a, b| {
        let a_archived = a.status == "archived";
        let b_archived = b.status == "archived";
        a_archived
            .cmp(&b_archived)
            .then_with(|| b.started_at.cmp(&a.started_at))
    });
    Ok(rows)
}

#[tauri::command]
pub async fn session_rename(
    state: State<'_, AppState>,
    session_id: i64,
    title: String,
) -> Result<SessionRow, String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err("title cannot be empty".into());
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let existing = session_dao::get_by_id(db.conn(), session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("session {session_id} not found"))?;
    session_dao::update(
        db.conn(),
        session_id,
        &NewSession {
            project_id: existing.project_id,
            title: trimmed.to_owned(),
            ended_at: existing.ended_at,
            status: existing.status.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    session_dao::get_by_id(db.conn(), session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("session {session_id} missing after rename"))
}

#[tauri::command]
pub async fn session_archive(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let existing = session_dao::get_by_id(db.conn(), session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("session {session_id} not found"))?;
    session_dao::update(
        db.conn(),
        session_id,
        &NewSession {
            project_id: existing.project_id,
            title: existing.title,
            ended_at: Some(now_ms()),
            status: "archived".into(),
        },
    )
    .map_err(|e| e.to_string())?;
    drop(db);
    super::log_event(
        &state,
        Some(session_id),
        "session_end",
        json!({ "reason": "archived" }),
    )
}

#[tauri::command]
pub async fn session_delete(state: State<'_, AppState>, session_id: i64) -> Result<(), String> {
    super::log_event(
        &state,
        Some(session_id),
        "session_end",
        json!({ "reason": "deleted" }),
    )?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    session_dao::delete(db.conn(), session_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;
    use crate::db::dao::project as project_dao;
    use crate::db::models::NewProject;
    use crate::db::Database;
    use crate::providers::MockProvider;
    use std::sync::Arc;

    fn mk_state() -> AppState {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let provider = Arc::new(MockProvider::new(Vec::new()));
        AppState::new(db, provider, std::env::temp_dir(), "mock".into())
            .with_keyring(Arc::new(InMemoryKeyring::new()))
    }

    fn seed_project(state: &AppState) -> i64 {
        let db = state.db.lock().unwrap();
        project_dao::insert(
            db.conn(),
            &NewProject {
                name: "p".into(),
                path: "/tmp/proj".into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap()
    }

    fn insert_session(state: &AppState, project_id: i64, title: &str) -> i64 {
        let db = state.db.lock().unwrap();
        session_dao::insert(
            db.conn(),
            &NewSession {
                project_id,
                title: title.into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap()
    }

    #[test]
    fn default_title_has_timestamp_format() {
        let t = default_session_title(1_714_896_000_000);
        assert!(t.starts_with("새 세션 "));
        assert!(t.contains(":"));
        assert!(t.contains("-"));
    }

    #[test]
    fn list_sorts_active_before_archived() {
        let state = mk_state();
        let pid = seed_project(&state);
        let a = insert_session(&state, pid, "A");
        let b = insert_session(&state, pid, "B");
        {
            let db = state.db.lock().unwrap();
            let row = session_dao::get_by_id(db.conn(), a).unwrap().unwrap();
            session_dao::update(
                db.conn(),
                a,
                &NewSession {
                    project_id: row.project_id,
                    title: row.title,
                    ended_at: Some(1),
                    status: "archived".into(),
                },
            )
            .unwrap();
        }
        let db = state.db.lock().unwrap();
        let mut rows: Vec<_> = session_dao::list(db.conn())
            .unwrap()
            .into_iter()
            .filter(|s| s.project_id == pid)
            .collect();
        rows.sort_by(|x, y| {
            (x.status == "archived")
                .cmp(&(y.status == "archived"))
                .then_with(|| y.started_at.cmp(&x.started_at))
        });
        assert_eq!(rows[0].id, b);
        assert_eq!(rows[1].id, a);
    }
}
