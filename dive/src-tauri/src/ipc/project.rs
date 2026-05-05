use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, State};

use crate::menu::RECENT_PROJECTS_LIMIT;

use crate::checkpoint::CheckpointEngine;
use crate::db::dao::project as project_dao;
use crate::db::models::{NewProject, ProjectRow};

use super::AppState;

fn project_name_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|os| os.to_str())
        .map(|s| s.to_owned())
        .unwrap_or_else(|| "project".to_owned())
}

fn ensure_dive_dir(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root.join(".dive")).map_err(|e| format!("create .dive/: {e}"))
}

fn run_checkpoint_init(state: &AppState, root: &Path) -> Result<(), String> {
    let engine = CheckpointEngine::new(root.to_path_buf(), state.db.clone());
    engine.init().map_err(|e| e.to_string())
}

fn insert_project(state: &AppState, name: String, root: &Path) -> Result<ProjectRow, String> {
    let id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        project_dao::insert(
            db.conn(),
            &NewProject {
                name,
                path: root.to_string_lossy().into_owned(),
                provider_default: None,
                model_default: None,
            },
        )
        .map_err(|e| e.to_string())?
    };
    run_checkpoint_init(state, root)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    project_dao::get_by_id(db.conn(), id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {id} not found after insert"))
}

fn project_create_impl(
    state: &AppState,
    name: Option<String>,
    path: String,
) -> Result<ProjectRow, String> {
    let root = PathBuf::from(&path);
    std::fs::create_dir_all(&root).map_err(|e| format!("create project dir: {e}"))?;
    ensure_dive_dir(&root)?;
    let resolved_name = name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_owned())
        .unwrap_or_else(|| project_name_from_path(&root));
    let row = insert_project(state, resolved_name, &root)?;
    state.swap_project_root(root)?;
    Ok(row)
}

#[tauri::command]
pub async fn project_create(
    state: State<'_, AppState>,
    name: Option<String>,
    path: String,
) -> Result<ProjectRow, String> {
    project_create_impl(&state, name, path)
}

#[tauri::command]
pub async fn project_list(state: State<'_, AppState>) -> Result<Vec<ProjectRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut rows = project_dao::list(db.conn()).map_err(|e| e.to_string())?;
    rows.sort_by_key(|r| std::cmp::Reverse(r.updated_at));
    Ok(rows)
}

#[tauri::command]
pub async fn project_get(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<Option<ProjectRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    project_dao::get_by_id(db.conn(), project_id).map_err(|e| e.to_string())
}

fn project_open_impl(state: &AppState, path: String) -> Result<ProjectRow, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("path does not exist: {}", root.display()));
    }
    let existing = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        project_dao::list(db.conn())
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|row| Path::new(&row.path) == root)
    };
    if let Some(mut row) = existing {
        ensure_dive_dir(&root)?;
        run_checkpoint_init(state, &root)?;
        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            project_dao::touch(db.conn(), row.id).map_err(|e| e.to_string())?;
            if let Some(touched) =
                project_dao::get_by_id(db.conn(), row.id).map_err(|e| e.to_string())?
            {
                row = touched;
            }
        }
        state.swap_project_root(root)?;
        return Ok(row);
    }
    ensure_dive_dir(&root)?;
    let row = insert_project(state, project_name_from_path(&root), &root)?;
    state.swap_project_root(root)?;
    Ok(row)
}

#[tauri::command]
pub async fn project_open(state: State<'_, AppState>, path: String) -> Result<ProjectRow, String> {
    project_open_impl(&state, path)
}

fn project_select_impl(state: &AppState, project_id: i64) -> Result<ProjectRow, String> {
    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        project_dao::get_by_id(db.conn(), project_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("project {project_id} not found"))?
    };
    let root = PathBuf::from(&row.path);
    if !root.exists() {
        return Err(format!("path does not exist: {}", root.display()));
    }
    ensure_dive_dir(&root)?;
    run_checkpoint_init(state, &root)?;
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        project_dao::touch(db.conn(), row.id).map_err(|e| e.to_string())?;
    }
    state.swap_project_root(root)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    project_dao::get_by_id(db.conn(), row.id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {project_id} not found after select"))
}

#[tauri::command]
pub async fn project_select(
    state: State<'_, AppState>,
    project_id: i64,
) -> Result<ProjectRow, String> {
    project_select_impl(&state, project_id)
}

fn project_delete_impl(
    state: &AppState,
    project_id: i64,
    delete_folder: bool,
) -> Result<(), String> {
    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        project_dao::get_by_id(db.conn(), project_id).map_err(|e| e.to_string())?
    }
    .ok_or_else(|| format!("project {project_id} not found"))?;
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        project_dao::delete(db.conn(), project_id).map_err(|e| e.to_string())?;
    }
    let root = PathBuf::from(&row.path);
    let was_active = state.project_root_snapshot() == root;
    if delete_folder {
        if root.exists() {
            std::fs::remove_dir_all(&root).map_err(|e| format!("remove project dir: {e}"))?;
        }
    } else {
        let dive_dir = root.join(".dive");
        if dive_dir.exists() {
            std::fs::remove_dir_all(&dive_dir).map_err(|e| format!("remove .dive/: {e}"))?;
        }
    }
    if was_active {
        state.swap_project_root(PathBuf::new())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn project_delete(
    state: State<'_, AppState>,
    project_id: i64,
    delete_folder: bool,
) -> Result<(), String> {
    project_delete_impl(&state, project_id, delete_folder)
}

/// Fetch recent projects for native menu rendering.
pub fn fetch_recent_projects_for_menu<R: tauri::Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<(i64, String)>, String> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let projects = project_dao::list_recent(db.conn(), RECENT_PROJECTS_LIMIT as i64)
        .map_err(|e| e.to_string())?;
    Ok(projects
        .into_iter()
        .map(|project| {
            let label = if project.name.trim().is_empty() {
                project.path
            } else {
                project.name
            };
            (project.id, label)
        })
        .collect())
}

