use serde::{Deserialize, Serialize};
use tauri::State;

use super::AppState;
use crate::mcp::{dao as mcp_dao, InitializeResult, McpServerRegistry, McpToolInfo, NewMcpServer};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerInput {
    pub label: String,
    pub transport: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Option<serde_json::Value>,
    #[serde(default)]
    pub env: Option<serde_json::Value>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Option<serde_json::Value>,
    #[serde(default = "default_risk")]
    pub default_risk: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_risk() -> String {
    "caution".into()
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConnectResult {
    pub initialize: InitializeResult,
    pub tools: Vec<McpToolInfo>,
}

#[tauri::command]
pub async fn mcp_server_add(
    state: State<'_, AppState>,
    server: McpServerInput,
) -> Result<i64, String> {
    let new = validate_mcp_server_input(&server)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mcp_dao::insert(db.conn(), &new).map_err(|e| e.to_string())
}

fn validate_mcp_server_input(server: &McpServerInput) -> Result<NewMcpServer, String> {
    let label = server.label.trim();
    if label.is_empty() {
        return Err("mcp label is required".into());
    }
    if label.len() > 80
        || !label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' '))
    {
        return Err("mcp label must be 1-80 ASCII letters, numbers, spaces, '-' or '_'".into());
    }

    let default_risk = server.default_risk.trim();
    if !matches!(default_risk, "safe" | "caution" | "danger") {
        return Err("mcp default_risk must be safe, caution, or danger".into());
    }

    let transport = server.transport.trim();
    match transport {
        "http" => {
            let url = validate_mcp_https_url(server.url.as_deref())?;
            validate_json_string_map("headers", server.headers.as_ref())?;
            Ok(NewMcpServer {
                label: label.into(),
                transport: "http".into(),
                command: None,
                args: None,
                env: None,
                url: Some(url),
                headers: server.headers.clone(),
                default_risk: default_risk.into(),
                enabled: server.enabled,
            })
        }
        "stdio" => {
            let command = validate_mcp_stdio_command(server.command.as_deref())?;
            validate_stdio_args(server.args.as_ref())?;
            validate_json_string_map("env", server.env.as_ref())?;
            Ok(NewMcpServer {
                label: label.into(),
                transport: "stdio".into(),
                command: Some(command),
                args: server.args.clone(),
                env: server.env.clone(),
                url: None,
                headers: None,
                default_risk: default_risk.into(),
                enabled: server.enabled,
            })
        }
        _ => Err("mcp transport must be http or stdio".into()),
    }
}

fn validate_mcp_https_url(url: Option<&str>) -> Result<String, String> {
    let raw = url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "mcp http url is required".to_string())?;
    let parsed = reqwest::Url::parse(raw).map_err(|_| "mcp url must be a valid https URL")?;
    if parsed.scheme() != "https" {
        return Err("mcp url must use https".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "mcp url must include a host".to_string())?;
    if matches!(host, "localhost" | "127.0.0.1" | "::1") || host.ends_with(".local") {
        return Err("mcp url must not target localhost or local-only hosts".into());
    }
    Ok(parsed.to_string())
}

fn validate_mcp_stdio_command(command: Option<&str>) -> Result<String, String> {
    let command = command
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "mcp stdio command is required".to_string())?;
    if command.len() > 40
        || !command
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err("mcp stdio command must be a bare executable name".into());
    }
    if !matches!(command, "npx" | "pnpm" | "bunx" | "uvx") {
        return Err("mcp stdio command must use an approved MCP package launcher".into());
    }
    Ok(command.into())
}

fn validate_stdio_args(args: Option<&serde_json::Value>) -> Result<(), String> {
    let Some(args) = args else {
        return Ok(());
    };
    let arr = args
        .as_array()
        .ok_or_else(|| "mcp stdio args must be an array of strings".to_string())?;
    if arr.len() > 32 {
        return Err("mcp stdio args may contain at most 32 entries".into());
    }
    for value in arr {
        let arg = value
            .as_str()
            .ok_or_else(|| "mcp stdio args must be strings".to_string())?;
        if arg.is_empty() || arg.len() > 200 || arg.contains('\0') || arg.contains('\n') {
            return Err("mcp stdio args contain an invalid value".into());
        }
    }
    Ok(())
}

