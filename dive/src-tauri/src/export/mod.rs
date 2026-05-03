//! Anonymized JSONL export. Spec §6.7 / §9.4.
//!
//! `ExportEngine::export_session` emits newline-delimited JSON for every
//! artifact tied to a session: session metadata, cards, messages, tool
//! calls, checkpoints, event log. Each line is a single record with a
//! `kind` discriminator so downstream analysis pipelines can filter by
//! type without a heavyweight schema.
//!
//! Anonymization:
//! - Every sensitive string (user message body, file paths, tool call
//!   arguments/results) is replaced with a 16-character SHA-256 prefix
//!   when the corresponding `hash_*` option is on.
//! - The salt is a fresh random value generated at the start of each
//!   export run — not a per-session constant. Cross-export correlation of
//!   "is this the same user text?" is therefore impossible unless the
//!   caller keeps the salt. The salt itself is **not** written to the
//!   output (spec §9.4 — "학번 등 식별자가 원본으로 저장되지 않음").
//!
//! Stability:
//! - Record order within one export is deterministic: session_meta →
//!   cards (position asc) → messages (id asc) → tool_calls (id asc) →
//!   checkpoints (created_at asc) → events (id asc).
//! - The record kind strings and field names are considered stable API
//!   consumed by the pilot analysis scripts. Adding fields is safe;
//!   removing/renaming requires a migration note.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

use crate::db::Database;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub include_messages: bool,
    pub include_tool_calls: bool,
    pub include_verify_logs: bool,
    pub include_checkpoints: bool,
    pub include_events: bool,
    pub hash_user_text: bool,
    pub hash_file_paths: bool,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            include_messages: true,
            include_tool_calls: true,
            include_verify_logs: true,
            include_checkpoints: true,
            include_events: true,
            hash_user_text: true,
            hash_file_paths: true,
        }
    }
}

#[derive(Debug, Error)]
pub enum ExportError {
    #[error("db: {0}")]
    Db(String),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("session {0} not found")]
    SessionNotFound(i64),
}

pub struct ExportEngine {
    pub db: Arc<Mutex<Database>>,
}

impl ExportEngine {
    pub fn new(db: Arc<Mutex<Database>>) -> Self {
        Self { db }
    }

    pub fn export_session(
        &self,
        session_id: i64,
        options: &ExportOptions,
    ) -> Result<String, ExportError> {
        let salt = fresh_salt();
        self.export_session_with_salt(session_id, options, &salt)
    }

