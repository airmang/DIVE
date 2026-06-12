use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::db::dao::{card as card_dao, step_session_mapping as mapping_dao};
use crate::db::models::{CardState, CheckpointRow, NewCard, NewStepSessionMapping};
use crate::dive::{apply_transition, CardTransition};

use super::{log_error_event, log_event, policy, AppState};

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
) -> Result<CardState, String> {
    let (next, checkpoint) =
        card_transition_with_checkpoint_impl(&state, card_id, transition, approve_force, judgment)?;

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
    let (session_id, card_title, previous_state) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let existing = card_dao::get_by_id(db.conn(), card_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("card {card_id} not found"))?;
        (existing.session_id, existing.title.clone(), existing.state)
    };
    let next =
        card_transition_no_checkpoint_impl(state, card_id, transition, approve_force, judgment)?;
    sync_plan_step_mapping_for_card_transition(state, card_id, next)?;
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
            verification_status: mapping.verification_status,
            verification_evidence: mapping.verification_evidence,
            user_decision: mapping.user_decision,
        },
    )
    .map_err(|e| e.to_string())
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
