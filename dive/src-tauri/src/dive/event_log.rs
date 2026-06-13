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
    let payload = enrich_agency_payload(event_type, payload);
    event_log_dao::append(
        conn,
        &NewEventLog {
            session_id,
            r#type: event_type.to_owned(),
            payload: redact_value(&payload),
        },
    )
}

pub(crate) fn enrich_agency_payload(event_type: &str, payload: Value) -> Value {
    let Value::Object(mut map) = payload else {
        return payload;
    };
    let snapshot = Value::Object(map.clone());

    insert_missing_string(
        &mut map,
        "agencyComponent",
        infer_agency_component(event_type, &snapshot),
    );
    insert_missing_string(
        &mut map,
        "agencyState",
        infer_agency_state(event_type, &snapshot),
    );
    insert_missing_value(&mut map, "riskLevel", infer_risk_level(&snapshot));
    insert_missing_value(&mut map, "affectedFiles", infer_affected_files(&snapshot));
    insert_missing_value(
        &mut map,
        "affectedCommands",
        infer_affected_commands(event_type, &snapshot),
    );
    insert_missing_value(
        &mut map,
        "evidenceSummary",
        infer_evidence_summary(event_type, &snapshot),
    );
    insert_missing_value(&mut map, "decision", infer_decision(event_type, &snapshot));
    insert_missing_value(
        &mut map,
        "reasonPresent",
        infer_reason_present(event_type, &snapshot),
    );

    Value::Object(map)
}

fn insert_missing_string(map: &mut Map<String, Value>, key: &str, value: Option<&'static str>) {
    if !map.contains_key(key) {
        if let Some(value) = value {
            map.insert(key.into(), Value::String(value.into()));
        }
    }
}

fn insert_missing_value(map: &mut Map<String, Value>, key: &str, value: Option<Value>) {
    if !map.contains_key(key) {
        if let Some(value) = value {
            if !value.is_null() {
                map.insert(key.into(), value);
            }
        }
    }
}

fn string_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn nested_string_field<'a>(value: &'a Value, parent: &str, key: &str) -> Option<&'a str> {
    value.get(parent)?.get(key)?.as_str()
}

fn infer_agency_component(event_type: &str, payload: &Value) -> Option<&'static str> {
    match event_type {
        "checkpoint_create" | "checkpoint_restore" => return Some("rollback"),
        "verify_start" | "verify_complete" => return Some("verify"),
        "tool_approve" | "tool_call_start" | "tool_call_denied" | "tool_call_blocked"
        | "tool_reject" | "tool_result" | "tool_complete" => return Some("action"),
        "provocation.continued_with_risk" if string_field(payload, "tool").is_some() => {
            return Some("action")
        }
        "card_update" => {
            return match string_field(payload, "action") {
                Some("transition") => Some("decision"),
                Some("test_command") => Some("verify"),
                Some("instruction" | "retrospective") => Some("plan"),
                _ => None,
            };
        }
        _ if event_type.starts_with("plan_") => return Some("plan"),
        _ => {}
    }

    if event_type.starts_with("provocation.") {
        if let Some(action_kind) = payload
            .get("selectedAction")
            .and_then(|value| value.get("kind"))
            .and_then(Value::as_str)
            .or_else(|| nested_string_field(payload, "decision", "actionKind"))
        {
            if let Some(component) = component_for_action_kind(action_kind) {
                return Some(component);
            }
        }
        if let Some(card_type) = string_field(payload, "cardType")
            .or_else(|| string_field(payload, "card_type"))
            .or_else(|| nested_string_field(payload, "approval_metadata", "cardType"))
        {
            if let Some(component) = component_for_card_type(card_type) {
                return Some(component);
            }
        }
        if let Some(stage) = string_field(payload, "stage") {
            return component_for_stage(stage);
        }
    }

    None
}

fn component_for_action_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "add_acceptance_criteria" | "split_scope" => Some("intent"),
        "add_verification_step" => Some("plan"),
        "open_diff" => Some("diff"),
        "run_app" | "run_tests" | "open_preview" => Some("verify"),
        "revert_unrelated_changes"
        | "create_repro_steps"
        | "rollback_last_change"
        | "retry_with_ai" => Some("rollback"),
        "continue_with_risk" => Some("decision"),
        "ask_ai_for_rationale" => Some("action"),
        _ => None,
    }
}

