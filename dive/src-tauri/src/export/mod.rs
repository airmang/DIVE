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

use regex::Regex;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

use crate::db::Database;

pub mod anonymize;

static EXPORT_SECRET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)
        sk-[A-Za-z0-9_\-]{3,}
        |(?:api[_-]?key|token|secret|authorization|password)\s*[:=]\s*[A-Za-z0-9_\-\.]{4,}
        |bearer\s+[A-Za-z0-9_\-\.]{4,}
        ",
    )
    .expect("export secret redaction regex")
});

static EXPORT_EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b")
        .expect("export email redaction regex")
});

static EXPORT_ACCOUNT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:student|account)[-_ ]?(?:id|no|number)\s*[:=]\s*[A-Za-z0-9_\-]{3,}\b")
        .expect("export account redaction regex")
});

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
                "SELECT id, title, instruction, state, verify_log, changed_files, position, created_at, updated_at, retrospective, change_summary, approval_judgment, approval_provenance FROM Card WHERE session_id = ? ORDER BY position, id"
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
                    approval_judgment: row.get::<_, Option<String>>(11)?,
                    approval_provenance: row.get::<_, Option<String>>(12)?,
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
                    "approval_judgment": c.approval_judgment.as_ref().and_then(|s| approval_judgment_emit(s, options.hash_user_text, salt)),
                    "approval_judgment_metrics": c.approval_judgment.as_ref().and_then(|s| approval_judgment_metrics(s)),
                    "approval_provenance": c.approval_provenance.as_ref().and_then(|s| approval_provenance_emit(s, options.hash_user_text, salt)),
                    "verification_evidence_summary": c.approval_provenance.as_ref().and_then(|s| verification_evidence_summary_emit(s)),
                    "agency": card_agency_emit(&c),
                    "change_summary": c.change_summary.as_ref().map(|s| anonymize::maybe_hash_text(options.hash_user_text, s, salt)),
                    "position": c.position,
                    "created_at": c.created_at,
                    "updated_at": c.updated_at,
                }),
            )?;
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, step_id, card_id, state_path, status, completed_at, checkpoint_ids, verification_status, verification_evidence, user_decision, created_at, updated_at FROM StepSessionMapping WHERE session_id = ? ORDER BY id",
            )
            .map_err(|e| ExportError::Db(e.to_string()))?;
        let rows = stmt
            .query_map([session_id], |row| {
                Ok(StepMappingEmit {
                    id: row.get(0)?,
                    step_id: row.get(1)?,
                    card_id: row.get::<_, Option<i64>>(2)?,
                    state_path: row.get::<_, Option<String>>(3)?,
                    status: row.get(4)?,
                    completed_at: row.get::<_, Option<i64>>(5)?,
                    checkpoint_ids: row.get::<_, Option<String>>(6)?,
                    verification_status: row.get::<_, Option<String>>(7)?,
                    verification_evidence: row.get::<_, Option<String>>(8)?,
                    user_decision: row.get::<_, Option<String>>(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .map_err(|e| ExportError::Db(e.to_string()))?;
        for row in rows {
            let mapping = row.map_err(|e| ExportError::Db(e.to_string()))?;
            write_record(
                &mut out,
                json!({
                    "kind": "step_session_mapping",
                    "id": anonymize::maybe_hash_id(options.hash_ids, "step_session_mapping", mapping.id, salt),
                    "step_id": anonymize::maybe_hash_id(options.hash_ids, "step", mapping.step_id, salt),
                    "card_id": mapping.card_id.map(|id| anonymize::maybe_hash_id(options.hash_ids, "card", id, salt)),
                    "state_path": mapping.state_path.as_ref().map(|s| anonymize::maybe_hash_text(options.hash_user_text, s, salt)),
                    "status": mapping.status,
                    "completed_at": mapping.completed_at,
                    "checkpoint_count": checkpoint_count(&mapping.checkpoint_ids),
                    "rollback_available": checkpoint_count(&mapping.checkpoint_ids) > 0,
                    "verification_status": mapping.verification_status,
                    "verification_evidence": mapping.verification_evidence.as_ref().and_then(|s| {
                        serde_json::from_str::<Value>(s).ok().map(|value| {
                            anonymize::anonymize_value(
                                &value,
                                options.hash_user_text,
                                options.hash_file_paths,
                                salt,
                            )
                        })
                    }),
                    "user_decision": mapping.user_decision.as_ref().and_then(|s| {
                        serde_json::from_str::<Value>(s).ok().map(|value| {
                            anonymize::anonymize_value(
                                &value,
                                options.hash_user_text,
                                options.hash_file_paths,
                                salt,
                            )
                        })
                    }),
                    "agency": step_mapping_agency_emit(&mapping),
                    "created_at": mapping.created_at,
                    "updated_at": mapping.updated_at,
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
                let content_emit = if options.hash_user_text {
                    anonymize::maybe_hash_text(true, &m.content, salt)
                } else if options.hash_file_paths && anonymize::looks_like_path_value(&m.content) {
                    anonymize::hash_path(&m.content, salt)
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
                        "agency": {
                            "component": "rollback",
                            "state": "rollback_available",
                            "rollbackAvailable": true,
                        },
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
                        let value = crate::dive::event_log::enrich_agency_payload(&ty, value);
                        let value = if ty.starts_with("provocation.") {
                            sanitize_provocation_event_payload(&value)
                        } else if ty.starts_with("verification_coach.")
                            || ty.starts_with("verification_observation.")
                        {
                            sanitize_verification_coach_event_payload(&value)
                        } else if is_runtime_008_event_type(&ty) {
                            sanitize_runtime_event_payload(&value)
                        } else {
                            value
                        };
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

fn approval_judgment_emit(raw: &str, hash_user_text: bool, salt: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let outcome = v.get("outcome").and_then(|x| x.as_str())?;
    let note = v.get("note").and_then(|x| x.as_str());
    Some(json!({
        "outcome": outcome,
        "note": note.map(|n| anonymize::maybe_hash_text(hash_user_text, n, salt)),
        "decided_at": v.get("decided_at").and_then(|x| x.as_i64()),
    }))
}

fn approval_judgment_metrics(raw: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let outcome = v.get("outcome").and_then(|x| x.as_str())?;
    let note = v.get("note").and_then(|x| x.as_str()).unwrap_or("");
    Some(json!({
        "schema_version": 1,
        "outcome": outcome,
        "note_char_count": note.chars().count(),
        "note_word_count": note.split_whitespace().filter(|t| !t.is_empty()).count(),
        "has_note": !note.trim().is_empty(),
    }))
}

fn approval_provenance_emit(raw: &str, hash_user_text: bool, salt: &str) -> Option<Value> {
    let mut v: Value = serde_json::from_str(raw).ok()?;
    if let Some(reason) = v.get("riskReason").and_then(Value::as_str) {
        v["riskReason"] = anonymize::maybe_hash_text(hash_user_text, reason, salt);
    }
    Some(v)
}

fn verification_evidence_summary_emit(raw: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(raw).ok()?;
    v.get("evidenceSummary").cloned()
}

fn card_agency_emit(card: &CardEmit) -> Option<Value> {
    if let Some(provenance) = card
        .approval_provenance
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
    {
        let verification_state = provenance.get("verificationState").and_then(Value::as_str);
        return Some(json!({
            "component": "decision",
            "state": verification_state.and_then(agency_state_from_verification_state),
            "verificationState": verification_state,
            "riskAccepted": provenance.get("riskAccepted").and_then(Value::as_bool).unwrap_or(false),
            "evidenceSummary": provenance.get("evidenceSummary").cloned().unwrap_or(Value::Null),
        }));
    }

    if let Some(verify_log) = card
        .verify_log
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
    {
        let test_result = verify_log.get("test_result").and_then(Value::as_str);
        return Some(json!({
            "component": "verify",
            "state": agency_state_from_test_result(test_result),
            "testResult": test_result,
            "aiSelfReport": verify_log.get("intent_match").and_then(Value::as_bool).unwrap_or(false),
        }));
    }

    if card
        .changed_files
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| value.as_array().map(|items| !items.is_empty()))
        .unwrap_or(false)
    {
        return Some(json!({
            "component": "diff",
            "state": "diff_review_needed",
        }));
    }

    None
}

fn step_mapping_agency_emit(mapping: &StepMappingEmit) -> Option<Value> {
    let rollback_available = checkpoint_count(&mapping.checkpoint_ids) > 0;
    let verification_state = mapping.verification_status.as_deref();
    if verification_state.is_none() && !rollback_available {
        return None;
    }
    let state = verification_state
        .and_then(agency_state_from_verification_state)
        .or_else(|| rollback_available.then_some("rollback_available"));
    Some(json!({
        "component": if verification_state.is_some() { "decision" } else { "rollback" },
        "state": state,
        "verificationState": verification_state,
        "rollbackAvailable": rollback_available,
    }))
}

fn checkpoint_count(raw: &Option<String>) -> usize {
    raw.as_deref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .and_then(|value| value.as_array().map(Vec::len))
        .unwrap_or(0)
}

fn agency_state_from_verification_state(state: &str) -> Option<&'static str> {
    match state {
        "verified_with_evidence" => Some("verified_with_evidence"),
        "unverified_risk_accepted" => Some("approved_with_risk"),
        "failed_but_accepted" => Some("verification_failed"),
        "verification_deferred" => Some("verification_deferred"),
        _ => None,
    }
}

fn agency_state_from_test_result(test_result: Option<&str>) -> Option<&'static str> {
    match test_result {
        Some("pass") => Some("verified_with_evidence"),
        Some("fail") => Some("verification_failed"),
        Some("skipped") => Some("ai_self_report_only"),
        _ => Some("verification_needed"),
    }
}

pub(crate) fn sanitize_provocation_event_payload(value: &Value) -> Value {
    sanitize_provocation_nested(value, None)
}

pub(crate) fn sanitize_verification_coach_event_payload(value: &Value) -> Value {
    sanitize_provocation_nested(value, None)
}

pub(crate) fn sanitize_runtime_event_payload(value: &Value) -> Value {
    sanitize_runtime_nested(value, None)
}

fn is_runtime_008_event_type(ty: &str) -> bool {
    matches!(
        ty,
        crate::dive::event_log::RUNTIME_ROUTING_DECISION_EVENT
            | crate::dive::event_log::PREVIEW_OPEN_REQUESTED_EVENT
            | crate::dive::event_log::PREVIEW_OPEN_RESULT_EVENT
            | crate::dive::event_log::PROJECT_COMMAND_RESULT_EVENT
            | crate::dive::event_log::TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT
            | crate::dive::event_log::TERMINAL_SCRIPT_RESULT_EVENT
            | crate::dive::event_log::TOOL_APPROVAL_STALE_EVENT
    )
}

fn sanitize_runtime_nested(value: &Value, key: Option<&str>) -> Value {
    if key.is_some_and(is_runtime_raw_body_key) {
        return raw_text_summary(value, "runtime_raw_body");
    }
    if key.is_some_and(is_student_pii_key) {
        return pii_summary(value);
    }

    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (nested_key, nested) in map {
                out.insert(
                    nested_key.clone(),
                    sanitize_runtime_nested(nested, Some(nested_key)),
                );
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| sanitize_runtime_nested(item, None))
                .collect(),
        ),
        Value::String(text) => Value::String(redact_export_string(text)),
        other => other.clone(),
    }
}

fn is_runtime_raw_body_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
    matches!(
        normalized.as_str(),
        "script"
            | "scriptbody"
            | "scripttext"
            | "scriptpreview"
            | "scriptsummary"
            | "stdout"
            | "stdoutsummary"
            | "stderr"
            | "stderrsummary"
            | "terminaloutput"
            | "terminalsummary"
            | "rawoutput"
            | "fulloutput"
    )
}

fn sanitize_provocation_nested(value: &Value, key: Option<&str>) -> Value {
    if key.is_some_and(is_raw_body_key) {
        return raw_text_summary(value, "raw_body_key");
    }
    if key.is_some_and(is_student_pii_key) {
        return pii_summary(value);
    }
    if key.is_some_and(is_evidence_value_key)
        && !matches!(value, Value::Object(_))
        && is_sensitive_evidence_value(value)
    {
        return raw_text_summary(value, "evidence_value_summary");
    }

    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (nested_key, nested) in map {
                out.insert(
                    nested_key.clone(),
                    sanitize_provocation_nested(nested, Some(nested_key)),
                );
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| sanitize_provocation_nested(item, None))
                .collect(),
        ),
        Value::String(text) => Value::String(redact_export_string(text)),
        other => other.clone(),
    }
}

fn is_raw_body_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    matches!(
        key.as_str(),
        "prompt"
            | "promptbody"
            | "prompt_body"
            | "transcript"
            | "transcriptbody"
            | "transcript_body"
            | "sourcecode"
            | "source_code"
            | "code"
            | "rawcode"
            | "raw_code"
            | "raw"
            | "rawtext"
            | "raw_text"
            | "rawdiff"
            | "raw_diff"
            | "terminaloutput"
            | "terminal_output"
            | "terminal"
            | "fulldiff"
            | "full_diff"
            | "fulltranscript"
            | "full_transcript"
    )
}

fn is_evidence_value_key(key: &str) -> bool {
    matches!(
        key,
        "value"
            | "valueSummary"
            | "value_summary"
            | "rawValue"
            | "raw_value"
            | "terminalSummary"
            | "terminal_summary"
    )
}

fn is_student_pii_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
    normalized.contains("studentemail")
        || normalized.contains("studentname")
        || normalized.contains("studentaccount")
        || normalized.contains("accountidentifier")
        || normalized.contains("accountid")
}

