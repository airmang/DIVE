//! Anonymized JSONL export. Spec §6.7 / §9.4.
//!
//! `ExportEngine::export_session` emits newline-delimited JSON for every
//! artifact tied to a session: session metadata, cards, messages, tool
//! calls, checkpoints, event log. Each line is a single record with a
//! `kind` discriminator so downstream analysis pipelines can filter by
//! type without a heavyweight schema.
//!
//! Anonymization:
//! - Every sensitive string (user message body, file paths, PII-shaped
//!   tool/event payloads) is replaced with a 16-character SHA-256 prefix
//!   when the corresponding `hash_*` option is on.
//! - Numeric session/card/message/tool/checkpoint/event IDs are hashed by
//!   default so classroom exports do not leak source database identifiers.
//! - Card retrospectives keep the raw text under the same `hash_user_text`
//!   contract, but also emit non-identifying `retrospective_metrics` so
//!   default anonymized exports remain useful for aggregate research.
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

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

use crate::db::Database;

pub mod anonymize;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    #[serde(default = "default_true")]
    pub include_messages: bool,
    #[serde(default = "default_true")]
    pub include_tool_calls: bool,
    #[serde(default = "default_true")]
    pub include_verify_logs: bool,
    #[serde(default = "default_true")]
    pub include_checkpoints: bool,
    #[serde(default = "default_true")]
    pub include_events: bool,
    #[serde(default = "default_true")]
    pub hash_user_text: bool,
    #[serde(default = "default_true")]
    pub hash_file_paths: bool,
    #[serde(default = "default_true")]
    pub hash_ids: bool,
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
            hash_ids: true,
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
                "session_id": anonymize::maybe_hash_id(options.hash_ids, "session", session_id, salt),
                "title": anonymize::maybe_hash_text(options.hash_user_text, &title, salt),
                "status": status,
                "started_at": started_at,
                "ended_at": ended_at,
            }),
        )?;

        let mut stmt = conn
            .prepare(
                "SELECT id, title, instruction, state, verify_log, changed_files, position, created_at, updated_at, retrospective, change_summary FROM Card WHERE session_id = ? ORDER BY position, id"
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
                    retrospective: row.get::<_, Option<String>>(9)?,
                    change_summary: row.get::<_, Option<String>>(10)?,
                })
            })
            .map_err(|e| ExportError::Db(e.to_string()))?;
        for row in rows {
            let c = row.map_err(|e| ExportError::Db(e.to_string()))?;
            let verify_log_json = if options.include_verify_logs {
                c.verify_log.as_ref().and_then(|s| {
                    serde_json::from_str::<Value>(s).ok().map(|value| {
                        anonymize::anonymize_value(
                            &value,
                            options.hash_user_text,
                            options.hash_file_paths,
                            salt,
                        )
                    })
                })
            } else {
                None
            };
            let changed_files_json = c
                .changed_files
                .as_ref()
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            let changed_files_emit = match changed_files_json {
                Some(v) => anonymize::anonymize_value(
                    &v,
                    options.hash_user_text,
                    options.hash_file_paths,
                    salt,
                ),
                None => Value::Null,
            };
            write_record(
                &mut out,
                json!({
                    "kind": "card",
                    "id": anonymize::maybe_hash_id(options.hash_ids, "card", c.id, salt),
                    "title": anonymize::maybe_hash_text(options.hash_user_text, &c.title, salt),
                    "instruction": c.instruction.as_ref().map(|s| anonymize::maybe_hash_text(options.hash_user_text, s, salt)),
                    "state": c.state,
                    "verify_log": verify_log_json,
                    "changed_files": changed_files_emit,
                    "retrospective": c.retrospective.as_ref().map(|s| anonymize::maybe_hash_text(options.hash_user_text, s, salt)),
                    "retrospective_metrics": c.retrospective.as_ref().map(|s| retrospective_metrics(s)),
                    "change_summary": c.change_summary.as_ref().map(|s| anonymize::maybe_hash_text(options.hash_user_text, s, salt)),
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
                    anonymize::maybe_hash_text(true, &m.content, salt)
                } else {
                    Value::String(m.content.clone())
                };
                let tool_calls_emit = m.tool_calls.and_then(|s| {
                    serde_json::from_str::<Value>(&s).ok().map(|value| {
                        anonymize::anonymize_value(
                            &value,
                            options.hash_user_text,
                            options.hash_file_paths,
                            salt,
                        )
                    })
                });
                write_record(
                    &mut out,
                    json!({
                        "kind": "message",
                        "id": anonymize::maybe_hash_id(options.hash_ids, "message", m.id, salt),
                        "card_id": m.card_id.map(|id| anonymize::maybe_hash_id(options.hash_ids, "card", id, salt)),
                        "role": m.role,
                        "content": content_emit,
                        "tool_calls": tool_calls_emit,
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
                        "id": anonymize::maybe_hash_id(options.hash_ids, "tool_call", t.id, salt),
                        "message_id": anonymize::maybe_hash_id(options.hash_ids, "message", t.message_id, salt),
                        "name": t.name,
                        "input": anonymize::anonymize_value(&input_json, options.hash_user_text, options.hash_file_paths, salt),
                        "output": anonymize::anonymize_value(&output_json, options.hash_user_text, options.hash_file_paths, salt),
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
                        "id": anonymize::maybe_hash_id(options.hash_ids, "checkpoint", id, salt),
                        "card_id": card_id.map(|id| anonymize::maybe_hash_id(options.hash_ids, "card", id, salt)),
                        "git_sha": git_sha,
                        "kind_label": kind,
                        "label": label.as_ref().map(|s| anonymize::maybe_hash_text(options.hash_user_text, s, salt)),
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
                let payload_json = serde_json::from_str::<Value>(&payload)
                    .map(|value| {
                        anonymize::anonymize_value(
                            &value,
                            options.hash_user_text,
                            options.hash_file_paths,
                            salt,
                        )
                    })
                    .unwrap_or(Value::Null);
                write_record(
                    &mut out,
                    json!({
                        "kind": "event",
                        "id": anonymize::maybe_hash_id(options.hash_ids, "event", id, salt),
                        "type": ty,
                        "payload": payload_json,
                        "created_at": created_at,
                    }),
                )?;
            }
        }

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

fn retrospective_metrics(text: &str) -> Value {
    let lower = text.to_lowercase();
    let positive_count = count_terms(
        &lower,
        &["이해", "성공", "쉽", "도움", "검증", "완성", "명확", "좋"],
    );
    let negative_count = count_terms(
        &lower,
        &[
            "어렵", "헷갈", "실패", "오류", "막힘", "불안", "느림", "복잡",
        ],
    );
    let sentiment_bucket = if positive_count > negative_count {
        "positive"
    } else if negative_count > positive_count {
        "negative"
    } else {
        "neutral"
    };
    json!({
        "schema_version": 1,
        "char_count": text.chars().count(),
        "word_count": text.split_whitespace().filter(|token| !token.is_empty()).count(),
        "line_count": text.lines().filter(|line| !line.trim().is_empty()).count().max(1),
        "question_count": text.chars().filter(|ch| matches!(ch, '?' | '？')).count(),
        "sentiment_bucket": sentiment_bucket,
        "mentions_verification": contains_any(&lower, &["검증", "테스트", "확인", "통과", "test", "lint", "typecheck", "cargo", "pnpm"]),
        "mentions_error": contains_any(&lower, &["오류", "에러", "실패", "막힘", "error", "fail", "failed"]),
        "mentions_next_step": contains_any(&lower, &["다음", "개선", "추가", "나중", "next", "improve", "todo"]),
    })
}

fn count_terms(text: &str, terms: &[&str]) -> usize {
    terms.iter().filter(|term| text.contains(**term)).count()
}

fn contains_any(text: &str, terms: &[&str]) -> bool {
    terms.iter().any(|term| text.contains(term))
}

#[derive(Debug)]
struct CardEmit {
    id: i64,
    title: String,
    instruction: Option<String>,
    state: String,
    verify_log: Option<String>,
    changed_files: Option<String>,
    retrospective: Option<String>,
    change_summary: Option<String>,
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
    fn default_options_enable_everything() {
        let o = ExportOptions::default();
        assert!(o.include_messages);
        assert!(o.include_tool_calls);
        assert!(o.include_verify_logs);
        assert!(o.include_checkpoints);
        assert!(o.include_events);
        assert!(o.hash_user_text);
        assert!(o.hash_file_paths);
        assert!(o.hash_ids);
    }
}
