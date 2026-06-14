//! Native application menu for DIVE.
//!
//! Menu IDs are forwarded to the frontend through `menu:*` events. Recent
//! projects are rebuilt as a full menu replacement so Tauri v2 stays on the
//! stable menu API surface.

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, Submenu, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime,
};

/// Maximum number of recent projects shown in File > Open Recent.
pub const RECENT_PROJECTS_LIMIT: usize = 5;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MenuLocale {
    Ko,
    En,
}

impl MenuLocale {
    fn from_code(code: &str) -> Option<Self> {
        match code {
            "ko" => Some(Self::Ko),
            "en" => Some(Self::En),
            _ => None,
        }
    }

    pub fn from_env() -> Self {
        let locale = std::env::var("LC_ALL")
            .or_else(|_| std::env::var("LANG"))
            .unwrap_or_default()
            .to_lowercase();
        if locale.starts_with("ko") {
            Self::Ko
        } else {
            Self::En
        }
    }
}

pub struct MenuLocaleState(Mutex<MenuLocale>);

impl MenuLocaleState {
    pub fn new(locale: MenuLocale) -> Self {
        Self(Mutex::new(locale))
    }

    fn get(&self) -> MenuLocale {
        self.0.lock().map(|guard| *guard).unwrap_or(MenuLocale::En)
    }

    fn set(&self, locale: MenuLocale) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = locale;
        }
    }
}

impl Default for MenuLocaleState {
    fn default() -> Self {
        Self::new(MenuLocale::from_env())
    }
}

struct MenuLabels {
    app_preferences: &'static str,
    file: &'static str,
    new_project: &'static str,
    open_project: &'static str,
    recent_projects: &'static str,
    recent_empty: &'static str,
    edit: &'static str,
    view: &'static str,
    settings: &'static str,
    toggle_theme: &'static str,
    help: &'static str,
    help_tutorial: &'static str,
    help_docs: &'static str,
    help_issue: &'static str,
    help_about: &'static str,
    untitled: &'static str,
}

fn labels(locale: MenuLocale) -> &'static MenuLabels {
    match locale {
        MenuLocale::Ko => &MenuLabels {
            app_preferences: "설정…",
            file: "파일",
            new_project: "새 프로젝트",
            open_project: "프로젝트 열기…",
            recent_projects: "최근 프로젝트 열기",
            recent_empty: "(최근 프로젝트 없음)",
            edit: "편집",
            view: "보기",
            settings: "설정…",
            toggle_theme: "테마 전환",
            help: "도움말",
            help_tutorial: "튜토리얼 모드 토글",
            help_docs: "문서 보기",
            help_issue: "문제 신고",
            help_about: "DIVE 정보",
            untitled: "(제목 없음)",
        },
        MenuLocale::En => &MenuLabels {
            app_preferences: "Preferences…",
            file: "File",
            new_project: "New Project",
            open_project: "Open Project…",
            recent_projects: "Open Recent",
            recent_empty: "(No Recent Projects)",
            edit: "Edit",
            view: "View",
            settings: "Settings…",
            toggle_theme: "Toggle Theme",
            help: "Help",
            help_tutorial: "Toggle Tutorial Mode",
            help_docs: "View Documentation",
            help_issue: "Report Issue",
            help_about: "About DIVE",
            untitled: "(untitled)",
        },
    }
}

/// Build the application menu with the provided recent project rows.
pub fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[(i64, String)],
) -> tauri::Result<Menu<R>> {
    build_menu_for_locale(app, recents, MenuLocale::from_env())
}