fn is_sensitive_evidence_value(value: &Value) -> bool {
    match value {
        Value::String(text) => {
            text.chars().count() > 96
                || text.lines().count() > 1
                || looks_code_like(text)
                || contains_export_secret_or_pii(text)
        }
        Value::Object(map) => map.values().any(is_sensitive_evidence_value),
        Value::Array(items) => items.iter().any(is_sensitive_evidence_value),
        _ => false,
    }
}

fn looks_code_like(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("```")
        || lower.contains("function ")
        || lower.contains("const ")
        || lower.contains("import ")
        || lower.contains("export ")
        || lower.contains("class ")
        || lower.contains("pub fn")
        || lower.contains("fn ")
        || text.trim_end().ends_with(';')
        || (text.contains('{') && text.contains('}'))
}

fn raw_text_summary(value: &Value, reason: &str) -> Value {
    match value {
        Value::String(text) => {
            let non_empty_lines = text.lines().filter(|line| !line.trim().is_empty()).count();
            json!({
                "redacted": true,
                "reason": reason,
                "char_count": text.chars().count(),
                "line_count": non_empty_lines.max(1),
                "word_count": text.split_whitespace().filter(|token| !token.is_empty()).count(),
            })
        }
        Value::Array(items) => json!({
            "redacted": true,
            "reason": reason,
            "item_count": items.len(),
        }),
        Value::Object(map) => json!({
            "redacted": true,
            "reason": reason,
            "field_count": map.len(),
        }),
        other => other.clone(),
    }
}

