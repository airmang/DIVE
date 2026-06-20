use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::db::dao::{card as card_dao, step_session_mapping as mapping_dao};
use crate::db::models::{CardState, CheckpointRow, NewCard, NewStepSessionMapping};
use crate::dive::{apply_transition, CardTransition};

use super::{log_error_event, log_event, policy, AppState, ProviderKind};

#[tauri::command]
pub async fn card_update_instruction(
    state: State<'_, AppState>,
    card_id: i64,
    instruction: String,
) -> Result<CardState, String> {
    card_update_instruction_impl(&state, card_id, instruction)
}

#[tauri::command]
pub async fn card_update_test_command(
    state: State<'_, AppState>,
    card_id: i64,
    test_command: Option<String>,
) -> Result<(), String> {
    card_update_test_command_impl(&state, card_id, test_command)
}

pub fn card_update_instruction_impl(
    state: &AppState,
    card_id: i64,
    instruction: String,
) -> Result<CardState, String> {
    let (session_id, next_state, instruction_len) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        let trimmed = instruction.trim();
        let instruction_len = instruction.chars().count();
        let next_state = if trimmed.is_empty() {
            existing.state
        } else if existing.state == CardState::Decomposed {
            CardState::Instructed
        } else {
            existing.state
        };
        card_dao::update(
            db.conn(),
            card_id,
            &NewCard {
                session_id: existing.session_id,
                title: existing.title.clone(),
                instruction: Some(instruction),
                assist_summary: existing.assist_summary.clone(),
                acceptance_criteria: existing.acceptance_criteria.clone(),
                retrospective: existing.retrospective.clone(),
                change_summary: existing.change_summary.clone(),
                state: next_state,
                verify_log: existing.verify_log.clone(),
                changed_files: existing.changed_files.clone(),
                test_command: existing.test_command.clone(),
                approval_judgment: existing.approval_judgment.clone(),
                approval_provenance: existing.approval_provenance.clone(),
                position: existing.position,
            },
        )
        .map_err(|e| e.to_string())?;
        (existing.session_id, next_state, instruction_len)
    };
    log_event(
        state,
        Some(session_id),
        "card_update",
        serde_json::json!({
            "card_id": card_id,
            "action": "instruction",
            "instruction_len": instruction_len,
            "state": next_state,
        }),
    )?;
    Ok(next_state)
}

pub fn card_update_test_command_impl(
    state: &AppState,
    card_id: i64,
    test_command: Option<String>,
) -> Result<(), String> {
    let normalized = test_command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let session_id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        card_dao::update(
            db.conn(),
            card_id,
            &NewCard {
                session_id: existing.session_id,
                title: existing.title,
                instruction: existing.instruction,
                assist_summary: existing.assist_summary,
                acceptance_criteria: existing.acceptance_criteria,
                retrospective: existing.retrospective,
                change_summary: existing.change_summary,
                state: existing.state,
                verify_log: existing.verify_log,
                changed_files: existing.changed_files,
                test_command: normalized.clone(),
                approval_judgment: existing.approval_judgment,
                approval_provenance: existing.approval_provenance,
                position: existing.position,
            },
        )
        .map_err(|e| e.to_string())?;
        existing.session_id
    };
    log_event(
        state,
        Some(session_id),
        "card_update",
        serde_json::json!({
            "card_id": card_id,
            "action": "test_command",
            "test_command_len": normalized.as_ref().map(|s| s.chars().count()).unwrap_or(0),
        }),
    )
}

pub fn card_transition_no_checkpoint_impl(
    state: &AppState,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
    judgment: Option<crate::dive::ApprovalJudgment>,
) -> Result<CardState, String> {
    card_transition_no_checkpoint_with_provenance_impl(
        state,
        card_id,
        transition,
        approve_force,
        judgment,
        None,
    )
}

