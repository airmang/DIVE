//! Plan router chat, cancellation, and pre-pivot checkpoints.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;

use crate::db::dao::{plan as plan_dao, step as step_dao, step_session_mapping as mapping_dao};
use crate::db::models::{StepRow, StepSessionMappingRow};
#[cfg(test)]
use crate::db::now_ms;
use crate::dive::plan_router::{self, PlanRouterDecision};
use crate::ipc::{log_event, AppState};

use super::*;

const ROUTE_CANCELLED_MESSAGE: &str = "route chat cancelled";
pub fn workspace_plan_list_steps_impl(
    state: &AppState,
    plan_id: i64,
) -> Result<Vec<StepRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    step_dao::list_active_by_plan(db.conn(), plan_id).map_err(|e| e.to_string())
}

pub fn workspace_plan_step_mappings_impl(
    state: &AppState,
    plan_id: i64,
) -> Result<Vec<StepSessionMappingRow>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let steps = step_dao::list_active_by_plan(db.conn(), plan_id).map_err(|e| e.to_string())?;
    mappings_for_steps(db.conn(), &steps)
}

pub async fn workspace_plan_route_chat_impl(
    state: &AppState,
    project_id: i64,
    prompt: String,
    route_request_id: Option<String>,
) -> Result<RouteDecision, String> {
    let cancel = register_route_cancel(state, route_request_id.as_deref())?;
    let result = workspace_plan_route_chat_inner(state, project_id, prompt, cancel.clone()).await;
    if let Some(route_request_id) = route_request_id {
        let mut guard = state.route_cancels.lock().map_err(|e| e.to_string())?;
        guard.remove(&route_request_id);
    }
    result
}

pub fn workspace_plan_route_cancel_impl(
    state: &AppState,
    route_request_id: String,
) -> Result<(), String> {
    let guard = state.route_cancels.lock().map_err(|e| e.to_string())?;
    if let Some(token) = guard.get(&route_request_id) {
        token.store(true, Ordering::SeqCst);
    }
    Ok(())
}