fn pii_summary(value: &Value) -> Value {
    match value {
        Value::String(text) => json!({
            "redacted": true,
            "reason": "student_pii",
            "char_count": text.chars().count(),
        }),
        Value::Array(items) => json!({
            "redacted": true,
            "reason": "student_pii",
            "item_count": items.len(),
        }),
        Value::Object(map) => json!({
            "redacted": true,
            "reason": "student_pii",
            "field_count": map.len(),
        }),
        other => other.clone(),
    }
}

fn contains_export_secret_or_pii(text: &str) -> bool {
    EXPORT_SECRET_RE.is_match(text)
        || EXPORT_EMAIL_RE.is_match(text)
        || EXPORT_ACCOUNT_RE.is_match(text)
}

fn redact_export_string(text: &str) -> String {
    let redacted = EXPORT_SECRET_RE.replace_all(text, "[REDACTED_SECRET]");
    let redacted = EXPORT_EMAIL_RE.replace_all(&redacted, "[REDACTED_PII]");
    let redacted = EXPORT_ACCOUNT_RE.replace_all(&redacted, "[REDACTED_PII]");
    redacted.to_string()
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
    approval_judgment: Option<String>,
    approval_provenance: Option<String>,
    position: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug)]
struct StepMappingEmit {
    id: i64,
    step_id: i64,
    card_id: Option<i64>,
    state_path: Option<String>,
    status: String,
    completed_at: Option<i64>,
    checkpoint_ids: Option<String>,
    verification_status: Option<String>,
    verification_evidence: Option<String>,
    user_decision: Option<String>,
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
    use serde_json::json;

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