pub(super) fn card_transition_no_checkpoint_with_provenance_impl(
    state: &AppState,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
    judgment: Option<crate::dive::ApprovalJudgment>,
    client_approval_provenance: Option<Value>,
) -> Result<CardState, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let existing = card_dao::get_by_id(db.conn(), card_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("card {card_id} not found"))?;

    let judgment_gated = matches!(transition, CardTransition::Approve | CardTransition::Reject);
    if judgment_gated && policy::require_approval_judgment(state)? {
        match &judgment {
            None => {
                return Err("judgment required: choose 확인함 or 우려 있음 before approving".into())
            }
            Some(j) => {
                j.validate()?;
                use crate::dive::ApprovalOutcome::*;
                let ok = matches!(
                    (transition, j.outcome),
                    (CardTransition::Approve, Approved)
                        | (CardTransition::Approve, ApprovedWithConcern)
                        | (CardTransition::Approve, VerificationDeferred)
                        | (CardTransition::Reject, RevisionRequested)
                );
                if !ok {
                    return Err("judgment outcome does not match the requested transition".into());
                }
            }
        }
    }

    if matches!(transition, CardTransition::Approve) && !approve_force.unwrap_or(false) {
        let log_str = existing
            .verify_log
            .as_deref()
            .ok_or_else(|| "verify_log required: run card_verify first".to_string())?;
        let log = crate::dive::VerifyLog::from_json_str(log_str).map_err(|e| e.to_string())?;
        if !log.approve_eligible() {
            return Err(format!(
                "verify failed: intent_match={}, test_result={:?}. Pass approve_force=true to override.",
                log.intent_match, log.test_result
            ));
        }
    }

    let next = apply_transition(existing.state, transition).map_err(|e| e.to_string())?;
    let change_summary = if matches!(next, CardState::Verified | CardState::Extended) {
        existing
            .change_summary
            .clone()
            .or_else(|| summarize_changed_files(&existing.changed_files))
    } else {
        existing.change_summary.clone()
    };
    let approval_judgment = match (&judgment, judgment_gated) {
        (Some(j), true) => Some(j.to_json_string()),
        _ => existing.approval_judgment.clone(),
    };
    let approval_provenance = if matches!(transition, CardTransition::Approve) {
        Some(
            build_approval_provenance(
                &existing,
                judgment.as_ref(),
                client_approval_provenance.as_ref(),
            )
            .to_string(),
        )
    } else {
        existing.approval_provenance.clone()
    };
    card_dao::update(
        db.conn(),
        card_id,
        &NewCard {
            session_id: existing.session_id,
            title: existing.title,
            instruction: existing.instruction,
            assist_summary: existing.assist_summary,
            acceptance_criteria: existing.acceptance_criteria,
            retrospective: existing.retrospective,
            change_summary,
            state: next,
            verify_log: existing.verify_log,
            changed_files: existing.changed_files,
            test_command: existing.test_command,
            approval_judgment,
            approval_provenance,
            position: existing.position,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(next)
}

fn summarize_changed_files(changed_files: &Option<Value>) -> Option<String> {
    let files = changed_files.as_ref()?.as_array()?;
    let mut paths = files
        .iter()
        .filter_map(|item| {
            item.as_str()
                .or_else(|| item.get("path").and_then(|path| path.as_str()))
        })
        .take(3)
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return None;
    }
    paths.sort_unstable();
    let suffix = if files.len() > paths.len() {
        format!(" 외 {}개", files.len() - paths.len())
    } else {
        String::new()
    };
    Some(format!("변경 파일: {}{}", paths.join(", "), suffix))
}

