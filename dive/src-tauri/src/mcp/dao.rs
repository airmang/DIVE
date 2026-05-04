use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::db::{now_ms, DbError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NewMcpServer {
    pub label: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<serde_json::Value>,
    pub env: Option<serde_json::Value>,
    pub url: Option<String>,
    pub headers: Option<serde_json::Value>,
    pub default_risk: String,
    pub enabled: bool,
}

impl Default for NewMcpServer {
    fn default() -> Self {
        Self {
            label: String::new(),
            transport: "stdio".into(),
            command: None,
            args: None,
            env: None,
            url: None,
            headers: None,
            default_risk: "caution".into(),
            enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct McpServerRow {
    pub id: i64,
    pub label: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<serde_json::Value>,
    pub env: Option<serde_json::Value>,
    pub url: Option<String>,
    pub headers: Option<serde_json::Value>,
    pub default_risk: String,
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

fn from_row(row: &Row<'_>) -> rusqlite::Result<McpServerRow> {
    let args_str: Option<String> = row.get("args")?;
    let env_str: Option<String> = row.get("env")?;
    let headers_str: Option<String> = row.get("headers")?;
    Ok(McpServerRow {
        id: row.get("id")?,
        label: row.get("label")?,
        transport: row.get("transport")?,
        command: row.get("command")?,
        args: parse_json(args_str.as_deref())?,
        env: parse_json(env_str.as_deref())?,
        url: row.get("url")?,
        headers: parse_json(headers_str.as_deref())?,
        default_risk: row.get("default_risk")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn parse_json(s: Option<&str>) -> rusqlite::Result<Option<serde_json::Value>> {
    match s {
        None => Ok(None),
        Some(raw) => serde_json::from_str(raw).map(Some).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        }),
    }
}

fn to_json_str(v: &Option<serde_json::Value>) -> Option<String> {
    v.as_ref().map(|x| x.to_string())
}

pub fn insert(conn: &Connection, new: &NewMcpServer) -> Result<i64, DbError> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO McpServer (label, transport, command, args, env, url, headers, default_risk, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            new.label,
            new.transport,
            new.command,
            to_json_str(&new.args),
            to_json_str(&new.env),
            new.url,
            to_json_str(&new.headers),
            new.default_risk,
            new.enabled as i64,
            now,
            now,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<Option<McpServerRow>, DbError> {
    conn.query_row(
        "SELECT id, label, transport, command, args, env, url, headers, default_risk, enabled, created_at, updated_at FROM McpServer WHERE id = ?",
        [id],
        from_row,
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other.into()),
    })
}

pub fn list(conn: &Connection) -> Result<Vec<McpServerRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, label, transport, command, args, env, url, headers, default_risk, enabled, created_at, updated_at FROM McpServer ORDER BY id",
    )?;
    let rows = stmt
        .query_map([], from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), DbError> {
    conn.execute("DELETE FROM McpServer WHERE id = ?", [id])?;
    Ok(())
}

pub fn set_enabled(conn: &Connection, id: i64, enabled: bool) -> Result<(), DbError> {
    conn.execute(
        "UPDATE McpServer SET enabled = ?, updated_at = ? WHERE id = ?",
        params![enabled as i64, now_ms(), id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn mem() -> Database {
        let mut db = Database::open_in_memory().unwrap();
        db.migrate().unwrap();
        db
    }

    #[test]
    fn crud_roundtrip_stdio_server() {
        let db = mem();
        let id = insert(
            db.conn(),
            &NewMcpServer {
                label: "fs".into(),
                transport: "stdio".into(),
                command: Some("npx".into()),
                args: Some(serde_json::json!([
                    "@modelcontextprotocol/server-filesystem"
                ])),
                env: Some(serde_json::json!({"PATH": "/usr/bin"})),
                url: None,
                headers: None,
                default_risk: "caution".into(),
                enabled: true,
            },
        )
        .unwrap();
        assert_eq!(id, 1);
        let row = get(db.conn(), id).unwrap().unwrap();
        assert_eq!(row.label, "fs");
        assert_eq!(row.transport, "stdio");
        assert_eq!(row.command.as_deref(), Some("npx"));
        assert!(row.enabled);
        assert_eq!(
            row.args.unwrap().as_array().unwrap()[0].as_str(),
            Some("@modelcontextprotocol/server-filesystem")
        );
    }

    #[test]
    fn crud_roundtrip_http_server() {
        let db = mem();
        let id = insert(
            db.conn(),
            &NewMcpServer {
                label: "grading".into(),
                transport: "http".into(),
                command: None,
                args: None,
                env: None,
                url: Some("https://grading.example.com/rpc".into()),
                headers: Some(serde_json::json!({"authorization": "Bearer X"})),
                default_risk: "safe".into(),
                enabled: true,
            },
        )
        .unwrap();
        let row = get(db.conn(), id).unwrap().unwrap();
        assert_eq!(row.transport, "http");
        assert_eq!(row.url.as_deref(), Some("https://grading.example.com/rpc"));
        assert_eq!(row.default_risk, "safe");
    }

    #[test]
    fn list_orders_by_id() {
        let db = mem();
        let new_a = NewMcpServer {
            label: "a".into(),
            command: Some("a".into()),
            ..Default::default()
        };
        let new_b = NewMcpServer {
            label: "b".into(),
            command: Some("b".into()),
            ..Default::default()
        };
        insert(db.conn(), &new_a).unwrap();
        insert(db.conn(), &new_b).unwrap();
        let rows = list(db.conn()).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].label, "a");
        assert_eq!(rows[1].label, "b");
    }

    #[test]
    fn duplicate_label_is_rejected() {
        let db = mem();
        let new1 = NewMcpServer {
            label: "same".into(),
            command: Some("x".into()),
            ..Default::default()
        };
        insert(db.conn(), &new1).unwrap();
        let new2 = NewMcpServer {
            label: "same".into(),
            command: Some("y".into()),
            ..Default::default()
        };
        let err = insert(db.conn(), &new2).unwrap_err();
        assert!(format!("{err}").to_lowercase().contains("unique"));
    }

    #[test]
    fn invalid_transport_fails_check() {
        let db = mem();
        let new_bad = NewMcpServer {
            label: "bad".into(),
            transport: "websocket".into(),
            ..Default::default()
        };
        let err = insert(db.conn(), &new_bad).unwrap_err();
        assert!(format!("{err}").to_lowercase().contains("check"));
    }

    #[test]
    fn invalid_default_risk_fails_check() {
        let db = mem();
        let new_bad = NewMcpServer {
            label: "bad".into(),
            default_risk: "unknown".into(),
            ..Default::default()
        };
        let err = insert(db.conn(), &new_bad).unwrap_err();
        assert!(format!("{err}").to_lowercase().contains("check"));
    }

    #[test]
    fn delete_and_set_enabled() {
        let db = mem();
        let n = NewMcpServer {
            label: "x".into(),
            command: Some("x".into()),
            ..Default::default()
        };
        let id = insert(db.conn(), &n).unwrap();
        set_enabled(db.conn(), id, false).unwrap();
        assert!(!get(db.conn(), id).unwrap().unwrap().enabled);
        delete(db.conn(), id).unwrap();
        assert!(get(db.conn(), id).unwrap().is_none());
    }
}