    #[test]
    fn supervisor_evaluation_payload_sanitizer_redacts_raw_fields() {
        let payload = json!({
            "schemaVersion": 1,
            "event": "verify_entered",
            "artifactRef": {
                "kind": "step",
                "id": "step-3",
                "label": "Add todo item form"
            },
            "contextHash": "sha256:context",
            "evidenceHash": "sha256:evidence",
            "mode": "work",
            "validationOutcome": "shown",
            "dropReason": null,
            "cardId": "provocation:step-3:ai_self_report_only:sha256:evidence",
            "supervisorEvaluationId": "eval-1",
            "decisionSummary": {
                "provoke": true,
                "concern": "ai_self_report_only",
                "severity": "caution",
                "evidenceRefIds": ["agent.assistant_claim"],
                "suggestedActionIds": ["open_diff"],
                "strippedActionIds": [],
                "logRationale": "Student email minji@example.com used token=secret-token-123"
            },
            "evidenceRefs": [
                {
                    "id": "agent.assistant_claim",
                    "source": "agent",
                    "kind": "assistant_claim",
                    "label": "AI 완료 주장",
                    "verificationEvidence": false,
                    "value": "function leaked() { return process.env.API_KEY; }",
                    "valueSummary": {
                        "kind": "raw",
                        "code": "const token = 'sk-testsecret';"
                    }
                }
            ],
            "userResponse": {
                "actionKind": "open_diff",
                "studentEmail": "minji@example.com",
                "studentAccountId": "student-id=2026-001"
            },
            "rawCode": "export const apiKey = 'sk-testsecret';",
            "rawDiff": "diff --git a/src/app.ts b/src/app.ts\n+const secret = process.env.API_KEY;",
            "terminalOutput": "TOKEN=secret\nstack trace line 1\nstack trace line 2",
            "studentName": "Kim Minji"
        });

        let sanitized = sanitize_provocation_event_payload(&payload);
        let encoded = sanitized.to_string();
        assert_eq!(sanitized["mode"], json!("work"));
        assert_eq!(sanitized["validationOutcome"], json!("shown"));
        assert_eq!(sanitized["dropReason"], Value::Null);
        assert_eq!(
            sanitized["cardId"],
            json!("provocation:step-3:ai_self_report_only:sha256:evidence")
        );
        assert_eq!(sanitized["supervisorEvaluationId"], json!("eval-1"));
        assert_eq!(
            sanitized["decisionSummary"]["concern"],
            json!("ai_self_report_only")
        );
        assert_eq!(
            sanitized["decisionSummary"]["evidenceRefIds"],
            json!(["agent.assistant_claim"])
        );
        assert_eq!(
            sanitized["evidenceRefs"][0]["value"]["reason"],
            json!("evidence_value_summary")
        );
        assert_eq!(
            sanitized["evidenceRefs"][0]["valueSummary"]["code"]["reason"],
            json!("raw_body_key")
        );
        assert_eq!(sanitized["rawCode"]["reason"], json!("raw_body_key"));
        assert_eq!(sanitized["rawDiff"]["reason"], json!("raw_body_key"));
        assert_eq!(sanitized["terminalOutput"]["reason"], json!("raw_body_key"));
        assert_eq!(
            sanitized["userResponse"]["studentEmail"]["reason"],
            json!("student_pii")
        );
        assert_eq!(
            sanitized["userResponse"]["studentAccountId"]["reason"],
            json!("student_pii")
        );
        assert_eq!(sanitized["studentName"]["reason"], json!("student_pii"));
        assert!(!encoded.contains("sk-testsecret"));
        assert!(!encoded.contains("secret-token-123"));
        assert!(!encoded.contains("minji@example.com"));
        assert!(!encoded.contains("Kim Minji"));
        assert!(encoded.contains("[REDACTED_SECRET]"));
    }