fn component_for_card_type(card_type: &str) -> Option<&'static str> {
    match card_type {
        "oversized_scope" | "missing_acceptance_criteria" => Some("intent"),
        "missing_verification_step" => Some("plan"),
        "diff_scope_drift" => Some("diff"),
        "ai_self_report_only" => Some("verify"),
        "regeneration_loop" => Some("rollback"),
        _ => None,
    }
}

fn component_for_stage(stage: &str) -> Option<&'static str> {
    match stage {
        "decompose" => Some("intent"),
        "instruct" => Some("plan"),
        "execute" => Some("action"),
        "verify" => Some("verify"),
        "extend" => Some("rollback"),
        "finalApproval" => Some("decision"),
        _ => None,
    }
}

fn infer_agency_state(event_type: &str, payload: &Value) -> Option<&'static str> {
    if let Some(state) = payload
        .get("verificationStatus")
        .and_then(|value| value.get("verificationState"))
        .and_then(Value::as_str)
        .or_else(|| {
            payload
                .get("approval_provenance")
                .and_then(|value| value.get("verificationState"))
                .and_then(Value::as_str)
        })
        .or_else(|| string_field(payload, "verificationState"))
    {
        return state_for_verification_state(state);
    }

    match event_type {
        "checkpoint_create" | "checkpoint_restore" => return Some("rollback_available"),
        "verify_complete" => {
            return match string_field(payload, "test_result") {
                Some("pass") => Some("verified_with_evidence"),
                Some("fail") => Some("verification_failed"),
                Some("skipped") => Some("ai_self_report_only"),
                _ => Some("verification_needed"),
            };
        }
        "tool_approve" => {
            return if has_risk_reason(payload) {
                Some("approved_with_risk")
            } else {
                Some("approval_required")
            };
        }
        _ => {}
    }

    if event_type.starts_with("provocation.") {
        if has_risk_reason(payload)
            || payload
                .get("riskAccepted")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        {
            return Some("approved_with_risk");
        }
        if let Some(card_type) = string_field(payload, "cardType")
            .or_else(|| string_field(payload, "card_type"))
            .or_else(|| nested_string_field(payload, "approval_metadata", "cardType"))
        {
            return state_for_card_type(card_type);
        }
    }

    None
}

fn state_for_verification_state(state: &str) -> Option<&'static str> {
    match state {
        "verified_with_evidence" => Some("verified_with_evidence"),
        "unverified_risk_accepted" => Some("approved_with_risk"),
        "failed_but_accepted" => Some("verification_failed"),
        _ => None,
    }
}

fn state_for_card_type(card_type: &str) -> Option<&'static str> {
    match card_type {
        "oversized_scope" | "missing_acceptance_criteria" => Some("intent_needed"),
        "missing_verification_step" => Some("verification_needed"),
        "diff_scope_drift" => Some("diff_review_needed"),
        "ai_self_report_only" => Some("ai_self_report_only"),
        "regeneration_loop" => Some("verification_failed"),
        _ => None,
    }
}

fn infer_risk_level(payload: &Value) -> Option<Value> {
    string_field(payload, "risk")
        .or_else(|| string_field(payload, "severity"))
        .map(|value| Value::String(value.into()))
}

fn infer_affected_files(payload: &Value) -> Option<Value> {
    let mut out = Map::new();
    copy_existing_value(payload, &mut out, "changedFiles");
    copy_existing_value(payload, &mut out, "changed_files");
    copy_existing_value(payload, &mut out, "targetFiles");
    copy_existing_value(payload, &mut out, "highRiskFiles");

    if let Some(metadata) = payload.get("approval_metadata") {
        copy_existing_value_as(metadata, &mut out, "highRiskFiles", "highRiskFiles");
    }

    if let Some(path) = string_field(payload, "path") {
        out.insert("paths".into(), json!([path]));
    }
    if let Some(count) = payload.get("changed_file_count").and_then(Value::as_u64) {
        out.insert("changedFileCount".into(), json!(count));
    }

    if out.is_empty() {
        None
    } else {
        Some(Value::Object(out))
    }
}

fn copy_existing_value(payload: &Value, out: &mut Map<String, Value>, key: &str) {
    copy_existing_value_as(payload, out, key, key);
}

fn copy_existing_value_as(
    payload: &Value,
    out: &mut Map<String, Value>,
    source: &str,
    target: &str,
) {
    if let Some(value) = payload.get(source) {
        if !value.is_null() {
            out.insert(target.into(), value.clone());
        }
    }
}