fn build_approval_provenance(
    card: &crate::db::models::CardRow,
    judgment: Option<&crate::dive::ApprovalJudgment>,
    client_provenance: Option<&Value>,
) -> Value {
    let verify_log = card
        .verify_log
        .as_deref()
        .and_then(|raw| crate::dive::VerifyLog::from_json_str(raw).ok());
    let client_status_ids = client_status_ids(client_provenance);
    let decided_at = judgment
        .map(|j| j.decided_at)
        .or_else(|| client_provenance.and_then(|value| value.get("decidedAt")?.as_i64()));
    let mut statuses = Vec::new();

    for status_id in ["diff_reviewed", "app_launched", "preview_checked"] {
        if client_status_ids
            .iter()
            .any(|candidate| candidate == status_id)
        {
            push_status(&mut statuses, status_value(status_id, decided_at));
        }
    }

    let test_result = verify_log
        .as_ref()
        .map(|log| test_result_str(&log.test_result));
    let external_test_run = verify_log
        .as_ref()
        .is_some_and(|log| log.has_executed_test_command());
    let automated_tests_passed = verify_log
        .as_ref()
        .is_some_and(|log| log.automated_pass_evidence());
    let failed = verify_log
        .as_ref()
        .is_some_and(|log| log.automated_fail_evidence());
    let test_command_present = verify_log
        .as_ref()
        .and_then(|log| log.test_command.as_deref())
        .is_some_and(|command| !command.trim().is_empty());
    let test_exit_code = verify_log.as_ref().and_then(|log| log.test_exit_code);
    let test_evidence_strength = if external_test_run {
        "concrete"
    } else if matches!(test_result, Some("pass" | "fail")) {
        "weak_signal"
    } else {
        "none"
    };
    let manual_observation_ids = client_observation_ids(client_provenance);
    let client_manual_evidence_count = client_provenance
        .and_then(|value| value.get("evidenceSummary"))
        .and_then(|value| value.get("manualEvidenceCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let client_manual_evidence = client_status_ids
        .iter()
        .any(|candidate| candidate == "manual_observation")
        && client_manual_evidence_count > 0
        && !manual_observation_ids.is_empty();
    let concrete_evidence = automated_tests_passed || client_manual_evidence;

    if verify_log
        .as_ref()
        .map(|log| log.intent_match && !concrete_evidence)
        .unwrap_or(false)
    {
        push_status(
            &mut statuses,
            status_value("ai_self_report_only", decided_at),
        );
    }
    if automated_tests_passed {
        push_status(
            &mut statuses,
            status_value("automated_tests_passed", decided_at),
        );
    }
    if client_manual_evidence {
        push_status(
            &mut statuses,
            status_value("manual_observation", decided_at),
        );
    }
    if !external_test_run {
        push_status(
            &mut statuses,
            status_value("external_test_not_run", decided_at),
        );
    }
    if failed {
        push_status(
            &mut statuses,
            status_value("failed_but_accepted", decided_at),
        );
    }

    let approved_with_concern = judgment
        .map(|j| j.outcome == crate::dive::ApprovalOutcome::ApprovedWithConcern)
        .unwrap_or(false);
    let verification_deferred = judgment
        .map(|j| j.outcome == crate::dive::ApprovalOutcome::VerificationDeferred)
        .unwrap_or(false)
        || client_status_ids
            .iter()
            .any(|candidate| candidate == "verification_deferred")
        || client_provenance
            .and_then(|value| value.get("approvalOutcome"))
            .and_then(Value::as_str)
            == Some("verification_deferred");
    let client_marked_risk = client_status_ids
        .iter()
        .any(|candidate| candidate == "approved_with_risk");
    let risk_accepted = !verification_deferred
        && (failed || !concrete_evidence || approved_with_concern || client_marked_risk);
    if risk_accepted {
        push_status(
            &mut statuses,
            status_value("approved_with_risk", decided_at),
        );
    }
    if verification_deferred {
        push_status(
            &mut statuses,
            status_value("verification_deferred", decided_at),
        );
    }

    let status_ids = statuses
        .iter()
        .filter_map(|status| status.get("id").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let evidence_labels = statuses
        .iter()
        .filter(|status| status.get("evidenceBacked").and_then(Value::as_bool) == Some(true))
        .filter_map(|status| status.get("label").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let risk_reason = judgment
        .and_then(|j| j.note.as_deref())
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            client_provenance
                .and_then(|value| value.get("riskReason")?.as_str())
                .map(str::trim)
                .filter(|note| !note.is_empty())
                .map(str::to_owned)
        });
    let verification_state = if failed {
        "failed_but_accepted"
    } else if concrete_evidence {
        "verified_with_evidence"
    } else if verification_deferred {
        "verification_deferred"
    } else {
        "unverified_risk_accepted"
    };

    json!({
        "schemaVersion": 1,
        "verificationState": verification_state,
        "statuses": statuses,
        "statusIds": status_ids,
        "evidenceSummary": {
            "concreteEvidence": concrete_evidence,
            "aiSelfReport": verify_log.as_ref().map(|log| log.intent_match).unwrap_or(false),
            "automatedTestsPassed": automated_tests_passed,
            "externalTestRun": external_test_run,
            "testResult": test_result,
            "testCommandPresent": test_command_present,
            "testExitCode": test_exit_code,
            "testEvidenceStrength": test_evidence_strength,
            "manualEvidenceCount": if client_manual_evidence { client_manual_evidence_count } else { 0 },
            "observationIds": if client_manual_evidence { json!(manual_observation_ids) } else { json!([]) },
            "evidenceLabels": evidence_labels,
        },
        "riskAccepted": risk_accepted,
        "riskReason": risk_reason,
        "approvalOutcome": judgment.map(|j| approval_outcome_str(j.outcome)),
        "decidedAt": decided_at,
    })
}

fn client_status_ids(client_provenance: Option<&Value>) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(items) = client_provenance
        .and_then(|value| value.get("statusIds"))
        .and_then(Value::as_array)
    {
        ids.extend(items.iter().filter_map(Value::as_str).map(str::to_owned));
    }
    if let Some(items) = client_provenance
        .and_then(|value| value.get("statuses"))
        .and_then(Value::as_array)
    {
        ids.extend(
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(str::to_owned),
        );
    }
    ids
}

fn client_observation_ids(client_provenance: Option<&Value>) -> Vec<String> {
    client_provenance
        .and_then(|value| value.get("evidenceSummary"))
        .and_then(|value| value.get("observationIds"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn push_status(statuses: &mut Vec<Value>, status: Value) {
    let Some(id) = status.get("id").and_then(Value::as_str) else {
        return;
    };
    if statuses
        .iter()
        .any(|existing| existing.get("id").and_then(Value::as_str) == Some(id))
    {
        return;
    }
    statuses.push(status);
}

fn status_value(id: &str, recorded_at: Option<i64>) -> Value {
    let (label, evidence_backed, tone, source) = match id {
        "ai_self_report_only" => ("AI 자가보고만 있음", false, "warn", "ai_self_report"),
        "diff_reviewed" => ("Diff 확인됨", true, "info", "diff_review"),
        "app_launched" => ("앱 실행 확인됨", true, "success", "app_launch"),
        "preview_checked" => ("수동 프리뷰 확인됨", true, "success", "preview"),
        "manual_observation" => ("직접 관찰 확인", true, "success", "user_observation"),
        "automated_tests_passed" => ("자동 테스트 통과", true, "success", "automated_test"),
        "external_test_not_run" => ("외부 테스트 없음", false, "warn", "external_test"),
        "failed_but_accepted" => ("실패했지만 승인됨", false, "risk", "risk_approval"),
        "approved_with_risk" => ("위험을 감수하고 승인됨", false, "risk", "risk_approval"),
        "verification_deferred" => ("검증 유예됨", false, "info", "deferred_verification"),
        _ => (id, false, "warn", "risk_approval"),
    };
    json!({
        "id": id,
        "label": label,
        "evidenceBacked": evidence_backed,
        "tone": tone,
        "source": source,
        "recordedAt": recorded_at,
    })
}

fn test_result_str(result: &crate::dive::TestResult) -> &'static str {
    match result {
        crate::dive::TestResult::Pass => "pass",
        crate::dive::TestResult::Fail => "fail",
        crate::dive::TestResult::Skipped => "skipped",
    }
}

fn approval_outcome_str(outcome: crate::dive::ApprovalOutcome) -> &'static str {
    match outcome {
        crate::dive::ApprovalOutcome::Approved => "approved",
        crate::dive::ApprovalOutcome::ApprovedWithConcern => "approved_with_concern",
        crate::dive::ApprovalOutcome::RevisionRequested => "revision_requested",
        crate::dive::ApprovalOutcome::VerificationDeferred => "verification_deferred",
    }
}

#[tauri::command]
pub async fn card_save_retrospective(
    state: State<'_, AppState>,
    card_id: i64,
    retrospective: String,
) -> Result<(), String> {
    card_save_retrospective_impl(&state, card_id, retrospective)
}

pub fn card_save_retrospective_impl(
    state: &AppState,
    card_id: i64,
    retrospective: String,
) -> Result<(), String> {
    let normalized = retrospective.trim().to_string();
    let content = if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    };
    let session_id = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        card_dao::update(
            db.conn(),
            card_id,
            &NewCard {
                session_id: existing.session_id,
                title: existing.title,
                instruction: existing.instruction,
                assist_summary: existing.assist_summary,
                acceptance_criteria: existing.acceptance_criteria,
                retrospective: content.clone(),
                change_summary: existing.change_summary,
                state: existing.state,
                verify_log: existing.verify_log,
                changed_files: existing.changed_files,
                test_command: existing.test_command,
                approval_judgment: existing.approval_judgment,
                approval_provenance: existing.approval_provenance,
                position: existing.position,
            },
        )
        .map_err(|e| e.to_string())?;
        existing.session_id
    };
    log_event(
        state,
        Some(session_id),
        "card_update",
        serde_json::json!({
            "card_id": card_id,
            "action": "retrospective",
            "retrospective_len": content.as_ref().map(|s| s.chars().count()).unwrap_or(0),
        }),
    )
}