    #[test]
    fn supervisor_evaluation_payload_sanitizer_preserves_drop_analysis_fields() {
        let payload = json!({
            "schemaVersion": 1,
            "event": "verify_entered",
            "contextHash": "sha256:context",
            "evidenceHash": "sha256:evidence",
            "mode": "guided",
            "validationOutcome": "dropped",
            "dropReason": "unknown_evidence_ref",
            "cardId": null,
            "decisionSummary": {
                "provoke": true,
                "concern": "ai_self_report_only",
                "severity": "risk",
                "evidenceRefIds": ["agent.invented_claim"],
                "suggestedActionIds": ["open_diff"],
                "strippedActionIds": ["continue_with_risk"]
            },
            "evidenceRefs": [{
                "id": "agent.assistant_claim",
                "source": "agent",
                "kind": "assistant_claim",
                "label": "AI 완료 주장",
                "verificationEvidence": false
            }]
        });

        let sanitized = sanitize_provocation_event_payload(&payload);

        assert_eq!(sanitized["validationOutcome"], json!("dropped"));
        assert_eq!(sanitized["dropReason"], json!("unknown_evidence_ref"));
        assert_eq!(
            sanitized["decisionSummary"]["strippedActionIds"],
            json!(["continue_with_risk"])
        );
        assert_eq!(
            sanitized["evidenceRefs"][0]["id"],
            json!("agent.assistant_claim")
        );
        assert_eq!(sanitized["cardId"], Value::Null);
    }