async fn workspace_plan_route_chat_inner(
    state: &AppState,
    project_id: i64,
    prompt: String,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<RouteDecision, String> {
    let status = workspace_plan_status_impl(state, project_id)?;
    let Some(plan_id) = status.plan_id else {
        return Ok(RouteDecision::Skip {
            reason: "approved plan not found".into(),
        });
    };
    if !status.has_approved_plan {
        return Ok(RouteDecision::Skip {
            reason: "approved plan not found".into(),
        });
    }

    check_route_cancel(cancel.as_ref())?;
    let runtime = if let Some(cancel) = cancel.clone() {
        tokio::select! {
            result = state.ensure_provider_runtime() => result?,
            _ = wait_for_route_cancel(cancel) => return Err(ROUTE_CANCELLED_MESSAGE.into()),
        }
    } else {
        state.ensure_provider_runtime().await?
    };
    check_route_cancel(cancel.as_ref())?;
    let ctx = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let plan = plan_dao::get_by_id(db.conn(), plan_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("plan {plan_id} not found"))?;
        let steps = step_dao::list_active_by_plan(db.conn(), plan_id).map_err(|e| e.to_string())?;
        let mappings = mappings_for_steps(db.conn(), &steps)?;
        build_router_context(&plan, &steps, &mappings)
    };

    let decision = match plan_router::decide_cancelable(
        runtime.provider.as_ref(),
        runtime.model,
        prompt,
        ctx,
        cancel,
    )
    .await
    {
        Ok(decision) => decision,
        Err(err) if err == ROUTE_CANCELLED_MESSAGE => return Err(err),
        Err(err) => {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                "workspace plan route failed open to normal chat"
            );
            return Ok(RouteDecision::Skip {
                reason: "router unavailable; continuing as normal chat".into(),
            });
        }
    };
    match decision {
        PlanRouterDecision::Chat { reason } => Ok(RouteDecision::Chat { reason }),
        PlanRouterDecision::AddStep { draft, reason } => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let draft = step_draft_input_from_router(db.conn(), plan_id, *draft)?;
            if let Some(existing) = find_duplicate_step(db.conn(), plan_id, &draft)? {
                // Server-side duplicate detection is plan truth; surface it as a
                // typed Duplicate outcome (not a silent chat downgrade) so the
                // P8 UI can show what collided. `reason` is computed before
                // moving `existing`'s fields into the payload. Still propose-only.
                let reason = format!(
                    "already covered by {}: {}",
                    existing.step_id, existing.title
                );
                return Ok(RouteDecision::Duplicate {
                    existing: StepRefPayload {
                        step_id: existing.step_id,
                        db_id: existing.id,
                        title: existing.title,
                    },
                    draft: Box::new(draft),
                    reason,
                });
            }
            Ok(RouteDecision::AddStep {
                draft: Box::new(draft),
                reason,
            })
        }
        PlanRouterDecision::Clarify {
            question,
            candidate_intent,
            suggested_criterion_ids,
            reason,
        } => Ok(RouteDecision::Clarify {
            question,
            candidate_intent,
            suggested_criterion_ids,
            reason,
        }),
        PlanRouterDecision::Remove {
            target_step_id,
            reason,
        } => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            match resolve_active_step_ref(db.conn(), plan_id, &target_step_id)? {
                Some(target) => Ok(RouteDecision::RemoveStep { target, reason }),
                None => Ok(RouteDecision::Skip {
                    reason: format!("router referenced unknown active step {target_step_id}"),
                }),
            }
        }
        PlanRouterDecision::Supersede {
            target_step_id,
            replacement,
            reason,
        } => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let Some(target) = resolve_active_step_ref(db.conn(), plan_id, &target_step_id)? else {
                return Ok(RouteDecision::Skip {
                    reason: format!("router referenced unknown active step {target_step_id}"),
                });
            };
            let replacement = step_draft_input_from_router(db.conn(), plan_id, *replacement)?;
            Ok(RouteDecision::SupersedeStep {
                target,
                replacement: Box::new(replacement),
                reason,
            })
        }
        PlanRouterDecision::MultiStep { steps, reason } => {
            // Propose-only: build the batch with placeholder ids and sibling-index
            // deps. No DB, no mutation — `workspace_plan_append_steps` owns topo
            // ordering + id allocation when the P8b UI confirms the proposal.
            let drafts = steps
                .into_iter()
                .map(|(draft, depends_on_draft)| MultiStepDraftInput {
                    draft: router_draft_to_input_unallocated(draft),
                    depends_on_draft,
                })
                .collect();
            Ok(RouteDecision::MultiStep { drafts, reason })
        }
    }
}

/// S-033: resolve a router-emitted `target_step_id` to a stable step reference,
/// but only when it names an existing **active** step in the plan. Returns
/// `None` for unknown or already-removed/superseded steps so the router can
/// never fabricate a mutation against a non-existent target.
fn resolve_active_step_ref(
    conn: &rusqlite::Connection,
    plan_id: i64,
    step_id: &str,
) -> Result<Option<StepRefPayload>, String> {
    let Some(row) =
        step_dao::get_by_plan_and_step_id(conn, plan_id, step_id).map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    if row.status != "active" {
        return Ok(None);
    }
    Ok(Some(StepRefPayload {
        step_id: row.step_id,
        db_id: row.id,
        title: row.title,
    }))
}

fn register_route_cancel(
    state: &AppState,
    route_request_id: Option<&str>,
) -> Result<Option<Arc<AtomicBool>>, String> {
    let Some(route_request_id) = route_request_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    let token = Arc::new(AtomicBool::new(false));
    let mut guard = state.route_cancels.lock().map_err(|e| e.to_string())?;
    guard.insert(route_request_id.to_string(), token.clone());
    Ok(Some(token))
}