#[tauri::command]
pub async fn card_transition(
    state: State<'_, AppState>,
    app: AppHandle,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
    judgment: Option<crate::dive::ApprovalJudgment>,
    approval_provenance: Option<Value>,
) -> Result<CardState, String> {
    let (next, checkpoint) = card_transition_with_checkpoint_and_provenance_impl(
        &state,
        card_id,
        transition,
        approve_force,
        judgment,
        approval_provenance,
    )?;

    if let Some(row) = checkpoint {
        let _ = app.emit(
            "checkpoint_created",
            serde_json::json!({
                "id": row.id,
                "session_id": row.session_id,
                "card_id": row.card_id,
                "kind": row.kind,
                "label": row.label,
                "git_sha": row.git_sha,
                "changed_files": row.changed_files,
                "stats": row.stats,
            }),
        );
    }

    Ok(next)
}

pub(super) fn card_transition_with_checkpoint_impl(
    state: &AppState,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
    judgment: Option<crate::dive::ApprovalJudgment>,
) -> Result<(CardState, Option<CheckpointRow>), String> {
    card_transition_with_checkpoint_and_provenance_impl(
        state,
        card_id,
        transition,
        approve_force,
        judgment,
        None,
    )
}

pub(super) fn card_transition_with_checkpoint_and_provenance_impl(
    state: &AppState,
    card_id: i64,
    transition: CardTransition,
    approve_force: Option<bool>,
    judgment: Option<crate::dive::ApprovalJudgment>,
    approval_provenance: Option<Value>,
) -> Result<(CardState, Option<CheckpointRow>), String> {
    let (session_id, card_title, previous_state) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        (existing.session_id, existing.title.clone(), existing.state)
    };
    let next = card_transition_no_checkpoint_with_provenance_impl(
        state,
        card_id,
        transition,
        approve_force,
        judgment,
        approval_provenance,
    )?;
    sync_plan_step_mapping_for_card_transition(state, card_id, next)?;
    let recorded_provenance = if matches!(transition, CardTransition::Approve) {
        approval_provenance_for_card(state, card_id)?
    } else {
        None
    };
    log_event(
        state,
        Some(session_id),
        "card_update",
        serde_json::json!({
            "card_id": card_id,
            "action": "transition",
            "transition": transition,
            "from": previous_state,
            "to": next,
            "approval_provenance": recorded_provenance.as_ref().map(provenance_log_summary),
        }),
    )?;
    let previous_stage = stage_for_card_state(previous_state);
    let next_stage = stage_for_card_state(next);
    if previous_stage != next_stage {
        log_event(
            state,
            Some(session_id),
            "stage_exit",
            serde_json::json!({ "stage": previous_stage, "card_id": card_id }),
        )?;
        log_event(
            state,
            Some(session_id),
            "stage_enter",
            serde_json::json!({ "stage": next_stage, "card_id": card_id }),
        )?;
    }

    let Some(label) = auto_checkpoint_label(transition, &card_title) else {
        return Ok((next, None));
    };
    let project_root = state.project_root_required()?;
    let engine = crate::checkpoint::CheckpointEngine::new(project_root, state.db.clone());
    let checkpoint = if engine.checkpoint_dir().join("HEAD").exists() {
        engine
            .create_checkpoint(session_id, Some(card_id), "auto", Some(&label))
            .ok()
    } else {
        None
    };
    if let Some(row) = checkpoint.as_ref() {
        log_event(
            state,
            Some(session_id),
            "checkpoint_create",
            serde_json::json!({
                "checkpoint_id": row.id,
                "card_id": row.card_id,
                "kind": row.kind,
                "label": row.label,
                "git_sha": row.git_sha,
                "changed_file_count": row.changed_files.len(),
            }),
        )?;
    }
    Ok((next, checkpoint))
}

