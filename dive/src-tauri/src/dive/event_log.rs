//! Durable EventLog helpers for SPEC §10.5.
//!
//! EventLog rows are exported directly to pilot JSONL, so this module is the
//! single place that redacts obvious secrets before persistence.

use std::sync::LazyLock;

use regex::Regex;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::db::dao::event_log as event_log_dao;
use crate::db::models::NewEventLog;
use crate::db::DbError;

static SECRET_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?ix)
        sk-[A-Za-z0-9_\-]{3,}
        |(?:api[_-]?key|token|secret|authorization|password)\s*[:=]\s*[A-Za-z0-9_\-\.]{4,}
        |bearer\s+[A-Za-z0-9_\-\.]{4,}
        ",
    )
    .expect("secret redaction regex")
});

pub fn append_to_conn(
    conn: &Connection,
    session_id: Option<i64>,
    event_type: &str,
    payload: Value,
) -> Result<i64, DbError> {
    event_log_dao::append(
        conn,
        &NewEventLog {
            session_id,
            r#type: event_type.to_owned(),
            payload: redact_value(&payload),
        },
    )
}

pub fn user_text_metadata(text: &str) -> Value {
    json!({
        "content_len": text.chars().count(),
        "content_hash": format!("h:{}", hash_text(text)),
    })
}

pub fn error_payload(source: &str, message: &str) -> Value {
    json!({
        "source": source,
        "message_redacted": redact_text(message),
    })
}

pub fn redact_value(value: &Value) -> Value {
    match value {
        Value::String(s) => Value::String(redact_text(s)),
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, value) in map {
                let redacted = if is_sensitive_key(key) {
                    Value::String("[REDACTED_SECRET]".into())
                } else {
                    redact_value(value)
                };
                out.insert(key.clone(), redacted);
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

pub fn redact_text(text: &str) -> String {
    let redacted = SECRET_RE.replace_all(text, "[REDACTED_SECRET]");
    redacted.to_string()
}

pub fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let digest = hasher.finalize();
    let hex = format!("{digest:x}");
    hex[..16].to_string()
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '_'], "");
    normalized.contains("apikey")
        || normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("authorization")
        || normalized.contains("password")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_text_metadata_hashes_without_raw_text() {
        let text = "API키: sk-abc123";
        let metadata = user_text_metadata(text);
        let encoded = metadata.to_string();
        assert!(!encoded.contains(text));
        assert!(!encoded.contains("sk-abc123"));
        assert_eq!(metadata["content_len"], text.chars().count());
    }

    #[test]
    fn redact_value_masks_tokens_recursively() {
        let redacted = redact_value(&json!({
            "nested": {"authorization": "Bearer secret-token-123"},
            "api_key": "sk-abc123",
            "password": "hunter2",
        }));
        let encoded = redacted.to_string();
        assert!(!encoded.contains("sk-abc123"));
        assert!(!encoded.contains("secret-token-123"));
        assert!(!encoded.contains("hunter2"));
        assert!(encoded.contains("[REDACTED_SECRET]"));
    }
}