fn infer_affected_commands(event_type: &str, payload: &Value) -> Option<Value> {
    if let Some(tool) = string_field(payload, "tool") {
        return Some(json!([{ "kind": "tool", "name": tool }]));
    }
    if matches!(event_type, "verify_start" | "verify_complete") {
        return Some(json!([{ "kind": "verification", "redacted": true }]));
    }
    if event_type == "card_update"
        && string_field(payload, "action") == Some("test_command")
        && payload.get("test_command_len").is_some()
    {
        return Some(json!([{
            "kind": "verification_command",
            "redacted": true,
            "charCount": payload.get("test_command_len").cloned().unwrap_or(Value::Null),
        }]));
    }
    None
}

fn infer_evidence_summary(event_type: &str, payload: &Value) -> Option<Value> {
    if let Some(summary) = payload
        .get("verificationStatus")
        .and_then(|value| value.get("evidenceSummary"))
        .cloned()
        .or_else(|| {
            payload
                .get("approval_provenance")
                .and_then(|value| value.get("evidenceSummary"))
                .cloned()
        })
    {
        return Some(summary);
    }

    match event_type {
        "verify_complete" => {
            let test_result = string_field(payload, "test_result");
            let external_test_run = !matches!(test_result, None | Some("skipped"));
            return Some(json!({
                "schemaVersion": 1,
                "concreteEvidence": test_result == Some("pass"),
                "aiSelfReport": payload.get("intent_match").and_then(Value::as_bool).unwrap_or(false),
                "automatedTestsPassed": test_result == Some("pass"),
                "externalTestRun": external_test_run,
                "testResult": test_result,
            }));
        }
        "verify_start" => {
            return Some(json!({
                "schemaVersion": 1,
                "verificationStarted": true,
            }));
        }
        "checkpoint_create" | "checkpoint_restore" => {
            return Some(json!({
                "schemaVersion": 1,
                "rollbackAvailable": true,
                "rollbackUsed": event_type == "checkpoint_restore",
                "preRestoreBackup": payload
                    .get("pre_restore_backup")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            }));
        }
        "tool_approve" => {
            return Some(json!({
                "schemaVersion": 1,
                "permissionReviewed": true,
                "riskAccepted": has_risk_reason(payload),
                "highRiskFileCount": high_risk_file_count(payload),
            }));
        }
        "provocation.continued_with_risk" if string_field(payload, "tool").is_some() => {
            return Some(json!({
                "schemaVersion": 1,
                "permissionReviewed": true,
                "riskAccepted": true,
                "highRiskFileCount": high_risk_file_count(payload),
            }));
        }
        _ if event_type.starts_with("plan_") => {
            return Some(json!({
                "schemaVersion": 1,
                "planApproved": event_type == "plan_approved",
                "planStepOpened": event_type == "plan_step_opened",
                "planStepBlocked": event_type == "plan_step_open_failed",
                "planStepAppended": event_type == "plan_step_appended",
            }));
        }
        _ if event_type.starts_with("provocation.") => {
            return provocation_evidence_summary(payload);
        }
        _ => {}
    }

    None
}