    #[test]
    fn verification_coach_event_payload_sanitizer_redacts_raw_guidance_fields() {
        let payload = json!({
            "eventId": "coach-1",
            "status": "shown",
            "validationOutcome": "valid",
            "reasonCode": "ok",
            "prompt": "Student email minji@example.com with token=secret-token-123",
            "guideSummary": {
                "criterionSummary": "Run command",
                "rawCode": "const apiKey = 'sk-testsecret';",
                "terminalOutput": "TOKEN=secret\nstack trace line 1"
            },
            "observationText": "I ran pnpm test and saw success for student-id=2026-001"
        });

        let sanitized = sanitize_verification_coach_event_payload(&payload);
        let encoded = sanitized.to_string();

        assert_eq!(sanitized["prompt"]["reason"], json!("raw_body_key"));
        assert_eq!(
            sanitized["guideSummary"]["rawCode"]["reason"],
            json!("raw_body_key")
        );
        assert_eq!(
            sanitized["guideSummary"]["terminalOutput"]["reason"],
            json!("raw_body_key")
        );
        assert!(!encoded.contains("sk-testsecret"));
        assert!(!encoded.contains("secret-token-123"));
        assert!(!encoded.contains("minji@example.com"));
    }

    #[test]
    fn verification_observation_text_is_hashed_in_event_export_payload() {
        let payload = json!({
            "observationId": "obs-1",
            "sessionId": 1,
            "cardId": 2,
            "planStepId": 3,
            "guideVersion": 1,
            "evidenceKind": "terminal_observation",
            "criterionIds": ["AC-001"],
            "observationText": "pnpm test를 실행했고 저장 버튼이 보이는 것을 확인함",
            "recordedAt": 123
        });
        let enriched = crate::dive::event_log::enrich_agency_payload(
            crate::dive::event_log::VERIFICATION_OBSERVATION_RECORDED_EVENT,
            payload,
        );
        let sanitized = sanitize_verification_coach_event_payload(&enriched);
        let anonymized = anonymize::anonymize_value(&sanitized, true, false, "salt");
        let encoded = anonymized.to_string();

        assert_eq!(anonymized["agencyComponent"], json!("decision"));
        assert_eq!(anonymized["agencyState"], json!("verified_with_evidence"));
        assert_eq!(
            anonymized["evidenceSummary"]["manualEvidenceCount"],
            json!(1)
        );
        assert!(!encoded.contains("저장 버튼"));
        assert!(anonymized["observationText"]
            .as_str()
            .is_some_and(|value| value.starts_with("h:")));
    }