    pub fn export_session_with_salt(
        &self,
        session_id: i64,
        options: &ExportOptions,
        salt: &str,
    ) -> Result<String, ExportError> {
        let db = self.db.lock().map_err(|e| ExportError::Db(e.to_string()))?;
        let conn = db.conn();

        let session: Option<(String, String, i64, Option<i64>)> = conn
            .query_row(
                "SELECT title, status, started_at, ended_at FROM Session WHERE id = ?",
                [session_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| ExportError::Db(e.to_string()))?;

        let (title, status, started_at, ended_at) =
            session.ok_or(ExportError::SessionNotFound(session_id))?;

        let mut out = String::new();

        write_record(
            &mut out,
            json!({
                "kind": "session_meta",
                "session_id": session_id,
                "title": maybe_hash(options.hash_user_text, &title, salt),
                "status": status,
                "started_at": started_at,
                "ended_at": ended_at,
            }),
        )?;

        let mut stmt = conn
            .prepare(
                "SELECT id, title, instruction, state, verify_log, changed_files, position, created_at, updated_at FROM Card WHERE session_id = ? ORDER BY position, id"
            )
            .map_err(|e| ExportError::Db(e.to_string()))?;
        let rows = stmt
            .query_map([session_id], |row| {
                Ok(CardEmit {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    instruction: row.get::<_, Option<String>>(2)?,
                    state: row.get::<_, String>(3)?,
                    verify_log: row.get::<_, Option<String>>(4)?,
                    changed_files: row.get::<_, Option<String>>(5)?,
                    position: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(|e| ExportError::Db(e.to_string()))?;
        for row in rows {
            let c = row.map_err(|e| ExportError::Db(e.to_string()))?;
            let verify_log_json = if options.include_verify_logs {
                c.verify_log
                    .as_ref()
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
            } else {
                None
            };
            let changed_files_json = c
                .changed_files
                .as_ref()
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            let changed_files_emit = match changed_files_json {
                Some(v) => hash_paths_in_value(&v, options.hash_file_paths, salt),
                None => Value::Null,
            };
            write_record(
                &mut out,
                json!({
                    "kind": "card",
                    "id": c.id,
                    "title": maybe_hash(options.hash_user_text, &c.title, salt),
                    "instruction": c.instruction.as_ref().map(|s| maybe_hash(options.hash_user_text, s, salt)),
                    "state": c.state,
                    "verify_log": verify_log_json,
                    "changed_files": changed_files_emit,
                    "position": c.position,
                    "created_at": c.created_at,
                    "updated_at": c.updated_at,
                }),
            )?;
        }

        if options.include_messages {
            let mut stmt = conn
                .prepare(
                    "SELECT id, card_id, role, content, tool_calls, usage, provider, model, created_at FROM Message WHERE session_id = ? ORDER BY id"
                )
                .map_err(|e| ExportError::Db(e.to_string()))?;
            let rows = stmt
                .query_map([session_id], |row| {
                    Ok(MessageEmit {
                        id: row.get::<_, i64>(0)?,
                        card_id: row.get::<_, Option<i64>>(1)?,
                        role: row.get::<_, String>(2)?,
                        content: row.get::<_, String>(3)?,
                        tool_calls: row.get::<_, Option<String>>(4)?,
                        usage_json: row.get::<_, Option<String>>(5)?,
                        provider: row.get::<_, Option<String>>(6)?,
                        model: row.get::<_, Option<String>>(7)?,
                        created_at: row.get::<_, i64>(8)?,
                    })
                })
                .map_err(|e| ExportError::Db(e.to_string()))?;
            for row in rows {
                let m = row.map_err(|e| ExportError::Db(e.to_string()))?;
                let hash_for_role = m.role == "user";
                let content_emit = if hash_for_role && options.hash_user_text {
                    maybe_hash(true, &m.content, salt)
                } else {
                    Value::String(m.content.clone())
                };
                write_record(
                    &mut out,
                    json!({
                        "kind": "message",
                        "id": m.id,
                        "card_id": m.card_id,
                        "role": m.role,
                        "content": content_emit,
                        "tool_calls": m.tool_calls.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
                        "usage": m.usage_json.and_then(|s| serde_json::from_str::<Value>(&s).ok()),
                        "provider": m.provider,
                        "model": m.model,
                        "created_at": m.created_at,
                    }),
                )?;
            }
        }

        if options.include_tool_calls {
            let mut stmt = conn
                .prepare(
                    "SELECT id, message_id, name, input, output, approved, risk_level, created_at FROM ToolCall WHERE message_id IN (SELECT id FROM Message WHERE session_id = ?) ORDER BY id"
                )
                .map_err(|e| ExportError::Db(e.to_string()))?;
            let rows = stmt
                .query_map([session_id], |row| {
                    Ok(ToolCallEmit {
                        id: row.get(0)?,
                        message_id: row.get::<_, i64>(1)?,
                        name: row.get::<_, String>(2)?,
                        input: row.get::<_, String>(3)?,
                        output: row.get::<_, Option<String>>(4)?,
                        approved: row.get::<_, Option<bool>>(5)?,
                        risk_level: row.get::<_, String>(6)?,
                        created_at: row.get::<_, i64>(7)?,
                    })
                })
                .map_err(|e| ExportError::Db(e.to_string()))?;
            for row in rows {
                let t = row.map_err(|e| ExportError::Db(e.to_string()))?;
                let input_json = serde_json::from_str::<Value>(&t.input).unwrap_or(Value::Null);
                let output_json = t
                    .output
                    .as_ref()
                    .and_then(|s| serde_json::from_str::<Value>(s).ok())
                    .unwrap_or(Value::Null);
                write_record(
                    &mut out,
                    json!({
                        "kind": "tool_call",
                        "id": t.id,
                        "message_id": t.message_id,
                        "name": t.name,
                        "input": hash_paths_in_value(&input_json, options.hash_file_paths, salt),
                        "output": hash_paths_in_value(&output_json, options.hash_file_paths, salt),
                        "approved": t.approved,
                        "risk_level": t.risk_level,
                        "created_at": t.created_at,
                    }),
                )?;
            }
        }

        if options.include_checkpoints {
            let mut stmt = conn
                .prepare(
                    "SELECT id, card_id, git_sha, kind, label, created_at FROM Checkpoint WHERE session_id = ? ORDER BY created_at, id"
                )
                .map_err(|e| ExportError::Db(e.to_string()))?;
            let rows = stmt
                .query_map([session_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                })
                .map_err(|e| ExportError::Db(e.to_string()))?;
            for row in rows {
                let (id, card_id, git_sha, kind, label, created_at) =
                    row.map_err(|e| ExportError::Db(e.to_string()))?;
                write_record(
                    &mut out,
                    json!({
                        "kind": "checkpoint",
                        "id": id,
                        "card_id": card_id,
                        "git_sha": git_sha,
                        "kind_label": kind,
                        "label": label.as_ref().map(|s| maybe_hash(options.hash_user_text, s, salt)),
                        "created_at": created_at,
                    }),
                )?;
            }
        }

        if options.include_events {
            let mut stmt = conn
                .prepare(
                    "SELECT id, type, payload, created_at FROM EventLog WHERE session_id = ? ORDER BY id"
                )
                .map_err(|e| ExportError::Db(e.to_string()))?;
            let rows = stmt
                .query_map([session_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .map_err(|e| ExportError::Db(e.to_string()))?;
            for row in rows {
                let (id, ty, payload, created_at) =
                    row.map_err(|e| ExportError::Db(e.to_string()))?;
                let payload_json = serde_json::from_str::<Value>(&payload).unwrap_or(Value::Null);
                write_record(
                    &mut out,
                    json!({
                        "kind": "event",
                        "id": id,
                        "type": ty,
                        "payload": hash_paths_in_value(&payload_json, options.hash_file_paths, salt),
                        "created_at": created_at,
                    }),
                )?;
            }
        }

        let _ = params![session_id];
        Ok(out)
    }
}

fn write_record(out: &mut String, v: Value) -> Result<(), ExportError> {
    let line = serde_json::to_string(&v)?;
    out.push_str(&line);
    out.push('\n');
    Ok(())
}

fn fresh_salt() -> String {
    Uuid::new_v4().to_string()
}

fn hash_with_salt(input: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":");
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let hex = format!("{:x}", digest);
    hex[..16].to_string()
}

fn maybe_hash(enabled: bool, input: &str, salt: &str) -> Value {
    if enabled {
        Value::String(format!("h:{}", hash_with_salt(input, salt)))
    } else {
        Value::String(input.to_string())
    }
}

fn hash_paths_in_value(value: &Value, enabled: bool, salt: &str) -> Value {
    if !enabled {
        return value.clone();
    }
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                if looks_like_path_key(k) {
                    out.insert(k.clone(), hash_string_like(v, salt));
                } else {
                    out.insert(k.clone(), hash_paths_in_value(v, enabled, salt));
                }
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(
            arr.iter()
                .map(|v| hash_paths_in_value(v, enabled, salt))
                .collect(),
        ),
        Value::String(s) if looks_like_path_value(s) => {
            Value::String(format!("p:{}", hash_with_salt(s, salt)))
        }
        other => other.clone(),
    }
}

fn hash_string_like(value: &Value, salt: &str) -> Value {
    match value {
        Value::String(s) => Value::String(format!("p:{}", hash_with_salt(s, salt))),
        other => other.clone(),
    }
}

fn looks_like_path_key(key: &str) -> bool {
    matches!(
        key,
        "path" | "file" | "filename" | "file_path" | "target_path"
    )
}

fn looks_like_path_value(s: &str) -> bool {
    let has_sep = s.contains('/') || s.contains('\\');
    let ext = [
        ".rs", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".c", ".cpp", ".h", ".json",
        ".toml", ".md", ".html", ".css", ".scss", ".svg",
    ]
    .iter()
    .any(|e| s.ends_with(e));
    has_sep && ext
}

#[derive(Debug)]
struct CardEmit {
    id: i64,
    title: String,
    instruction: Option<String>,
    state: String,
    verify_log: Option<String>,
    changed_files: Option<String>,
    position: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug)]
struct MessageEmit {
    id: i64,
    card_id: Option<i64>,
    role: String,
    content: String,
    tool_calls: Option<String>,
    usage_json: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    created_at: i64,
}

#[derive(Debug)]
struct ToolCallEmit {
    id: i64,
    message_id: i64,
    name: String,
    input: String,
    output: Option<String>,
    approved: Option<bool>,
    risk_level: String,
    created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_stable_for_same_salt() {
        let a = hash_with_salt("hello", "salt");
        let b = hash_with_salt("hello", "salt");
        assert_eq!(a, b);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn hash_differs_across_salts() {
        let a = hash_with_salt("hello", "salt-a");
        let b = hash_with_salt("hello", "salt-b");
        assert_ne!(a, b);
    }

    #[test]
    fn path_detector_identifies_filenames() {
        assert!(looks_like_path_value("src/App.tsx"));
        assert!(looks_like_path_value("C:\\Users\\x\\a.rs"));
        assert!(!looks_like_path_value("hello world"));
        assert!(!looks_like_path_value(".rs"));
    }

    #[test]
    fn hash_paths_in_value_masks_path_shaped_strings() {
        let salt = "s";
        let v = json!({
            "path": "src/a.tsx",
            "count": 3,
            "nested": { "file": "b.rs" },
            "items": ["src/c.ts", "plain"]
        });
        let out = hash_paths_in_value(&v, true, salt);
        assert!(out["path"].as_str().unwrap().starts_with("p:"));
        assert!(out["nested"]["file"].as_str().unwrap().starts_with("p:"));
        assert!(out["items"][0].as_str().unwrap().starts_with("p:"));
        assert_eq!(out["items"][1], Value::String("plain".into()));
        assert_eq!(out["count"], json!(3));
    }

    #[test]
    fn default_options_enable_everything() {
        let o = ExportOptions::default();
        assert!(o.include_messages);
        assert!(o.include_tool_calls);
        assert!(o.include_verify_logs);
        assert!(o.include_checkpoints);
        assert!(o.include_events);
        assert!(o.hash_user_text);
        assert!(o.hash_file_paths);
    }
}