/// Rebuild File > Open Recent after project create/open/delete.
#[tauri::command]
pub fn menu_refresh_recents(app: AppHandle) -> Result<(), String> {
    let recents = fetch_recent_projects_for_menu(&app).unwrap_or_default();
    crate::menu::rebuild_menu_with_recents(&app, &recents).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;
    use crate::db::Database;
    use crate::providers::MockProvider;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn mk_state(tmp: &TempDir) -> AppState {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        let provider = Arc::new(MockProvider::new(Vec::new()));
        AppState::new(db, provider, tmp.path().to_path_buf(), "mock".into())
            .with_keyring(Arc::new(InMemoryKeyring::new()))
    }

    #[test]
    fn insert_project_creates_dive_dir_and_inits_checkpoint() {
        let tmp = tempfile::tempdir().unwrap();
        let state = mk_state(&tmp);
        let root = tmp.path().join("proj-a");
        std::fs::create_dir_all(&root).unwrap();
        ensure_dive_dir(&root).unwrap();
        let row = insert_project(&state, "proj-a".into(), &root).unwrap();
        assert_eq!(row.name, "proj-a");
        assert!(root.join(".dive").exists());
        assert!(root.join(".dive/git/HEAD").exists());
    }

    #[test]
    fn project_create_and_open_swap_active_project_root() {
        let tmp = tempfile::tempdir().unwrap();
        let state = mk_state(&tmp);
        let root_a = tmp.path().join("proj-active-a");
        let root_b = tmp.path().join("proj-active-b");
        std::fs::create_dir_all(&root_b).unwrap();

        let row_a =
            project_create_impl(&state, Some("A".into()), root_a.to_string_lossy().into()).unwrap();
        assert_eq!(row_a.name, "A");
        assert_eq!(state.project_root_snapshot(), root_a);

        let row_b = project_open_impl(&state, root_b.to_string_lossy().into()).unwrap();
        assert_eq!(row_b.name, "proj-active-b");
        assert_eq!(state.project_root_snapshot(), root_b);

        let row_a_again = project_open_impl(&state, root_a.to_string_lossy().into()).unwrap();
        assert_eq!(row_a_again.id, row_a.id);
        assert_eq!(state.project_root_snapshot(), root_a);
    }

    #[test]
    fn project_select_swaps_active_project_root_for_existing_project() {
        let tmp = tempfile::tempdir().unwrap();
        let state = mk_state(&tmp);
        let root_a = tmp.path().join("proj-select-a");
        let root_b = tmp.path().join("proj-select-b");

        let row_a =
            project_create_impl(&state, Some("A".into()), root_a.to_string_lossy().into()).unwrap();
        let row_b =
            project_create_impl(&state, Some("B".into()), root_b.to_string_lossy().into()).unwrap();
        assert_eq!(state.project_root_snapshot(), root_b);

        let selected = project_select_impl(&state, row_a.id).unwrap();
        assert_eq!(selected.id, row_a.id);
        assert_eq!(state.project_root_snapshot(), root_a);

        let selected_b = project_select_impl(&state, row_b.id).unwrap();
        assert_eq!(selected_b.id, row_b.id);
        assert_eq!(state.project_root_snapshot(), root_b);
    }

    #[test]
    fn project_delete_clears_active_project_root_only_for_active_project() {
        let tmp = tempfile::tempdir().unwrap();
        let state = mk_state(&tmp);
        let root_a = tmp.path().join("proj-delete-a");
        let root_b = tmp.path().join("proj-delete-b");

        let row_a =
            project_create_impl(&state, Some("A".into()), root_a.to_string_lossy().into()).unwrap();
        let row_b =
            project_create_impl(&state, Some("B".into()), root_b.to_string_lossy().into()).unwrap();
        assert_eq!(state.project_root_snapshot(), root_b);

        project_delete_impl(&state, row_a.id, false).unwrap();
        assert_eq!(state.project_root_snapshot(), root_b);

        project_delete_impl(&state, row_b.id, false).unwrap();
        assert!(state.project_root_snapshot().as_os_str().is_empty());
        assert!(state.project_root_required().is_err());
    }

    #[test]
    fn list_then_delete_cleans_dive_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let state = mk_state(&tmp);
        let root = tmp.path().join("proj-b");
        std::fs::create_dir_all(&root).unwrap();
        ensure_dive_dir(&root).unwrap();
        let row = insert_project(&state, "proj-b".into(), &root).unwrap();
        {
            let db = state.db.lock().unwrap();
            project_dao::delete(db.conn(), row.id).unwrap();
        }
        let dive = root.join(".dive");
        assert!(dive.exists());
        std::fs::remove_dir_all(&dive).unwrap();
        assert!(!dive.exists());
        assert!(root.exists());
    }
}