    #[test]
    fn supervisor_evaluation_payload_sanitizer_handles_expanded_plan_diff_retry_events() {
        let payload = json!({
            "schemaVersion": 1,
            "evaluations": [
                {
                    "event": "plan_drafted",
                    "artifactRef": {"kind": "plan_draft", "id": "plan-1:draft"},
                    "validationOutcome": "shown",
                    "dropReason": null,
                    "supervisorEvaluationId": "eval-plan",
                    "assessmentSummary": {
                        "reasonCodes": ["missing_verification"],
                        "evidenceRefs": ["plan.step.s_001.verification"]
                    },
                    "decisionSummary": {
                        "concern": "plan_draft_weakness",
                        "evidenceRefIds": ["plan.step.s_001.verification"],
                        "suggestedActionIds": ["add_verification_step"],
                        "strippedActionIds": []
                    },
                    "evidenceRefs": [{
                        "id": "plan.step.s_001.verification",
                        "source": "plan",
                        "kind": "verification_coverage",
                        "label": "Missing verification",
                        "valueSummary": {"stepId": "s_001"}
                    }]
                },
                {
                    "event": "diff_ready",
                    "artifactRef": {"kind": "diff", "id": "step-1:diff"},
                    "validationOutcome": "none",
                    "dropReason": "provoke_false",
                    "supervisorEvaluationId": "eval-diff",
                    "assessmentSummary": {
                        "reasonCodes": ["outside_expected_files"],
                        "evidenceRefs": ["diff.changed_files"],
                        "unexpectedFiles": ["src/auth/session.ts"],
                        "highRiskFiles": ["src/auth/session.ts"]
                    },
                    "evidenceRefs": [{
                        "id": "diff.changed_files",
                        "source": "diff",
                        "kind": "changed_file",
                        "label": "Changed files",
                        "rawDiff": "diff --git a/src/auth/session.ts b/src/auth/session.ts\n+const token = 'sk-expandedsecret';",
                        "valueSummary": {"paths": ["src/auth/session.ts"]}
                    }]
                },
                {
                    "event": "retry_loop",
                    "artifactRef": {"kind": "failure", "id": "step-1:failure"},
                    "validationOutcome": "dropped",
                    "dropReason": "runtime_unavailable",
                    "supervisorEvaluationId": "eval-retry",
                    "assessmentSummary": {
                        "reasonCodes": ["same_failure_repeated"],
                        "evidenceRefs": ["failure.fingerprint"],
                        "failureFingerprint": "typeerror_at_save",
                        "failureCount": 2
                    },
                    "userResponse": {
                        "actionKind": "create_repro_steps",
                        "studentEmail": "student@example.com"
                    },
                    "evidenceRefs": [{
                        "id": "failure.fingerprint",
                        "source": "terminal",
                        "kind": "failure_summary",
                        "label": "Failure fingerprint",
                        "terminalOutput": "TOKEN=secret-token-123\nTypeError stack line 1",
                        "valueSummary": {"fingerprint": "typeerror_at_save"}
                    }]
                }
            ]
        });

        let sanitized = sanitize_provocation_event_payload(&payload);
        let encoded = sanitized.to_string();

        assert_eq!(sanitized["evaluations"][0]["event"], json!("plan_drafted"));
        assert_eq!(sanitized["evaluations"][1]["event"], json!("diff_ready"));
        assert_eq!(sanitized["evaluations"][2]["event"], json!("retry_loop"));
        assert_eq!(
            sanitized["evaluations"][1]["assessmentSummary"]["highRiskFiles"],
            json!(["src/auth/session.ts"])
        );
        assert_eq!(
            sanitized["evaluations"][1]["evidenceRefs"][0]["rawDiff"]["reason"],
            json!("raw_body_key")
        );
        assert_eq!(
            sanitized["evaluations"][2]["evidenceRefs"][0]["terminalOutput"]["reason"],
            json!("raw_body_key")
        );
        assert_eq!(
            sanitized["evaluations"][2]["userResponse"]["studentEmail"]["reason"],
            json!("student_pii")
        );
        assert!(!encoded.contains("sk-expandedsecret"));
        assert!(!encoded.contains("secret-token-123"));
        assert!(!encoded.contains("student@example.com"));
    }
}
