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
use crate::dive::supervisor::SupervisorEvaluationLog;
use crate::tools::guard::assess_terminal_script;

pub const SUPERVISOR_EVALUATED_EVENT: &str = "provocation.supervisor_evaluated";
pub const RUNTIME_CAPABILITY_EVALUATED_EVENT: &str = "runtime.capability_evaluated";
pub const PRD_PATCH_PROPOSED_EVENT: &str = "prd_patch_proposed";
pub const PRD_PATCH_APPLIED_EVENT: &str = "prd_patch_applied";
pub const PRD_PATCH_REJECTED_EVENT: &str = "prd_patch_rejected";
pub const PRD_AUTHORED_EVENT: &str = "prd_authored";
pub const PRD_EDITED_EVENT: &str = "prd_edited";
pub const PRD_VERSION_CREATED_EVENT: &str = "prd_version_created";
pub const PLAN_GENERATED_EVENT: &str = "plan_generated";
pub const PLAN_STEP_RATIONALE_CHALLENGED_EVENT: &str = "plan_step_rationale_challenged";
pub const PLAN_ADJUSTMENT_OFFERED_EVENT: &str = "plan_adjustment_offered";
pub const PLAN_ADJUSTMENT_ACCEPTED_EVENT: &str = "plan_adjustment_accepted";
pub const PLAN_ADJUSTMENT_DISMISSED_EVENT: &str = "plan_adjustment_dismissed";
pub const PLAN_STEP_APPENDED_EVENT: &str = "plan_step_appended";
pub const PLAN_STEP_CHANGED_EVENT: &str = "plan_step_changed";
pub const PLAN_STEP_RETIRED_EVENT: &str = "plan_step_retired";
pub const VERIFICATION_COACH_REQUESTED_EVENT: &str = "verification_coach.requested";
pub const VERIFICATION_COACH_EVALUATED_EVENT: &str = "verification_coach.evaluated";
pub const VERIFICATION_OBSERVATION_RECORDED_EVENT: &str = "verification_observation.recorded";
pub const VERIFICATION_OBSERVATION_CLEARED_EVENT: &str = "verification_observation.cleared";
pub const RUNTIME_ROUTING_DECISION_EVENT: &str = "runtime.routing_decision";
pub const PREVIEW_OPEN_REQUESTED_EVENT: &str = "preview.open_requested";
pub const PREVIEW_OPEN_RESULT_EVENT: &str = "preview.open_result";
pub const PROJECT_COMMAND_RESULT_EVENT: &str = "project_command.result";
pub const TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT: &str = "terminal_script.approval_requested";
pub const TERMINAL_SCRIPT_RESULT_EVENT: &str = "terminal_script.result";
pub const TOOL_APPROVAL_STALE_EVENT: &str = "tool_approval.stale";
pub const WEB_FETCH_APPROVAL_REQUESTED_EVENT: &str = "web_fetch.approval_requested";
pub const WEB_FETCH_RESULT_EVENT: &str = "web_fetch.result";
pub const WEB_FETCH_BLOCKED_EVENT: &str = "web_fetch.blocked";

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
static EMAIL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b").expect("email redaction regex")
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

pub fn append_supervisor_evaluation_to_conn(
    conn: &Connection,
    session_id: i64,
    supervisor_evaluation_id: &str,
    log: &SupervisorEvaluationLog,
) -> Result<i64, DbError> {
    let mut payload = serde_json::to_value(log)?;
    if let Value::Object(map) = &mut payload {
        map.insert(
            "supervisorEvaluationId".into(),
            Value::String(supervisor_evaluation_id.to_string()),
        );
    }
    append_to_conn(conn, Some(session_id), SUPERVISOR_EVALUATED_EVENT, payload)
}

pub fn terminal_script_approval_requested_payload(
    tool_call_id: &str,
    session_id: i64,
    card_id: Option<i64>,
    args: &Value,
) -> Value {
    let script = args.get("script").and_then(Value::as_str).unwrap_or("");
    let assessment = assess_terminal_script(script);
    json!({
        "toolCallId": tool_call_id,
        "sessionId": session_id,
        "cardId": card_id,
        "shellFamily": args.get("shell_family").and_then(Value::as_str).unwrap_or("unknown"),
        "scriptSummary": script,
        "reason": args.get("reason").and_then(Value::as_str).unwrap_or(""),
        "expectedEffect": args.get("expected_effect").and_then(Value::as_str).unwrap_or(""),
        "timeoutSec": args.get("timeout_sec").and_then(Value::as_u64).unwrap_or(60),
        "outputLimit": args.get("output_limit").and_then(Value::as_u64).unwrap_or(16 * 1024),
        "riskFactors": assessment.risk_factors,
        "oneShot": true,
        "approvalReuse": false,
        "requestedAt": crate::db::now_ms(),
    })
}

pub fn terminal_script_result_payload(
    tool_call_id: &str,
    status: &str,
    success: bool,
    summary: &str,
    full: Option<&Value>,
) -> Value {
    json!({
        "toolCallId": tool_call_id,
        "status": status,
        "success": success,
        "exitCode": full.and_then(|value| value.get("exitCode")).and_then(Value::as_i64),
        "summary": summary,
        "stdoutSummary": full.and_then(|value| value.get("stdout")).and_then(Value::as_str).unwrap_or(""),
        "stderrSummary": full.and_then(|value| value.get("stderr")).and_then(Value::as_str).unwrap_or(""),
        "truncated": full.and_then(|value| value.get("truncated")).and_then(Value::as_bool).unwrap_or(false),
        "resolvedAt": crate::db::now_ms(),
    })
}

pub fn web_fetch_approval_requested_payload(
    tool_call_id: &str,
    session_id: i64,
    card_id: Option<i64>,
    args: &Value,
) -> Value {
    let attempt = crate::tools::web_fetch::attempt_log_from_input(args);
    let approval = args
        .get("web_fetch_approval")
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "toolCallId": tool_call_id,
        "sessionId": session_id,
        "cardId": card_id,
        "url": attempt.url,
        "purpose": attempt.purpose,
        "approval": approval,
        "method": "GET",
        "requestedAt": crate::db::now_ms(),
    })
}

pub fn web_fetch_result_payload(
    tool_call_id: &str,
    status: &str,
    success: bool,
    summary: &str,
    full: Option<&Value>,
) -> Value {
    let body_snippet_hash = full
        .and_then(|value| value.get("bodySnippet"))
        .and_then(Value::as_str)
        .map(hash_text);
    json!({
        "toolCallId": tool_call_id,
        "status": status,
        "success": success,
        "statusCode": full.and_then(|value| value.get("statusCode")).and_then(Value::as_u64),
        "summary": summary,
        "host": full.and_then(|value| value.get("host")).and_then(Value::as_str).unwrap_or(""),
        "resolvedIp": full.and_then(|value| value.get("resolvedIp")).and_then(Value::as_str).unwrap_or(""),
        "bytesOnWire": full.and_then(|value| value.get("bytesOnWire")).and_then(Value::as_u64).unwrap_or(0),
        "elapsedMs": full.and_then(|value| value.get("elapsedMs")).and_then(Value::as_u64).unwrap_or(0),
        "errorClass": full.and_then(|value| value.get("errorClass")).and_then(Value::as_str),
        "unavailableReason": full.and_then(|value| value.get("unavailableReason")).and_then(Value::as_str),
        "bodySnippetHash": body_snippet_hash,
        "bodyPersisted": false,
        "isEvidence": false,
        "resolvedAt": crate::db::now_ms(),
    })
}