fn high_risk_file_count(payload: &Value) -> usize {
    payload
        .get("highRiskFiles")
        .or_else(|| {
            payload
                .get("approval_metadata")
                .and_then(|metadata| metadata.get("highRiskFiles"))
        })
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn provocation_evidence_summary(payload: &Value) -> Option<Value> {
    let evidence = payload.get("evidence")?.as_array()?;
    let labels = evidence
        .iter()
        .filter_map(|item| item.get("label").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut sources = Vec::new();
    for source in evidence
        .iter()
        .filter_map(|item| item.get("source").and_then(Value::as_str))
    {
        if !sources.iter().any(|existing| existing == source) {
            sources.push(source.to_owned());
        }
    }

    Some(json!({
        "schemaVersion": 1,
        "count": evidence.len(),
        "labels": labels,
        "sources": sources,
    }))
}

fn infer_decision(event_type: &str, payload: &Value) -> Option<Value> {
    match event_type {
        "checkpoint_create" => return Some(json!({ "kind": "create_checkpoint" })),
        "checkpoint_restore" => return Some(json!({ "kind": "restore_checkpoint" })),
        "tool_approve" => return Some(json!({ "kind": "approve_tool" })),
        "provocation.continued_with_risk" => return Some(json!({ "kind": "accept_risk" })),
        "card_update" if string_field(payload, "action") == Some("transition") => {
            return Some(json!({
                "kind": "card_transition",
                "transition": payload.get("transition").cloned().unwrap_or(Value::Null),
                "approvalOutcome": payload
                    .get("approval_provenance")
                    .and_then(|value| value.get("approvalOutcome"))
                    .cloned()
                    .unwrap_or(Value::Null),
            }));
        }
        _ => {}
    }

    if event_type.starts_with("provocation.") {
        return Some(json!({
            "kind": payload
                .get("selectedAction")
                .and_then(|value| value.get("kind"))
                .cloned()
                .or_else(|| nested_string_field(payload, "decision", "actionKind").map(|value| json!(value)))
                .unwrap_or(Value::Null),
            "event": event_type.strip_prefix("provocation.").unwrap_or(event_type),
        }));
    }
    None
}

fn infer_reason_present(event_type: &str, payload: &Value) -> Option<Value> {
    let relevant = event_type.starts_with("provocation.")
        || matches!(event_type, "tool_approve" | "card_update");
    if !relevant {
        return None;
    }
    Some(Value::Bool(has_risk_reason(payload)))
}

fn has_risk_reason(payload: &Value) -> bool {
    string_field(payload, "reason")
        .or_else(|| string_field(payload, "riskReason"))
        .or_else(|| nested_string_field(payload, "approval_metadata", "riskReason"))
        .or_else(|| {
            payload
                .get("approval_provenance")
                .and_then(|value| value.get("riskReason"))
                .and_then(Value::as_str)
        })
        .map(|reason| !reason.trim().is_empty())
        .unwrap_or(false)
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

    #[test]
    fn agency_enrichment_maps_tool_risk_acceptance() {
        let enriched = enrich_agency_payload(
            "tool_approve",
            json!({
                "tool": "edit_file",
                "tool_call_id": "tool-1",
                "risk": "warn",
                "approval_metadata": {
                    "source": "provocation.continue_with_risk",
                    "cardType": "diff_scope_drift",
                    "riskReason": "package change is intentional",
                    "highRiskFiles": ["package.json"]
                }
            }),
        );

        assert_eq!(enriched["agencyComponent"], "action");
        assert_eq!(enriched["agencyState"], "approved_with_risk");
        assert_eq!(enriched["riskLevel"], "warn");
        assert_eq!(
            enriched["affectedFiles"]["highRiskFiles"][0],
            "package.json"
        );
        assert_eq!(enriched["affectedCommands"][0]["name"], "edit_file");
        assert_eq!(enriched["evidenceSummary"]["permissionReviewed"], true);
        assert_eq!(enriched["evidenceSummary"]["riskAccepted"], true);
        assert_eq!(enriched["evidenceSummary"]["highRiskFileCount"], 1);
        assert_eq!(enriched["reasonPresent"], true);
    }

    #[test]
    fn agency_enrichment_maps_checkpoint_restore() {
        let enriched = enrich_agency_payload(
            "checkpoint_restore",
            json!({
                "checkpoint_id": 42,
                "card_id": 7,
                "pre_restore_backup": true
            }),
        );

        assert_eq!(enriched["agencyComponent"], "rollback");
        assert_eq!(enriched["agencyState"], "rollback_available");
        assert_eq!(enriched["evidenceSummary"]["rollbackAvailable"], true);
        assert_eq!(enriched["evidenceSummary"]["rollbackUsed"], true);
        assert_eq!(enriched["decision"]["kind"], "restore_checkpoint");
    }

    #[test]
    fn agency_enrichment_maps_verification_without_treating_ai_report_as_evidence() {
        let enriched = enrich_agency_payload(
            "verify_complete",
            json!({
                "card_id": 7,
                "intent_match": true,
                "test_result": "skipped"
            }),
        );

        assert_eq!(enriched["agencyComponent"], "verify");
        assert_eq!(enriched["agencyState"], "ai_self_report_only");
        assert_eq!(enriched["evidenceSummary"]["aiSelfReport"], true);
        assert_eq!(enriched["evidenceSummary"]["concreteEvidence"], false);
        assert_eq!(enriched["evidenceSummary"]["externalTestRun"], false);
    }

    #[test]
    fn agency_enrichment_maps_plan_activity_without_new_event_taxonomy() {
        let enriched = enrich_agency_payload(
            "plan_approved",
            json!({
                "project_id": 1,
                "plan_id": 2,
                "message": "Plan approved"
            }),
        );

        assert_eq!(enriched["agencyComponent"], "plan");
        assert_eq!(enriched["evidenceSummary"]["planApproved"], true);
        assert!(enriched.get("agencyState").is_none());
    }
}