fn sync_plan_step_mapping_for_card_transition(
    state: &AppState,
    card_id: i64,
    next: CardState,
) -> Result<(), String> {
    let status = match next {
        CardState::Verified => "done",
        CardState::Extended => "shipped",
        CardState::Decomposed
        | CardState::Instructed
        | CardState::Verifying
        | CardState::Rejected => return Ok(()),
    };
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let Some(mapping) = mapping_dao::get_by_card(db.conn(), card_id).map_err(|e| e.to_string())?
    else {
        return Ok(());
    };
    let card = card_dao::get_by_id(db.conn(), card_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("card {card_id} not found"))?;
    let approval_provenance = card
        .approval_provenance
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
    let next_verification_status = approval_provenance
        .as_ref()
        .and_then(|value| value.get("verificationState").and_then(Value::as_str))
        .map(str::to_owned)
        .or(mapping.verification_status);
    let next_verification_evidence = approval_provenance
        .as_ref()
        .and_then(|value| value.get("evidenceSummary"))
        .map(Value::to_string)
        .or(mapping.verification_evidence);
    let next_user_decision = approval_provenance
        .as_ref()
        .map(mapping_user_decision)
        .or(mapping.user_decision);
    if mapping.status == status {
        return Ok(());
    }
    let done = status == "done" || status == "shipped";
    mapping_dao::update(
        db.conn(),
        mapping.id,
        &NewStepSessionMapping {
            step_id: mapping.step_id,
            session_id: mapping.session_id,
            card_id: mapping.card_id,
            state_path: mapping.state_path,
            status: status.into(),
            started_at: mapping.started_at,
            completed_at: if done {
                Some(crate::db::now_ms())
            } else {
                mapping.completed_at
            },
            checkpoint_ids: mapping.checkpoint_ids,
            verification_status: next_verification_status,
            verification_evidence: next_verification_evidence,
            user_decision: next_user_decision,
        },
    )
    .map_err(|e| e.to_string())
}