pub fn web_fetch_blocked_payload(
    tool_call_id: &str,
    session_id: i64,
    args: &Value,
    reason: &crate::tools::egress_guard::EgressBlockReason,
) -> Value {
    let attempt = crate::tools::web_fetch::attempt_log_from_input(args);
    json!({
        "toolCallId": tool_call_id,
        "sessionId": session_id,
        "url": attempt.url,
        "purpose": attempt.purpose,
        "status": "blocked",
        "errorClass": reason.code(),
        "unavailableReason": reason.unavailable_reason().as_str(),
        "message": reason.safe_agent_message(),
        "blockedAt": crate::db::now_ms(),
    })
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

fn nested_bool_field(value: &Value, parent: &str, key: &str) -> Option<bool> {
    value
        .get(parent)
        .and_then(|nested| nested.get(key))
        .and_then(Value::as_bool)
}

fn read_gate_satisfied(payload: &Value) -> bool {
    nested_bool_field(payload, "approval_metadata", "readGateSatisfied").unwrap_or(false)
}

fn secret_flagged(payload: &Value) -> bool {
    payload
        .get("approvalWarnings")
        .and_then(|warnings| warnings.get("secretFlagged"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || nested_bool_field(payload, "approval_metadata", "secretFlagged").unwrap_or(false)
}

fn test_result_field(value: &Value) -> Option<&str> {
    string_field(value, "test_result").or_else(|| string_field(value, "testResult"))
}

fn test_command_present(value: &Value) -> bool {
    value
        .get("test_command_present")
        .or_else(|| value.get("testCommandPresent"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || string_field(value, "test_command")
            .or_else(|| string_field(value, "testCommand"))
            .is_some_and(|command| !command.trim().is_empty())
}

fn test_exit_code_present(value: &Value) -> bool {
    value
        .get("test_exit_code")
        .or_else(|| value.get("testExitCode"))
        .is_some_and(|exit_code| !exit_code.is_null())
}

fn has_executed_test_command(value: &Value) -> bool {
    test_command_present(value) && test_exit_code_present(value)
}

fn nested_string_field<'a>(value: &'a Value, parent: &str, key: &str) -> Option<&'a str> {
    value.get(parent)?.get(key)?.as_str()
}

fn infer_agency_component(event_type: &str, payload: &Value) -> Option<&'static str> {
    match event_type {
        SUPERVISOR_EVALUATED_EVENT => {
            return match string_field(payload, "event") {
                Some("scope_expansion") => Some("plan"),
                Some("plan_drafted") => Some("plan"),
                Some("diff_ready") => Some("diff"),
                Some("retry_loop") => Some("rollback"),
                _ => Some("verify"),
            }
        }
        RUNTIME_CAPABILITY_EVALUATED_EVENT
        | RUNTIME_ROUTING_DECISION_EVENT
        | PROJECT_COMMAND_RESULT_EVENT
        | TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT
        | TERMINAL_SCRIPT_RESULT_EVENT
        | TOOL_APPROVAL_STALE_EVENT => return Some("action"),
        PREVIEW_OPEN_REQUESTED_EVENT | PREVIEW_OPEN_RESULT_EVENT => return Some("verify"),
        VERIFICATION_COACH_REQUESTED_EVENT | VERIFICATION_COACH_EVALUATED_EVENT => {
            return Some("verify")
        }
        VERIFICATION_OBSERVATION_RECORDED_EVENT | VERIFICATION_OBSERVATION_CLEARED_EVENT => {
            return Some("decision")
        }
        PRD_PATCH_PROPOSED_EVENT
        | PRD_PATCH_APPLIED_EVENT
        | PRD_PATCH_REJECTED_EVENT
        | PRD_AUTHORED_EVENT
        | PRD_EDITED_EVENT
        | PRD_VERSION_CREATED_EVENT => return Some("plan"),
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
        "scope_expansion" => Some("plan"),
        "plan_draft_review" => Some("plan"),
        "diff_scope_review" => Some("diff"),
        "retry_loop_review" => Some("rollback"),
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
        SUPERVISOR_EVALUATED_EVENT => {
            match string_field(payload, "event") {
                Some("scope_expansion" | "plan_drafted") => {
                    return match string_field(payload, "validationOutcome") {
                        Some("shown") => Some("plan_review_needed"),
                        Some("none" | "dropped" | "error") => Some("plan_review_dropped"),
                        _ => None,
                    }
                }
                Some("diff_ready") => {
                    return match string_field(payload, "validationOutcome") {
                        Some("shown") => Some("diff_review_needed"),
                        Some("none" | "dropped" | "error") => Some("verification_needed"),
                        _ => None,
                    }
                }
                Some("retry_loop") => {
                    return match string_field(payload, "validationOutcome") {
                        Some("shown") => Some("verification_failed"),
                        Some("none" | "dropped" | "error") => Some("verification_needed"),
                        _ => None,
                    }
                }
                _ => {}
            }
            return match string_field(payload, "validationOutcome") {
                Some("shown") => Some("ai_self_report_only"),
                Some("none" | "dropped" | "error") => Some("verification_needed"),
                _ => None,
            };
        }
        RUNTIME_CAPABILITY_EVALUATED_EVENT => {
            return match string_field(payload, "status") {
                Some("ready") => Some("supervised_runtime_ready"),
                Some("unavailable") => Some("runtime_unavailable"),
                _ => None,
            };
        }
        RUNTIME_ROUTING_DECISION_EVENT => {
            return match string_field(payload, "outcome") {
                Some("blocked") => Some("verification_failed"),
                Some("rerouted" | "stale") => Some("verification_needed"),
                Some("unavailable") => Some("runtime_unavailable"),
                Some("preview" | "project_command" | "terminal_script") => {
                    Some("approval_required")
                }
                _ => None,
            };
        }
        PREVIEW_OPEN_REQUESTED_EVENT => return Some("verification_needed"),
        PREVIEW_OPEN_RESULT_EVENT => {
            return match string_field(payload, "status") {
                Some("ready") => Some("verification_needed"),
                Some("failed" | "unavailable") => Some("runtime_unavailable"),
                _ => None,
            };
        }
        PROJECT_COMMAND_RESULT_EVENT | TERMINAL_SCRIPT_RESULT_EVENT => {
            return match string_field(payload, "status") {
                Some("completed" | "passed")
                    if payload.get("success").and_then(Value::as_bool) == Some(true) =>
                {
                    Some("verified_with_evidence")
                }
                Some("blocked" | "failed") => Some("verification_failed"),
                Some("denied" | "cancelled" | "unavailable") => Some("verification_needed"),
                _ => None,
            };
        }
        TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT => return Some("approval_required"),
        TOOL_APPROVAL_STALE_EVENT => return Some("verification_needed"),
        VERIFICATION_COACH_EVALUATED_EVENT => {
            return match string_field(payload, "status") {
                Some("shown" | "unavailable" | "dropped") => Some("verification_needed"),
                _ => None,
            };
        }
        VERIFICATION_OBSERVATION_RECORDED_EVENT => return Some("verified_with_evidence"),
        VERIFICATION_OBSERVATION_CLEARED_EVENT => return Some("verification_needed"),
        "checkpoint_create" | "checkpoint_restore" => return Some("rollback_available"),
        "verify_complete" => {
            let test_result = test_result_field(payload);
            let executed_test = has_executed_test_command(payload);
            return match (test_result, executed_test) {
                (Some("pass"), true) => Some("verified_with_evidence"),
                (Some("fail"), true) => Some("verification_failed"),
                _ if payload
                    .get("intent_match")
                    .and_then(Value::as_bool)
                    .unwrap_or(false) =>
                {
                    Some("ai_self_report_only")
                }
                _ => Some("verification_needed"),
            };
        }
        "tool_call_start" if secret_flagged(payload) => return Some("secret_flagged"),
        "tool_approve" => {
            return if secret_flagged(payload) {
                Some("secret_flagged")
            } else if read_gate_satisfied(payload) {
                Some("read_gate_satisfied")
            } else if has_risk_reason(payload) {
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
        "verification_deferred" => Some("verification_deferred"),
        _ => None,
    }
}

fn state_for_card_type(card_type: &str) -> Option<&'static str> {
    match card_type {
        "oversized_scope" | "missing_acceptance_criteria" => Some("intent_needed"),
        "scope_expansion" => Some("plan_review_needed"),
        "plan_draft_review" => Some("plan_review_needed"),
        "diff_scope_review" => Some("diff_review_needed"),
        "retry_loop_review" => Some("verification_failed"),
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

    if let Some(assessment) = payload
        .get("assessmentSummary")
        .or_else(|| payload.get("diffReadyAssessment"))
    {
        copy_existing_value_as(assessment, &mut out, "unexpectedFiles", "changedFiles");
        copy_existing_value_as(assessment, &mut out, "highRiskFiles", "highRiskFiles");
        copy_existing_value_as(assessment, &mut out, "changedFileCount", "changedFileCount");
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
    if event_type == PROJECT_COMMAND_RESULT_EVENT {
        return Some(json!([{
            "kind": "project_command",
            "label": payload.get("commandLabel").cloned().unwrap_or(Value::Null),
        }]));
    }
    if event_type == TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT
        || event_type == TERMINAL_SCRIPT_RESULT_EVENT
    {
        return Some(json!([{ "kind": "terminal_script", "redacted": true }]));
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
        RUNTIME_ROUTING_DECISION_EVENT => {
            return Some(json!({
                "schemaVersion": 1,
                "runtimeRouting": true,
                "inputKind": payload.get("inputKind").cloned().unwrap_or(Value::Null),
                "outcome": payload.get("outcome").cloned().unwrap_or(Value::Null),
                "reasonCode": payload.get("reasonCode").cloned().unwrap_or(Value::Null),
                "verificationEvidence": false,
                "commandRan": payload.get("commandRan").and_then(Value::as_bool).unwrap_or(false),
            }));
        }
        PREVIEW_OPEN_REQUESTED_EVENT => {
            return Some(json!({
                "schemaVersion": 1,
                "previewRequested": true,
                "previewIsFinalVerification": false,
            }));
        }
        PREVIEW_OPEN_RESULT_EVENT => {
            return Some(json!({
                "schemaVersion": 1,
                "previewAvailable": string_field(payload, "status") == Some("ready"),
                "previewIsFinalVerification": false,
                "reasonCode": payload.get("reasonCode").cloned().unwrap_or(Value::Null),
            }));
        }
        PROJECT_COMMAND_RESULT_EVENT => {
            let success = payload
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let status = string_field(payload, "status");
            let command_ran = matches!(status, Some("completed" | "passed" | "failed"))
                || payload.get("exitCode").and_then(Value::as_i64).is_some();
            return Some(json!({
                "schemaVersion": 1,
                "concreteEvidence": success,
                "aiSelfReport": false,
                "automatedTestsPassed": success,
                "externalTestRun": command_ran,
                "commandRan": command_ran,
                "exitCode": payload.get("exitCode").cloned().unwrap_or(Value::Null),
            }));
        }
        TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT => {
            return Some(json!({
                "schemaVersion": 1,
                "terminalScriptApprovalRequested": true,
                "riskFactors": payload.get("riskFactors").cloned().unwrap_or(Value::Null),
            }));
        }
        TERMINAL_SCRIPT_RESULT_EVENT => {
            return Some(json!({
                "schemaVersion": 1,
                "terminalScriptResult": true,
                "concreteEvidence": payload.get("success").and_then(Value::as_bool).unwrap_or(false),
                "aiSelfReport": false,
                "externalTestRun": true,
                "truncated": payload.get("truncated").cloned().unwrap_or(Value::Null),
                "exitCode": payload.get("exitCode").cloned().unwrap_or(Value::Null),
            }));
        }
        TOOL_APPROVAL_STALE_EVENT => {
            return Some(json!({
                "schemaVersion": 1,
                "staleApproval": true,
                "commandRan": false,
                "detectedBy": payload.get("detectedBy").cloned().unwrap_or(Value::Null),
            }));
        }
        "verify_complete" => {
            let test_result = test_result_field(payload);
            let external_test_run = has_executed_test_command(payload);
            let automated_tests_passed = test_result == Some("pass") && external_test_run;
            let test_evidence_strength = if external_test_run {
                "concrete"
            } else if matches!(test_result, Some("pass" | "fail")) {
                "weak_signal"
            } else {
                "none"
            };
            return Some(json!({
                "schemaVersion": 1,
                "concreteEvidence": automated_tests_passed,
                "aiSelfReport": payload.get("intent_match").and_then(Value::as_bool).unwrap_or(false),
                "automatedTestsPassed": automated_tests_passed,
                "externalTestRun": external_test_run,
                "testResult": test_result,
                "testCommandPresent": test_command_present(payload),
                "testExitCode": payload.get("test_exit_code").or_else(|| payload.get("testExitCode")).cloned().unwrap_or(Value::Null),
                "testEvidenceStrength": test_evidence_strength,
            }));
        }
        "verify_start" => {
            return Some(json!({
                "schemaVersion": 1,
                "verificationStarted": true,
            }));
        }
        VERIFICATION_COACH_REQUESTED_EVENT => {
            return payload.get("evidenceSummary").cloned();
        }
        VERIFICATION_COACH_EVALUATED_EVENT => {
            return Some(json!({
                "schemaVersion": 1,
                "coachGuidance": string_field(payload, "status"),
                "reasonCode": string_field(payload, "reasonCode"),
                "aiGuidanceIsEvidence": false,
            }));
        }
        VERIFICATION_OBSERVATION_RECORDED_EVENT => {
            let criterion_count = payload
                .get("criterionIds")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0);
            let observation_present = string_field(payload, "observationText")
                .is_some_and(|text| !text.trim().is_empty());
            return Some(json!({
                "schemaVersion": 1,
                "concreteEvidence": criterion_count > 0 && observation_present,
                "aiSelfReport": false,
                "automatedTestsPassed": false,
                "externalTestRun": false,
                "testResult": "skipped",
                "manualEvidenceCount": if criterion_count > 0 && observation_present { 1 } else { 0 },
                "observationIds": payload.get("observationId").and_then(Value::as_str).map(|id| json!([id])).unwrap_or_else(|| json!([])),
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
        "tool_call_start" if secret_flagged(payload) => {
            return Some(json!({
                "schemaVersion": 1,
                "secretFlagged": true,
                "wholeFileOverwrite": payload
                    .get("approvalWarnings")
                    .and_then(|warnings| warnings.get("wholeFileOverwrite"))
                    .cloned()
                    .unwrap_or(Value::Null),
            }));
        }
        "tool_approve" => {
            return Some(json!({
                "schemaVersion": 1,
                "permissionReviewed": true,
                "riskAccepted": has_risk_reason(payload),
                "highRiskFileCount": high_risk_file_count(payload),
                "readGateSatisfied": read_gate_satisfied(payload),
                "secretFlagged": secret_flagged(payload),
                "warningKinds": payload
                    .get("approval_metadata")
                    .and_then(|metadata| metadata.get("warningKinds"))
                    .cloned()
                    .unwrap_or_else(|| json!([])),
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
                "planGenerated": event_type == PLAN_GENERATED_EVENT,
                "planApproved": event_type == "plan_approved",
                "planStepOpened": event_type == "plan_step_opened",
                "planStepBlocked": event_type == "plan_step_open_failed",
                "planStepAppended": event_type == "plan_step_appended",
                "planStepChanged": event_type == PLAN_STEP_CHANGED_EVENT,
                "planStepRetired": event_type == PLAN_STEP_RETIRED_EVENT,
                "planStepRationaleChallenged": event_type == PLAN_STEP_RATIONALE_CHALLENGED_EVENT,
                "planAdjustmentOffered": event_type == PLAN_ADJUSTMENT_OFFERED_EVENT,
                "planAdjustmentAccepted": event_type == PLAN_ADJUSTMENT_ACCEPTED_EVENT,
                "planAdjustmentDismissed": event_type == PLAN_ADJUSTMENT_DISMISSED_EVENT,
            }));
        }
        _ if event_type.starts_with("prd_") => {
            return Some(json!({
                "schemaVersion": 1,
                "projectSpecLifecycle": true,
                "patchProposed": event_type == PRD_PATCH_PROPOSED_EVENT,
                "patchApplied": event_type == PRD_PATCH_APPLIED_EVENT,
                "patchRejected": event_type == PRD_PATCH_REJECTED_EVENT,
                "versionCreated": event_type == PRD_VERSION_CREATED_EVENT,
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
    let evidence = payload
        .get("evidence")
        .or_else(|| payload.get("evidenceRefs"))?
        .as_array()?;
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

    let verification_evidence_count = evidence
        .iter()
        .filter(|item| {
            item.get("verificationEvidence")
                .or_else(|| item.get("verification_evidence"))
                .and_then(Value::as_bool)
                == Some(true)
        })
        .count();

    Some(json!({
        "schemaVersion": 1,
        "count": evidence.len(),
        "labels": labels,
        "sources": sources,
        "verificationEvidenceCount": verification_evidence_count,
    }))
}

fn infer_decision(event_type: &str, payload: &Value) -> Option<Value> {
    match event_type {
        SUPERVISOR_EVALUATED_EVENT => {
            return Some(json!({
                "kind": "supervisor_evaluation",
                "event": payload.get("event").cloned().unwrap_or(Value::Null),
                "validationOutcome": payload
                    .get("validationOutcome")
                    .cloned()
                    .unwrap_or(Value::Null),
                "dropReason": payload.get("dropReason").cloned().unwrap_or(Value::Null),
                "cardId": payload.get("cardId").cloned().unwrap_or(Value::Null),
            }));
        }
        RUNTIME_CAPABILITY_EVALUATED_EVENT => {
            return Some(json!({
                "kind": "runtime_capability",
                "status": payload.get("status").cloned().unwrap_or(Value::Null),
                "reasonCode": payload.get("reason_code").cloned().unwrap_or(Value::Null),
            }));
        }
        RUNTIME_ROUTING_DECISION_EVENT => {
            return Some(json!({
                "kind": "runtime_routing",
                "outcome": payload.get("outcome").cloned().unwrap_or(Value::Null),
                "reasonCode": payload.get("reasonCode").cloned().unwrap_or(Value::Null),
            }));
        }
        PREVIEW_OPEN_REQUESTED_EVENT => return Some(json!({ "kind": "preview_requested" })),
        PREVIEW_OPEN_RESULT_EVENT => {
            return Some(json!({
                "kind": "preview_result",
                "status": payload.get("status").cloned().unwrap_or(Value::Null),
                "reasonCode": payload.get("reasonCode").cloned().unwrap_or(Value::Null),
            }));
        }
        PROJECT_COMMAND_RESULT_EVENT => return Some(json!({ "kind": "project_command_result" })),
        TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT => {
            return Some(json!({ "kind": "terminal_script_approval_requested" }));
        }
        TERMINAL_SCRIPT_RESULT_EVENT => return Some(json!({ "kind": "terminal_script_result" })),
        TOOL_APPROVAL_STALE_EVENT => return Some(json!({ "kind": "tool_approval_stale" })),
        "checkpoint_create" => return Some(json!({ "kind": "create_checkpoint" })),
        "checkpoint_restore" => return Some(json!({ "kind": "restore_checkpoint" })),
        "tool_approve" => {
            let outcome = if secret_flagged(payload) {
                "secret_flagged"
            } else if read_gate_satisfied(payload) {
                "read_gate_satisfied"
            } else {
                "approved"
            };
            return Some(json!({
                "kind": "approve_tool",
                "outcome": outcome,
            }));
        }
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
        || matches!(
            event_type,
            "tool_approve" | "card_update" | TERMINAL_SCRIPT_APPROVAL_REQUESTED_EVENT
        );
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

#[allow(clippy::too_many_arguments)]
pub fn runtime_capability_evaluated_payload(
    status: impl Into<String>,
    provider_kind: impl Into<String>,
    model: Option<String>,
    reason_code: Option<String>,
    setup_action: Option<String>,
    message: impl Into<String>,
    created_at: i64,
) -> Value {
    redact_value(&json!({
        "status": status.into(),
        "provider_kind": provider_kind.into(),
        "model": model,
        "reason_code": reason_code,
        "setup_action": setup_action,
        "message": message.into(),
        "created_at": created_at,
    }))
}

pub fn runtime_event_payload(value: Value) -> Value {
    redact_value(&value)
}

pub fn runtime_routing_decision_payload(
    decision: &crate::tools::runtime::RuntimeRoutingDecision,
) -> Value {
    runtime_event_payload(serde_json::to_value(decision).unwrap_or(Value::Null))
}

pub fn preview_open_requested_payload(request: &crate::tools::runtime::PreviewRequest) -> Value {
    let mut value = serde_json::to_value(request).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut value {
        if let Some(target) = map.remove("target") {
            map.insert("targetLabel".into(), target);
        }
    }
    runtime_event_payload(value)
}

pub fn preview_open_result_payload(session: &crate::tools::runtime::PreviewSession) -> Value {
    runtime_event_payload(serde_json::to_value(session).unwrap_or(Value::Null))
}

pub fn execution_evidence_payload(evidence: &crate::tools::runtime::ExecutionEvidence) -> Value {
    runtime_event_payload(serde_json::to_value(evidence).unwrap_or(Value::Null))
}

pub fn stale_approval_payload(stale: &crate::tools::runtime::StaleApprovalState) -> Value {
    runtime_event_payload(serde_json::to_value(stale).unwrap_or(Value::Null))
}

pub fn prd_patch_proposed_payload(
    project_id: i64,
    project_spec_id: impl Into<String>,
    draft_id: impl Into<String>,
    turn_id: impl Into<String>,
    patch_id: impl Into<String>,
    operation_kinds: Vec<String>,
    rationale_summary: Option<String>,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "project_spec_id": project_spec_id.into(),
        "draft_id": draft_id.into(),
        "turn_id": turn_id.into(),
        "patch_id": patch_id.into(),
        "operation_kinds": operation_kinds,
        "rationale_summary": rationale_summary,
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn prd_patch_applied_payload(
    project_id: i64,
    project_spec_id: impl Into<String>,
    draft_id: impl Into<String>,
    turn_id: impl Into<String>,
    patch_id: impl Into<String>,
    applied_field_paths: Vec<String>,
    criterion_ids_assigned: Vec<String>,
    student_edited_fields_respected: Vec<String>,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "project_spec_id": project_spec_id.into(),
        "draft_id": draft_id.into(),
        "turn_id": turn_id.into(),
        "patch_id": patch_id.into(),
        "applied_field_paths": applied_field_paths,
        "criterion_ids_assigned": criterion_ids_assigned,
        "student_edited_fields_respected": student_edited_fields_respected,
    }))
}

pub fn prd_patch_rejected_payload(
    project_id: i64,
    project_spec_id: impl Into<String>,
    draft_id: impl Into<String>,
    turn_id: impl Into<String>,
    patch_id: impl Into<String>,
    reason_codes: Vec<String>,
    held_for_student: bool,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "project_spec_id": project_spec_id.into(),
        "draft_id": draft_id.into(),
        "turn_id": turn_id.into(),
        "patch_id": patch_id.into(),
        "reason_codes": reason_codes,
        "held_for_student": held_for_student,
    }))
}

pub fn prd_authored_payload(
    project_id: i64,
    project_spec_id: impl Into<String>,
    version: i64,
    criterion_ids: Vec<String>,
    summary: impl Into<String>,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "project_spec_id": project_spec_id.into(),
        "version": version,
        "source": "interview",
        "criterion_ids": criterion_ids,
        "summary": summary.into(),
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn prd_edited_payload(
    project_id: i64,
    project_spec_id: impl Into<String>,
    from_version: i64,
    to_version: i64,
    reason: impl Into<String>,
    changed_fields: Vec<String>,
    criterion_ids_added: Vec<String>,
    criterion_ids_retired: Vec<String>,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "project_spec_id": project_spec_id.into(),
        "from_version": from_version,
        "to_version": to_version,
        "reason": reason.into(),
        "changed_fields": changed_fields,
        "criterion_ids_added": criterion_ids_added,
        "criterion_ids_retired": criterion_ids_retired,
    }))
}

pub fn prd_version_created_payload(
    project_id: i64,
    project_spec_id: impl Into<String>,
    version: i64,
    previous_version: Option<i64>,
    delta_summary: Value,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "project_spec_id": project_spec_id.into(),
        "version": version,
        "previous_version": previous_version,
        "delta_summary": delta_summary,
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn plan_step_rationale_challenged_payload(
    project_id: i64,
    plan_id: i64,
    step_id: i64,
    stable_step_id: impl Into<String>,
    linked_criterion_ids: Vec<String>,
    objection_id: impl Into<String>,
    objection_summary: impl Into<String>,
    suggestion_status: impl Into<String>,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "plan_id": plan_id,
        "step_id": step_id,
        "stable_step_id": stable_step_id.into(),
        "linked_criterion_ids": linked_criterion_ids,
        "objection_id": objection_id.into(),
        "objection_summary": objection_summary.into(),
        "suggestion_status": suggestion_status.into(),
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn plan_adjustment_offered_payload(
    project_id: i64,
    plan_id: i64,
    step_id: i64,
    stable_step_id: impl Into<String>,
    objection_id: impl Into<String>,
    offer_id: impl Into<String>,
    offer_kind: impl Into<String>,
    offer_summary: impl Into<String>,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "plan_id": plan_id,
        "step_id": step_id,
        "stable_step_id": stable_step_id.into(),
        "objection_id": objection_id.into(),
        "offer_id": offer_id.into(),
        "offer_kind": offer_kind.into(),
        "offer_summary": offer_summary.into(),
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn plan_adjustment_response_payload(
    project_id: i64,
    plan_id: i64,
    step_id: i64,
    stable_step_id: impl Into<String>,
    objection_id: impl Into<String>,
    offer_id: impl Into<String>,
    response: impl Into<String>,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "plan_id": plan_id,
        "step_id": step_id,
        "stable_step_id": stable_step_id.into(),
        "objection_id": objection_id.into(),
        "offer_id": offer_id.into(),
        "response": response.into(),
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn plan_generated_payload(
    project_id: i64,
    plan_id: i64,
    project_spec_id: impl Into<String>,
    project_spec_version: i64,
    step_count: usize,
    criterion_coverage: Value,
    source: impl Into<String>,
) -> Value {
    redact_value(&json!({
        "project_id": project_id,
        "plan_id": plan_id,
        "project_spec_id": project_spec_id.into(),
        "project_spec_version": project_spec_version,
        "step_count": step_count,
        "criterion_coverage": criterion_coverage,
        "source": source.into(),
    }))
}

pub fn plan_step_appended_payload(
    mutation_id: impl Into<String>,
    project_spec_id: impl Into<String>,
    from_project_spec_version: i64,
    to_project_spec_version: i64,
    linked_criterion_ids: Vec<String>,
    scope_expansion: Value,
    prd_delta_summary: Value,
) -> Value {
    redact_value(&json!({
        "mutation_id": mutation_id.into(),
        "project_spec_id": project_spec_id.into(),
        "from_project_spec_version": from_project_spec_version,
        "to_project_spec_version": to_project_spec_version,
        "linked_criterion_ids": linked_criterion_ids,
        "scope_expansion": scope_expansion,
        "prd_delta_summary": prd_delta_summary,
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn plan_step_changed_payload(
    mutation_id: impl Into<String>,
    project_id: i64,
    plan_id: i64,
    step_id: i64,
    stable_step_id: impl Into<String>,
    changed_fields: Vec<String>,
    linked_criterion_ids: Vec<String>,
    from_project_spec_version: i64,
    to_project_spec_version: i64,
) -> Value {
    redact_value(&json!({
        "mutation_id": mutation_id.into(),
        "project_id": project_id,
        "plan_id": plan_id,
        "step_id": step_id,
        "stable_step_id": stable_step_id.into(),
        "changed_fields": changed_fields,
        "linked_criterion_ids": linked_criterion_ids,
        "from_project_spec_version": from_project_spec_version,
        "to_project_spec_version": to_project_spec_version,
    }))
}

/// S-033: emitted when a plan step is retired (soft-removed). Mirrors
/// [`plan_step_changed_payload`]; `criterion_ids_retired` records the criteria
/// the retired step had linked so the export can reconstruct active/retired
/// criterion coverage.
#[allow(clippy::too_many_arguments)]
pub fn plan_step_retired_payload(
    mutation_id: impl Into<String>,
    project_id: i64,
    plan_id: i64,
    step_id: i64,
    stable_step_id: impl Into<String>,
    criterion_ids_retired: Vec<String>,
    from_project_spec_version: i64,
    to_project_spec_version: i64,
) -> Value {
    redact_value(&json!({
        "mutation_id": mutation_id.into(),
        "project_id": project_id,
        "plan_id": plan_id,
        "step_id": step_id,
        "stable_step_id": stable_step_id.into(),
        "criterion_ids_retired": criterion_ids_retired,
        "from_project_spec_version": from_project_spec_version,
        "to_project_spec_version": to_project_spec_version,
    }))
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
    let redacted = EMAIL_RE.replace_all(&redacted, "[REDACTED_PII]");
    redact_phone_like_tokens(&redacted)
}

fn redact_phone_like_tokens(text: &str) -> String {
    text.split_whitespace()
        .map(|token| {
            let normalized = token.trim_matches(|ch: char| {
                matches!(
                    ch,
                    ',' | '.' | ':' | ';' | '(' | ')' | '[' | ']' | '"' | '\''
                )
            });
            let digits = normalized.chars().filter(|ch| ch.is_ascii_digit()).count();
            let phone_like =
                digits >= 10 && (normalized.starts_with("010") || normalized.starts_with('+'));
            if phone_like {
                "[REDACTED_PII]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
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
    // S-034: secret-DETECTION metadata (a boolean flag and a list of categorical
    // reasons like "env_file"/"named_secret"), never a secret value. Keep them in
    // the evidence trail — the secret literal itself lives in raw-text fields
    // (e.g. params_preview/content) and is still redacted by redact_text.
    if matches!(normalized.as_str(), "secretflagged" | "secretreasons") {
        return false;
    }
    normalized.contains("apikey")
        || normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("authorization")
        || normalized.contains("password")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dive::{
        ArtifactRef, EvidenceRef, SourceUiMode, SupervisorDecisionSummary, SupervisorDropReason,
        SupervisorEvent, SupervisorMode, SupervisorValidationOutcome,
    };

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
    fn prd_lifecycle_event_payload_builders_redact_required_fields() {
        let proposed = prd_patch_proposed_payload(
            1,
            "prd-1",
            "draft-1",
            "turn-1",
            "patch-1",
            vec!["set_goal".into(), "append_acceptance_criterion".into()],
            Some("Student mentioned api_key=sk-secret-token".into()),
        );

        assert_eq!(proposed["project_id"], 1);
        assert_eq!(proposed["project_spec_id"], "prd-1");
        assert_eq!(
            proposed["operation_kinds"][1],
            "append_acceptance_criterion"
        );
        assert!(!proposed.to_string().contains("sk-secret-token"));
        assert!(proposed.to_string().contains("[REDACTED_SECRET]"));

        let applied = prd_patch_applied_payload(
            1,
            "prd-1",
            "draft-1",
            "turn-1",
            "patch-1",
            vec!["goal".into(), "acceptanceCriteria".into()],
            vec!["AC-001".into()],
            vec!["constraints".into()],
        );
        assert_eq!(applied["criterion_ids_assigned"][0], "AC-001");
        assert_eq!(applied["student_edited_fields_respected"][0], "constraints");
    }

    #[test]
    fn plan_mutation_payload_builders_carry_export_reconstruction_fields() {
        let generated = plan_generated_payload(
            1,
            2,
            "prd-1",
            3,
            2,
            json!({
                "total_criterion_count": 2,
                "covered_criterion_ids": ["AC-001"],
                "uncovered_criterion_ids": ["AC-002"],
                "step_links": [{"stable_step_id": "step-001", "linked_criterion_ids": ["AC-001"]}]
            }),
            "interview",
        );
        assert_eq!(generated["project_id"], 1);
        assert_eq!(generated["plan_id"], 2);
        assert_eq!(generated["project_spec_id"], "prd-1");
        assert_eq!(generated["project_spec_version"], 3);
        assert_eq!(generated["step_count"], 2);
        assert_eq!(
            generated["criterion_coverage"]["covered_criterion_ids"][0],
            "AC-001"
        );
        assert_eq!(generated["source"], "interview");

        let appended = plan_step_appended_payload(
            "mut-1",
            "prd-1",
            1,
            2,
            vec!["AC-001".into()],
            json!({"expanded": false, "reasonCodes": [], "evidenceRefs": ["AC-001"]}),
            json!({"scopeChanges": ["Added persistence"]}),
        );

        assert_eq!(appended["mutation_id"], "mut-1");
        assert_eq!(appended["project_spec_id"], "prd-1");
        assert_eq!(appended["from_project_spec_version"], 1);
        assert_eq!(appended["to_project_spec_version"], 2);
        assert_eq!(appended["linked_criterion_ids"][0], "AC-001");

        let challenged = plan_step_rationale_challenged_payload(
            1,
            2,
            3,
            "step-001",
            vec!["AC-001".into()],
            "obj-1",
            "Why is this a separate step?",
            "offered",
        );
        assert_eq!(challenged["objection_id"], "obj-1");
        assert_eq!(challenged["suggestion_status"], "offered");
    }

    #[test]
    fn runtime_capability_payload_builder_carries_unavailable_reason_codes() {
        let payload = runtime_capability_evaluated_payload(
            "unavailable",
            "opencode_zen",
            Some("zen-model".into()),
            Some("provider_not_pi_capable".into()),
            Some("choose_supported_provider".into()),
            "Provider token=secret-token-123 is not Pi capable",
            1234,
        );

        assert_eq!(payload["status"], "unavailable");
        assert_eq!(payload["provider_kind"], "opencode_zen");
        assert_eq!(payload["reason_code"], "provider_not_pi_capable");
        assert_eq!(payload["setup_action"], "choose_supported_provider");
        assert!(!payload.to_string().contains("secret-token-123"));
        assert!(payload.to_string().contains("[REDACTED_SECRET]"));

        let enriched = enrich_agency_payload(RUNTIME_CAPABILITY_EVALUATED_EVENT, payload);
        assert_eq!(enriched["agencyComponent"], "action");
        assert_eq!(enriched["agencyState"], "runtime_unavailable");
        assert_eq!(enriched["decision"]["kind"], "runtime_capability");
    }

    #[test]
    fn plan_adjustment_payload_builders_cover_offer_responses() {
        let offered = plan_adjustment_offered_payload(
            1,
            2,
            3,
            "step-001",
            "obj-1",
            "offer-1",
            "adjust_plan",
            "Student email minji@example.com asked to narrow scope",
        );
        assert_eq!(offered["offer_id"], "offer-1");
        assert_eq!(offered["offer_kind"], "adjust_plan");
        assert!(!offered.to_string().contains("minji@example.com"));

        let enriched = enrich_agency_payload(PLAN_ADJUSTMENT_OFFERED_EVENT, offered);
        assert_eq!(enriched["agencyComponent"], "plan");
        assert_eq!(enriched["evidenceSummary"]["planAdjustmentOffered"], true);

        let accepted =
            plan_adjustment_response_payload(1, 2, 3, "step-001", "obj-1", "offer-1", "accepted");
        assert_eq!(accepted["response"], "accepted");
        assert_eq!(
            enrich_agency_payload(PLAN_ADJUSTMENT_ACCEPTED_EVENT, accepted)["evidenceSummary"]
                ["planAdjustmentAccepted"],
            true
        );

        let dismissed =
            plan_adjustment_response_payload(1, 2, 3, "step-001", "obj-1", "offer-1", "dismissed");
        assert_eq!(
            enrich_agency_payload(PLAN_ADJUSTMENT_DISMISSED_EVENT, dismissed)["evidenceSummary"]
                ["planAdjustmentDismissed"],
            true
        );
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
    fn agency_enrichment_requires_executed_command_for_automated_pass_evidence() {
        let static_pass = enrich_agency_payload(
            "verify_complete",
            json!({
                "card_id": 7,
                "intent_match": true,
                "test_result": "pass"
            }),
        );

        assert_eq!(static_pass["agencyState"], "ai_self_report_only");
        assert_eq!(static_pass["evidenceSummary"]["concreteEvidence"], false);
        assert_eq!(
            static_pass["evidenceSummary"]["automatedTestsPassed"],
            false
        );
        assert_eq!(static_pass["evidenceSummary"]["externalTestRun"], false);
        assert_eq!(
            static_pass["evidenceSummary"]["testEvidenceStrength"],
            "weak_signal"
        );

        let command_without_exit = enrich_agency_payload(
            "verify_complete",
            json!({
                "card_id": 8,
                "intent_match": true,
                "test_result": "pass",
                "test_command_present": true
            }),
        );

        assert_eq!(command_without_exit["agencyState"], "ai_self_report_only");
        assert_eq!(
            command_without_exit["evidenceSummary"]["concreteEvidence"],
            false
        );
        assert_eq!(
            command_without_exit["evidenceSummary"]["testEvidenceStrength"],
            "weak_signal"
        );

        let executed_pass = enrich_agency_payload(
            "verify_complete",
            json!({
                "card_id": 9,
                "intent_match": true,
                "test_result": "pass",
                "test_command_present": true,
                "test_exit_code": 0
            }),
        );

        assert_eq!(executed_pass["agencyState"], "verified_with_evidence");
        assert_eq!(executed_pass["evidenceSummary"]["concreteEvidence"], true);
        assert_eq!(
            executed_pass["evidenceSummary"]["automatedTestsPassed"],
            true
        );
        assert_eq!(executed_pass["evidenceSummary"]["externalTestRun"], true);
        assert_eq!(
            executed_pass["evidenceSummary"]["testEvidenceStrength"],
            "concrete"
        );

        let executed_fail = enrich_agency_payload(
            "verify_complete",
            json!({
                "card_id": 10,
                "intent_match": true,
                "test_result": "fail",
                "test_command_present": true,
                "test_exit_code": 1
            }),
        );

        assert_eq!(executed_fail["agencyState"], "verification_failed");
        assert_eq!(executed_fail["evidenceSummary"]["concreteEvidence"], false);
        assert_eq!(executed_fail["evidenceSummary"]["externalTestRun"], true);
        assert_eq!(
            executed_fail["evidenceSummary"]["testEvidenceStrength"],
            "concrete"
        );
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

    fn supervisor_log(
        validation_outcome: SupervisorValidationOutcome,
        drop_reason: Option<SupervisorDropReason>,
        card_id: Option<&str>,
    ) -> SupervisorEvaluationLog {
        SupervisorEvaluationLog {
            schema_version: 1,
            event: SupervisorEvent::VerifyEntered,
            artifact_ref: ArtifactRef::step("step-3", "Add todo item form"),
            context_hash: "sha256:context".into(),
            evidence_hash: "sha256:evidence".into(),
            mode: SupervisorMode::Work,
            source_ui_mode: Some(SourceUiMode::Standard),
            evidence_refs: vec![EvidenceRef::assistant_claim()],
            supervisor_model: Some("openai-codex/gpt-5.4-mini".into()),
            latency_ms: Some(812),
            usage: None,
            decision_summary: Some(SupervisorDecisionSummary {
                provoke: validation_outcome == SupervisorValidationOutcome::Shown,
                concern: "ai_self_report_only".into(),
                severity: "caution".into(),
                evidence_ref_ids: vec!["agent.assistant_claim".into()],
                suggested_action_ids: vec!["open_diff".into()],
                stripped_action_ids: vec![],
            }),
            assessment_summary: None,
            validation_outcome,
            drop_reason,
            card_id: card_id.map(str::to_owned),
            user_response: None,
        }
    }

    #[test]
    fn supervisor_evaluation_append_enriches_shown_payload() {
        let (db, _) = crate::db::tests::fresh_db();
        let (_, session_id) = crate::db::tests::seed_project_session(db.conn());
        let row_id = append_supervisor_evaluation_to_conn(
            db.conn(),
            session_id,
            "eval-1",
            &supervisor_log(
                SupervisorValidationOutcome::Shown,
                None,
                Some("provocation:step-3:ai_self_report_only:sha256:evidence"),
            ),
        )
        .unwrap();
        let row = event_log_dao::get_by_id(db.conn(), row_id)
            .unwrap()
            .unwrap();

        assert_eq!(row.r#type, SUPERVISOR_EVALUATED_EVENT);
        assert_eq!(row.payload["supervisorEvaluationId"], json!("eval-1"));
        assert_eq!(row.payload["validationOutcome"], json!("shown"));
        assert_eq!(row.payload["contextHash"], json!("sha256:context"));
        assert_eq!(row.payload["evidenceHash"], json!("sha256:evidence"));
        assert_eq!(
            row.payload["cardId"],
            json!("provocation:step-3:ai_self_report_only:sha256:evidence")
        );
        assert_eq!(row.payload["agencyComponent"], json!("verify"));
        assert_eq!(row.payload["agencyState"], json!("ai_self_report_only"));
        assert_eq!(row.payload["evidenceSummary"]["count"], json!(1));
        assert_eq!(row.payload["evidenceSummary"]["sources"], json!(["agent"]));
        assert_eq!(
            row.payload["decision"],
            json!({
                "kind": "supervisor_evaluation",
                "event": "verify_entered",
                "validationOutcome": "shown",
                "dropReason": null,
                "cardId": "provocation:step-3:ai_self_report_only:sha256:evidence"
            })
        );
    }

    #[test]
    fn scope_supervisor_evaluation_append_enriches_plan_payload() {
        let (db, _) = crate::db::tests::fresh_db();
        let (_, session_id) = crate::db::tests::seed_project_session(db.conn());
        let log = SupervisorEvaluationLog {
            schema_version: 1,
            event: SupervisorEvent::ScopeExpansion,
            artifact_ref: ArtifactRef::add_step_draft("draft-1", "Add analytics dashboard"),
            context_hash: "sha256:scope-context".into(),
            evidence_hash: "sha256:scope-evidence".into(),
            mode: SupervisorMode::Work,
            source_ui_mode: Some(SourceUiMode::Standard),
            evidence_refs: vec![EvidenceRef::scope_expansion_reason(
                vec!["missing_criterion_link".into()],
                vec!["add_step.title".into()],
            )],
            supervisor_model: Some("openai-codex/gpt-5.4-mini".into()),
            latency_ms: Some(100),
            usage: None,
            decision_summary: Some(SupervisorDecisionSummary {
                provoke: true,
                concern: "scope_expansion".into(),
                severity: "caution".into(),
                evidence_ref_ids: vec!["scope.assessment".into()],
                suggested_action_ids: vec!["link_criterion".into()],
                stripped_action_ids: vec![],
            }),
            assessment_summary: Some(json!({
                "reasonCodes": ["missing_criterion_link"],
                "evidenceRefs": ["add_step.title"]
            })),
            validation_outcome: SupervisorValidationOutcome::Shown,
            drop_reason: None,
            card_id: Some("provocation:draft-1:scope_expansion:sha256:scope-evidence".into()),
            user_response: None,
        };
        let row_id =
            append_supervisor_evaluation_to_conn(db.conn(), session_id, "scope-eval-1", &log)
                .unwrap();
        let row = event_log_dao::get_by_id(db.conn(), row_id)
            .unwrap()
            .unwrap();

        assert_eq!(row.payload["event"], "scope_expansion");
        assert_eq!(row.payload["agencyComponent"], "plan");
        assert_eq!(row.payload["agencyState"], "plan_review_needed");
        assert_eq!(row.payload["decision"]["event"], "scope_expansion");
        assert_eq!(row.payload["decision"]["validationOutcome"], "shown");
    }

    #[test]
    fn expanded_supervisor_evaluation_append_enriches_plan_drafted_payload() {
        let enriched = enrich_agency_payload(
            SUPERVISOR_EVALUATED_EVENT,
            json!({
                "schemaVersion": 1,
                "event": "plan_drafted",
                "artifactRef": {"kind": "plan_draft", "id": "plan-1:draft", "label": "Plan draft"},
                "validationOutcome": "shown",
                "dropReason": null,
                "cardId": "provocation:plan-1:plan_draft_weakness:sha256:evidence",
                "evidenceRefs": [
                    {
                        "id": "plan.step.s_001.verification",
                        "source": "plan",
                        "kind": "verification_coverage",
                        "label": "Missing verification",
                        "verificationEvidence": false
                    }
                ]
            }),
        );

        assert_eq!(enriched["agencyComponent"], "plan");
        assert_eq!(enriched["agencyState"], "plan_review_needed");
        assert_eq!(enriched["evidenceSummary"]["count"], 1);
        assert_eq!(enriched["decision"]["event"], "plan_drafted");
    }

    #[test]
    fn expanded_supervisor_evaluation_rows_preserve_audit_correlation_fields() {
        let (db, _) = crate::db::tests::fresh_db();
        let (_, session_id) = crate::db::tests::seed_project_session(db.conn());
        let cases = [
            json!({
                "schemaVersion": 1,
                "event": "plan_drafted",
                "artifactRef": {"kind": "plan_draft", "id": "plan-1:draft", "label": "Plan draft"},
                "contextHash": "fnv1a:plan-context",
                "evidenceHash": "fnv1a:plan-evidence",
                "validationOutcome": "shown",
                "dropReason": null,
                "cardId": "provocation:plan-1:plan_draft_weakness:sha256:evidence",
                "supervisorEvaluationId": "eval-plan",
                "decisionSummary": {
                    "provoke": true,
                    "concern": "plan_draft_weakness",
                    "severity": "caution",
                    "evidenceRefIds": ["plan.step.s_001.verification"],
                    "suggestedActionIds": ["add_verification_step"],
                    "strippedActionIds": []
                },
                "assessmentSummary": {
                    "reasonCodes": ["missing_verification"],
                    "evidenceRefs": ["plan.step.s_001.verification"]
                },
                "evidenceRefs": [{
                    "id": "plan.step.s_001.verification",
                    "source": "plan",
                    "kind": "verification_coverage",
                    "label": "Missing verification",
                    "verificationEvidence": false
                }]
            }),
            json!({
                "schemaVersion": 1,
                "event": "diff_ready",
                "artifactRef": {"kind": "diff", "id": "step-1:diff", "label": "Changed work"},
                "contextHash": "fnv1a:diff-context",
                "evidenceHash": "fnv1a:diff-evidence",
                "validationOutcome": "none",
                "dropReason": "provoke_false",
                "cardId": null,
                "supervisorEvaluationId": "eval-diff",
                "decisionSummary": {
                    "provoke": false,
                    "concern": "diff_scope_drift",
                    "severity": "caution",
                    "evidenceRefIds": ["diff.changed_files"],
                    "suggestedActionIds": ["open_diff"],
                    "strippedActionIds": []
                },
                "assessmentSummary": {
                    "reasonCodes": [],
                    "evidenceRefs": ["diff.changed_files"],
                    "changedFileCount": 1,
                    "unexpectedFiles": ["src/auth/session.ts"],
                    "highRiskFiles": ["src/auth/session.ts"]
                },
                "evidenceRefs": [{
                    "id": "diff.changed_files",
                    "source": "diff",
                    "kind": "changed_file",
                    "label": "Changed files",
                    "verificationEvidence": false
                }]
            }),
            json!({
                "schemaVersion": 1,
                "event": "retry_loop",
                "artifactRef": {"kind": "failure", "id": "step-1:failure", "label": "Repeated failure"},
                "contextHash": "fnv1a:retry-context",
                "evidenceHash": "fnv1a:retry-evidence",
                "validationOutcome": "dropped",
                "dropReason": "runtime_unavailable",
                "cardId": null,
                "supervisorEvaluationId": "eval-retry",
                "decisionSummary": {
                    "provoke": true,
                    "concern": "retry_loop",
                    "severity": "caution",
                    "evidenceRefIds": ["failure.fingerprint"],
                    "suggestedActionIds": ["create_repro_steps"],
                    "strippedActionIds": []
                },
                "assessmentSummary": {
                    "reasonCodes": ["same_failure_repeated"],
                    "evidenceRefs": ["failure.fingerprint"],
                    "failureFingerprint": "typeerror_at_save",
                    "failureCount": 2
                },
                "evidenceRefs": [{
                    "id": "failure.fingerprint",
                    "source": "terminal",
                    "kind": "failure_summary",
                    "label": "Failure fingerprint",
                    "verificationEvidence": false
                }]
            }),
        ];

        for payload in cases {
            let row_id = append_to_conn(
                db.conn(),
                Some(session_id),
                SUPERVISOR_EVALUATED_EVENT,
                payload,
            )
            .unwrap();
            let row = event_log_dao::get_by_id(db.conn(), row_id)
                .unwrap()
                .unwrap();
            assert!(row.payload.get("supervisorEvaluationId").is_some());
            assert!(row.payload.get("artifactRef").is_some());
            assert!(row.payload.get("evidenceRefs").is_some());
            assert!(row.payload.get("assessmentSummary").is_some());
            assert!(row.payload.get("validationOutcome").is_some());
            assert!(row.payload.get("decision").is_some());
            if row.payload["event"] == "diff_ready" {
                assert_eq!(
                    row.payload["affectedFiles"]["highRiskFiles"],
                    json!(["src/auth/session.ts"])
                );
            }
        }
    }

    #[test]
    fn supervisor_evaluation_append_preserves_none_dropped_and_error_outcomes() {
        let (db, _) = crate::db::tests::fresh_db();
        let (_, session_id) = crate::db::tests::seed_project_session(db.conn());
        let cases = [
            (
                SupervisorValidationOutcome::NoCard,
                SupervisorDropReason::ProvokeFalse,
                "none",
                "provoke_false",
            ),
            (
                SupervisorValidationOutcome::Dropped,
                SupervisorDropReason::Duplicate,
                "dropped",
                "duplicate",
            ),
            (
                SupervisorValidationOutcome::Error,
                SupervisorDropReason::ParseError,
                "error",
                "parse_error",
            ),
        ];

        for (index, (outcome, reason, expected_outcome, expected_reason)) in
            cases.into_iter().enumerate()
        {
            let row_id = append_supervisor_evaluation_to_conn(
                db.conn(),
                session_id,
                &format!("eval-{index}"),
                &supervisor_log(outcome, Some(reason), None),
            )
            .unwrap();
            let row = event_log_dao::get_by_id(db.conn(), row_id)
                .unwrap()
                .unwrap();
            assert_eq!(row.payload["validationOutcome"], json!(expected_outcome));
            assert_eq!(row.payload["dropReason"], json!(expected_reason));
            assert_eq!(row.payload["cardId"], Value::Null);
            assert_eq!(row.payload["agencyComponent"], json!("verify"));
            assert_eq!(row.payload["agencyState"], json!("verification_needed"));
            assert_eq!(
                row.payload["decision"]["validationOutcome"],
                json!(expected_outcome)
            );
        }
    }
}