pub fn build_menu_for_locale<R: Runtime>(
    app: &AppHandle<R>,
    recents: &[(i64, String)],
    locale: MenuLocale,
) -> tauri::Result<Menu<R>> {
    let labels = labels(locale);
    let new_project = MenuItemBuilder::with_id("menu:new-project", labels.new_project)
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_project = MenuItemBuilder::with_id("menu:open-project", labels.open_project)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let recent_submenu = build_recent_submenu(app, recents, labels)?;

    let file = SubmenuBuilder::new(app, labels.file)
        .item(&new_project)
        .item(&open_project)
        .item(&recent_submenu)
        .separator()
        .close_window()
        .build()?;

    let edit = SubmenuBuilder::new(app, labels.edit)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let settings = MenuItemBuilder::with_id("menu:settings", labels.settings)
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let toggle_theme = MenuItemBuilder::with_id("menu:toggle-theme", labels.toggle_theme)
        .accelerator("CmdOrCtrl+Shift+T")
        .build(app)?;
    let view = SubmenuBuilder::new(app, labels.view)
        .item(&settings)
        .item(&toggle_theme)
        .build()?;

    let help_tutorial =
        MenuItemBuilder::with_id("menu:help-tutorial", labels.help_tutorial).build(app)?;
    let help_docs = MenuItemBuilder::with_id("menu:help-docs", labels.help_docs).build(app)?;
    let help_issue = MenuItemBuilder::with_id("menu:help-issue", labels.help_issue).build(app)?;
    let help_about = MenuItemBuilder::with_id("menu:help-about", labels.help_about).build(app)?;
    let help = SubmenuBuilder::new(app, labels.help)
        .item(&help_tutorial)
        .separator()
        .item(&help_docs)
        .item(&help_issue)
        .separator()
        .item(&help_about)
        .build()?;

    #[cfg(target_os = "macos")]
    let menu = {
        let app_settings = MenuItemBuilder::with_id("menu:settings", labels.app_preferences)
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
    labels: &'static MenuLabels,
) -> tauri::Result<Submenu<R>> {
    let mut builder = SubmenuBuilder::new(app, labels.recent_projects);

    if recents.is_empty() {
        let empty = MenuItemBuilder::with_id("menu:recent-empty", labels.recent_empty)
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
    sanitize_recent_label_with_fallback(label, labels(MenuLocale::En).untitled)
}

fn sanitize_recent_label_with_fallback(label: &str, untitled: &str) -> String {
    let single_line = label
        .chars()
        .map(|ch| if ch == '\n' || ch == '\r' { ' ' } else { ch })
        .collect::<String>();
    let trimmed = single_line.trim();
    let fallback = if trimmed.is_empty() {
        untitled
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
    let locale = current_menu_locale(app);
    let menu = build_menu_for_locale(app, recents, locale)?;
    app.set_menu(menu)?;
    Ok(())
}

fn current_menu_locale<R: Runtime>(app: &AppHandle<R>) -> MenuLocale {
    app.try_state::<MenuLocaleState>()
        .map(|state| state.get())
        .unwrap_or_else(MenuLocale::from_env)
}

#[tauri::command]
pub fn menu_set_locale(app: AppHandle, locale: String) -> Result<(), String> {
    let locale = MenuLocale::from_code(locale.as_str())
        .ok_or_else(|| format!("unsupported menu locale: {locale}"))?;
    if let Some(state) = app.try_state::<MenuLocaleState>() {
        state.set(locale);
    }
    let recents = crate::ipc::fetch_recent_projects_for_menu(&app).unwrap_or_default();
    let menu = build_menu_for_locale(&app, &recents, locale).map_err(|err| err.to_string())?;
    app.set_menu(menu)
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::{labels, sanitize_recent_label, sanitize_recent_label_with_fallback, MenuLocale};

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

    #[test]
    fn menu_labels_follow_locale() {
        assert_eq!(labels(MenuLocale::En).new_project, "New Project");
        assert_eq!(labels(MenuLocale::En).help_docs, "View Documentation");
        assert_eq!(labels(MenuLocale::Ko).new_project, "새 프로젝트");
        assert_eq!(labels(MenuLocale::Ko).help_docs, "문서 보기");
    }

    #[test]
    fn recent_label_uses_localized_empty_placeholder() {
        assert_eq!(
            sanitize_recent_label_with_fallback(" \n ", "(제목 없음)"),
            "(제목 없음)"
        );
    }
}