fn approval_provenance_for_card(state: &AppState, card_id: i64) -> Result<Option<Value>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let Some(card) = card_dao::get_by_id(db.conn(), card_id).map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    Ok(card
        .approval_provenance
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok()))
}

fn provenance_log_summary(value: &Value) -> Value {
    json!({
        "verificationState": value.get("verificationState").and_then(Value::as_str),
        "statusIds": value.get("statusIds").cloned().unwrap_or(Value::Null),
        "riskAccepted": value.get("riskAccepted").and_then(Value::as_bool),
        "evidenceSummary": value.get("evidenceSummary").cloned().unwrap_or(Value::Null),
    })
}

fn mapping_user_decision(value: &Value) -> String {
    json!({
        "schemaVersion": 1,
        "approvalOutcome": value.get("approvalOutcome").and_then(Value::as_str),
        "verificationState": value.get("verificationState").and_then(Value::as_str),
        "riskAccepted": value.get("riskAccepted").and_then(Value::as_bool).unwrap_or(false),
        "riskReasonPresent": value
            .get("riskReason")
            .and_then(Value::as_str)
            .map(|reason| !reason.trim().is_empty())
            .unwrap_or(false),
        "decidedAt": value.get("decidedAt").and_then(Value::as_i64),
    })
    .to_string()
}