fn validate_json_string_map(
    field: &'static str,
    value: Option<&serde_json::Value>,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };
    let obj = value
        .as_object()
        .ok_or_else(|| format!("mcp {field} must be an object of string values"))?;
    if obj.len() > 32 {
        return Err(format!("mcp {field} may contain at most 32 entries"));
    }
    for (key, value) in obj {
        if key.is_empty()
            || key.len() > 80
            || key.contains('\0')
            || key.contains('\n')
            || !value
                .as_str()
                .is_some_and(|s| !s.contains('\0') && !s.contains('\n'))
        {
            return Err(format!("mcp {field} contains an invalid entry"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_server_list(
    state: State<'_, AppState>,
) -> Result<Vec<mcp_dao::McpServerRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mcp_dao::list(db.conn()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_server_remove(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mcp_dao::delete(db.conn(), id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_server_set_enabled(
    state: State<'_, AppState>,
    id: i64,
    enabled: bool,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    mcp_dao::set_enabled(db.conn(), id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_server_test_connect(
    state: State<'_, AppState>,
    id: i64,
) -> Result<McpConnectResult, String> {
    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        mcp_dao::get(db.conn(), id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("mcp server {id} not found"))?
    };
    let (_client, init, tools) = McpServerRegistry::connect_and_initialize(&row)
        .await
        .map_err(|e| e.to_string())?;
    Ok(McpConnectResult {
        initialize: init,
        tools,
    })
}

#[tauri::command]
pub async fn mcp_server_list_tools(
    state: State<'_, AppState>,
    id: i64,
) -> Result<Vec<McpToolInfo>, String> {
    let row = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        mcp_dao::get(db.conn(), id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("mcp server {id} not found"))?
    };
    let (_client, _init, tools) = McpServerRegistry::connect_and_initialize(&row)
        .await
        .map_err(|e| e.to_string())?;
    Ok(tools)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::InMemoryKeyring;
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

    #[tokio::test]
    async fn add_list_remove_cycle() {
        let state = mk_state();
        let id = {
            let db = state.db.lock().unwrap();
            mcp_dao::insert(
                db.conn(),
                &NewMcpServer {
                    label: "fs".into(),
                    transport: "stdio".into(),
                    command: Some("cat".into()),
                    default_risk: "caution".into(),
                    enabled: true,
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let db = state.db.lock().unwrap();
        let rows = mcp_dao::list(db.conn()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].label, "fs");
        drop(db);

        let db = state.db.lock().unwrap();
        mcp_dao::delete(db.conn(), id).unwrap();
        assert_eq!(mcp_dao::list(db.conn()).unwrap().len(), 0);
    }

    #[test]
    fn validation_rejects_unsafe_stdio_command_shapes() {
        for command in [
            "",
            "/usr/bin/node",
            "../server",
            "node server.js",
            "npx;rm -rf project",
        ] {
            let err = validate_mcp_server_input(&McpServerInput {
                label: "fs".into(),
                transport: "stdio".into(),
                command: Some(command.into()),
                default_risk: "caution".into(),
                ..valid_http_input()
            })
            .unwrap_err();
            assert!(
                err.contains("command"),
                "expected command validation error for {command:?}, got {err}"
            );
        }
    }

    #[test]
    fn validation_rejects_non_https_http_server_urls() {
        for url in [
            "",
            "http://evil.example/rpc",
            "file:///tmp/server.sock",
            "https://",
            "https://localhost/rpc",
        ] {
            let err = validate_mcp_server_input(&McpServerInput {
                url: Some(url.into()),
                ..valid_http_input()
            })
            .unwrap_err();
            assert!(
                err.contains("url") || err.contains("https"),
                "expected URL validation error for {url:?}, got {err}"
            );
        }
    }

    #[test]
    fn validation_accepts_minimal_https_http_server() {
        let input = valid_http_input();
        let validated = validate_mcp_server_input(&input).unwrap();
        assert_eq!(validated.transport, "http");
        assert_eq!(
            validated.url.as_deref(),
            Some("https://mcp.example.com/rpc")
        );
        assert!(validated.enabled);
    }

    fn valid_http_input() -> McpServerInput {
        McpServerInput {
            label: "docs".into(),
            transport: "http".into(),
            command: None,
            args: None,
            env: None,
            url: Some("https://mcp.example.com/rpc".into()),
            headers: Some(serde_json::json!({"Authorization": "Bearer test"})),
            default_risk: "caution".into(),
            enabled: true,
        }
    }
}
