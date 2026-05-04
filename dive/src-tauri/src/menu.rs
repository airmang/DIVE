//! Native application menu for DIVE.
//!
//! Menu IDs are forwarded to the frontend through `menu:*` events. Recent
//! projects are rebuilt as a full menu replacement so Tauri v2 stays on the
//! stable menu API surface.

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder},
    AppHandle, Emitter, Runtime,
};

/// Maximum number of recent projects shown in File > Open Recent.
pub const RECENT_PROJECTS_LIMIT: usize = 5;

/// Build the application menu with the provided recent project rows.
pub fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[(i64, String)],
) -> tauri::Result<Menu<R>> {
    let new_project = MenuItemBuilder::with_id("menu:new-project", "새 프로젝트")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_project = MenuItemBuilder::with_id("menu:open-project", "프로젝트 열기…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let recent_submenu = build_recent_submenu(app, recents)?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&new_project)
        .item(&open_project)
        .item(&recent_submenu)
        .separator()
        .close_window()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let settings = MenuItemBuilder::with_id("menu:settings", "설정…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let toggle_theme = MenuItemBuilder::with_id("menu:toggle-theme", "테마 전환")
        .accelerator("CmdOrCtrl+Shift+T")
        .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&settings)
        .item(&toggle_theme)
        .build()?;

    let help_tutorial =
        MenuItemBuilder::with_id("menu:help-tutorial", "튜토리얼 모드 토글").build(app)?;
    let help_docs = MenuItemBuilder::with_id("menu:help-docs", "문서 보기").build(app)?;
    let help_issue = MenuItemBuilder::with_id("menu:help-issue", "문제 신고").build(app)?;
    let help_about = MenuItemBuilder::with_id("menu:help-about", "DIVE 정보").build(app)?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&help_tutorial)
        .separator()
        .item(&help_docs)
        .item(&help_issue)
        .separator()
        .item(&help_about)
        .build()?;

    #[cfg(target_os = "macos")]
    let menu = {
        let app_settings = MenuItemBuilder::with_id("menu:settings", "Preferences…")
            .accelerator("CmdOrCtrl+,")
            .build(app)?;
        let app_submenu = SubmenuBuilder::new(app, "DIVE")
            .about(None)
            .separator()
            .item(&app_settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        MenuBuilder::new(app)
            .items(&[&app_submenu, &file, &edit, &view, &help])
            .build()?
    };

    #[cfg(not(target_os = "macos"))]
    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &help])
        .build()?;

    Ok(menu)
}

fn build_recent_submenu<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[(i64, String)],
) -> tauri::Result<Submenu<R>> {
    let mut builder = SubmenuBuilder::new(app, "최근 프로젝트 열기");

    if recents.is_empty() {
        let empty = MenuItemBuilder::with_id("menu:recent-empty", "(최근 프로젝트 없음)")
            .enabled(false)
            .build(app)?;
        builder = builder.item(&empty);
    } else {
        for (id, label) in recents.iter().take(RECENT_PROJECTS_LIMIT) {
            let item = MenuItemBuilder::with_id(
                format!("menu:open-recent:{id}"),
                sanitize_recent_label(label),
            )
            .build(app)?;
            builder = builder.item(&item);
        }
        // v4 intentionally omits "clear recent". The Project table is the
        // source of truth, so clearing recents needs an explicit v5 data model.
    }

    builder.build()
}

fn sanitize_recent_label(label: &str) -> String {
    let single_line = label
        .chars()
        .map(|ch| if ch == '\n' || ch == '\r' { ' ' } else { ch })
        .collect::<String>();
    let trimmed = single_line.trim();
    let fallback = if trimmed.is_empty() {
        "(untitled)"
    } else {
        trimmed
    };
    if fallback.chars().count() > 40 {
        let truncated = fallback.chars().take(37).collect::<String>();
        format!("{truncated}…")
    } else {
        fallback.to_owned()
    }
}

/// Install global menu click forwarding.
pub fn install_event_handler<R: Runtime>(app: &AppHandle<R>) {
    app.on_menu_event(|app_handle, event| {
        let id = event.id().as_ref();
        if let Some(project_id) = id
            .strip_prefix("menu:open-recent:")
            .and_then(|rest| rest.parse::<i64>().ok())
        {
            let _ = app_handle.emit(
                "menu:open-recent",
                serde_json::json!({ "project_id": project_id }),
            );
            return;
        }

        let _ = app_handle.emit(id, ());
    });
}

/// Replace the application menu with a freshly built recent-project list.
pub fn rebuild_menu_with_recents<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[(i64, String)],
) -> tauri::Result<()> {
    let menu = build_menu(app, recents)?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::sanitize_recent_label;

    #[test]
    fn recent_label_is_single_line_and_truncated() {
        let label = "0123456789012345678901234567890123456789\nignored";
        let sanitized = sanitize_recent_label(label);
        assert!(!sanitized.contains('\n'));
        assert_eq!(sanitized.chars().count(), 38);
        assert!(sanitized.ends_with('…'));
    }

    #[test]
    fn empty_recent_label_has_placeholder() {
        assert_eq!(sanitize_recent_label(" \n "), "(untitled)");
    }
}