fn auto_checkpoint_label(transition: CardTransition, card_title: &str) -> Option<String> {
    match transition {
        CardTransition::EnterInstruct => Some(format!("[I 진입] {card_title}")),
        CardTransition::RequestVerify => Some(format!("[V 요청] {card_title}")),
        CardTransition::Reject => Some(format!("[V 거부] {card_title}")),
        CardTransition::Approve => Some(format!("[V 통과] {card_title}")),
        CardTransition::Extend => Some(format!("[E 진입] {card_title}")),
        CardTransition::ReopenFromReject => None,
    }
}

fn stage_for_card_state(state: CardState) -> &'static str {
    match state {
        CardState::Decomposed => "D",
        CardState::Instructed => "I",
        CardState::Verifying | CardState::Rejected => "V",
        CardState::Verified | CardState::Extended => "E",
    }
}

#[tauri::command]
pub async fn card_verify(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: i64,
    card_id: i64,
) -> Result<crate::dive::VerifyLog, String> {
    let snap = state.ensure_provider_runtime().await?;
    if snap.kind.is_none() {
        let msg = crate::providers::ProviderError::NotConfigured.to_string();
        let _ = log_error_event(&state, Some(session_id), "provider", &msg);
        return Err(msg);
    }
    let provider_kind = snap.kind.clone();
    let provider_config_id = snap.config_id;
    let project_root = state.project_root_required()?;
    let engine = crate::dive::VerifyEngine::new(snap.provider, state.db.clone(), snap.model)
        .with_project_root(project_root);
    log_event(
        &state,
        Some(session_id),
        "verify_start",
        serde_json::json!({ "card_id": card_id }),
    )?;
    let _ = app.emit(
        "verify_started",
        serde_json::json!({ "session_id": session_id, "card_id": card_id }),
    );
    let log = match engine.verify_card(session_id, card_id).await {
        Ok(log) => log,
        Err(err) => {
            let message = err.to_string();
            if provider_kind == ProviderKind::Codex
                && super::provider::is_codex_auth_invalidated_message(&message)
            {
                if let Some(provider_config_id) = provider_config_id {
                    match state.invalidate_codex_credentials(provider_config_id) {
                        Ok(()) => {
                            tracing::warn!(
                                provider_config_id,
                                "Codex OAuth credentials invalidated after verify error"
                            );
                            super::provider::emit_provider_changed(
                                &app,
                                provider_config_id,
                                ProviderKind::Codex.as_str(),
                                "codex_auth_invalidated",
                            );
                        }
                        Err(invalidate_err) => {
                            tracing::warn!(
                                provider_config_id,
                                error = %crate::telemetry::redact_log_text(&invalidate_err),
                                "failed to invalidate Codex OAuth credentials after verify error"
                            );
                        }
                    }
                }
            }
            let _ = log_error_event(&state, Some(session_id), "verify", &message);
            return Err(message);
        }
    };
    log_event(
        &state,
        Some(session_id),
        "verify_complete",
        serde_json::json!({
            "card_id": card_id,
            "intent_match": log.intent_match,
            "test_result": log.test_result,
            "test_command_present": log
                .test_command
                .as_deref()
                .is_some_and(|command| !command.trim().is_empty()),
            "test_exit_code": log.test_exit_code,
        }),
    )?;
    let _ = app.emit(
        "verify_done",
        serde_json::json!({
            "session_id": session_id,
            "card_id": card_id,
            "intent_match": log.intent_match,
        }),
    );
    Ok(log)
}