fn check_route_cancel(cancel: Option<&Arc<AtomicBool>>) -> Result<(), String> {
    if cancel
        .map(|token| token.load(Ordering::SeqCst))
        .unwrap_or(false)
    {
        Err(ROUTE_CANCELLED_MESSAGE.into())
    } else {
        Ok(())
    }
}

async fn wait_for_route_cancel(cancel: Arc<AtomicBool>) {
    while !cancel.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[derive(Debug, Clone)]
pub(super) struct PrePivotCheckpointInput {
    session_id: i64,
    snapshot: String,
}

pub(super) fn prepare_pre_pivot_checkpoint(
    state: &AppState,
    plan_id: i64,
) -> Option<PrePivotCheckpointInput> {
    let session_id = resolve_plan_session_id_for_checkpoint(state, plan_id)?;
    let engine =
        crate::checkpoint::CheckpointEngine::new(state.project_root_snapshot(), state.db.clone());
    let snapshot = engine.capture_session_state_snapshot(session_id).ok()?;
    Some(PrePivotCheckpointInput {
        session_id,
        snapshot,
    })
}

fn resolve_plan_session_id_for_checkpoint(state: &AppState, plan_id: i64) -> Option<i64> {
    let db = state.db.lock().ok()?;
    let steps = step_dao::list_active_by_plan(db.conn(), plan_id).ok()?;
    for step in steps {
        let Some(mapping) = mapping_dao::get_by_step(db.conn(), step.id).ok().flatten() else {
            continue;
        };
        if let Some(session_id) = mapping.session_id {
            return Some(session_id);
        }
    }
    None
}

pub(super) fn maybe_create_pre_pivot_checkpoint(
    state: &AppState,
    checkpoint: Option<PrePivotCheckpointInput>,
) {
    let Some(checkpoint) = checkpoint else {
        return;
    };
    let Ok(project_root) = state.project_root_required() else {
        return;
    };
    let engine = crate::checkpoint::CheckpointEngine::new(project_root, state.db.clone());
    if !engine.checkpoint_dir().join("HEAD").exists() {
        return;
    }
    let row = engine
        .create_checkpoint_if_changed_with_snapshot(
            checkpoint.session_id,
            None,
            "auto-pre-pivot",
            None,
            checkpoint.snapshot,
        )
        .ok()
        .flatten();
    if let Some(row) = row {
        if let Err(err) = log_event(
            state,
            Some(checkpoint.session_id),
            "checkpoint_create",
            json!({
                "checkpoint_id": row.id,
                "card_id": row.card_id,
                "kind": row.kind,
                "label": row.label,
                "git_sha": row.git_sha,
                "changed_file_count": row.changed_files.len(),
            }),
        ) {
            tracing::warn!(
                error = %crate::telemetry::redact_log_text(&err),
                checkpoint_id = row.id,
                "failed to append checkpoint_create event"
            );
        }
    }
}

#[cfg(test)]
mod pre_pivot_checkpoint_tests {
    use super::*;
    use crate::checkpoint::CheckpointEngine;
    use crate::db::dao::{
        card as card_dao, checkpoint as checkpoint_dao, plan as plan_dao, project as project_dao,
        session as session_dao, step as step_dao, step_session_mapping as mapping_dao,
        workmap as workmap_dao,
    };
    use crate::db::models::{
        CardState, NewCard, NewPlan, NewProject, NewSession, NewStep, NewStepSessionMapping,
        NewWorkmap,
    };
    use serde_json::json;

    fn append_draft() -> StepDraftInput {
        StepDraftInput {
            title: "Add recovery copy".into(),
            summary: "Add the visible recovery copy for the current plan.".into(),
            instruction_seed: "Update the recovery panel text only.".into(),
            expected_files: vec!["src/App.tsx".into()],
            acceptance_criteria: vec![AcceptanceCriterionInput::Text(
                "Recovery copy is visible in the panel.".into(),
            )],
            linked_criterion_ids: Vec::new(),
            rationale: None,
            step_kind: None,
            verification_command: None,
            verification_type: Some("manual".into()),
            dependencies: Vec::new(),
            parallel_group: None,
            position: 0,
            step_id: String::new(),
        }
    }

    fn seed_plan_session(state: &AppState, project_root: &std::path::Path) -> (i64, i64) {
        let db = state.db.lock().unwrap();
        let project_id = project_dao::insert(
            db.conn(),
            &NewProject {
                name: "p".into(),
                path: project_root.to_string_lossy().into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let plan_id = plan_dao::insert(
            db.conn(),
            &NewPlan {
                project_id,
                interview_id: None,
                goal: "Build recovery anchors".into(),
                intent_summary: None,
                scope: None,
                non_goals: None,
                constraints: None,
                acceptance_criteria: None,
                status: "approved".into(),
            },
        )
        .unwrap();
        let step_id = step_dao::insert(
            db.conn(),
            &NewStep {
                plan_id,
                step_id: "step-001".into(),
                title: "Existing step".into(),
                summary: Some("Existing summary".into()),
                instruction_seed: Some("Existing seed".into()),
                expected_files: Some(json!(["src/App.tsx"])),
                acceptance_criteria: Some(json!(["Existing criterion"])),
                step_kind: Default::default(),
                verification_kind: Some("manual".into()),
                verification_command: None,
                verification_manual_check: None,
                dependencies: Some(json!([])),
                parallel_group: None,
                position: 1,
            },
        )
        .unwrap();
        let session_id = session_dao::insert(
            db.conn(),
            &NewSession {
                project_id,
                title: "Existing step".into(),
                ended_at: None,
                status: "active".into(),
            },
        )
        .unwrap();
        let card_id = card_dao::insert(
            db.conn(),
            &NewCard {
                session_id,
                title: "Existing step".into(),
                instruction: Some("Existing seed".into()),
                assist_summary: None,
                acceptance_criteria: None,
                retrospective: None,
                change_summary: None,
                state: CardState::Instructed,
                verify_log: None,
                changed_files: None,
                test_command: None,
                approval_judgment: None,
                approval_provenance: None,
                position: 1,
            },
        )
        .unwrap();
        workmap_dao::upsert(
            db.conn(),
            &NewWorkmap {
                session_id,
                current_stage: "I".into(),
                collapsed: false,
                current_card_id: Some(card_id),
            },
        )
        .unwrap();
        mapping_dao::insert(
            db.conn(),
            &NewStepSessionMapping {
                step_id,
                session_id: Some(session_id),
                card_id: Some(card_id),
                state_path: Some("step-001".into()),
                status: "in_progress".into(),
                started_at: Some(now_ms()),
                completed_at: None,
                checkpoint_ids: Some(json!([])),
                verification_status: None,
                verification_evidence: None,
                user_decision: None,
            },
        )
        .unwrap();
        (plan_id, session_id)
    }

    #[test]
    fn append_step_creates_auto_pre_pivot_checkpoint() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();
        let (plan_id, session_id) = seed_plan_session(&state, tmp.path());
        CheckpointEngine::new(tmp.path(), state.db.clone())
            .init()
            .unwrap();

        workspace_plan_append_step_impl(&state, plan_id, append_draft()).unwrap();

        let db = state.db.lock().unwrap();
        let checkpoints = checkpoint_dao::list_by_session(db.conn(), session_id).unwrap();
        let pre_pivot = checkpoints
            .iter()
            .find(|row| row.kind == "auto-pre-pivot")
            .expect("plan mutation should create a pre-pivot checkpoint");
        assert!(pre_pivot.label.is_none());
        assert!(pre_pivot.session_state_snapshot.is_some());
    }
}
