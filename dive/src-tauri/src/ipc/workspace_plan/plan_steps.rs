//! Plan step CRUD/mutations and PRD-delta persistence for mutations.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::db::dao::{
    plan as plan_dao, plan_mutation as plan_mutation_dao, prd as prd_dao, step as step_dao,
};
use crate::db::models::{
    AcceptanceCriterionSource, AcceptanceCriterionStatus, NewObjection, NewPlanMutation,
    NewProjectSpecVersion, NewStep, ObjectionSuggestionStatus, PlanMutationType, PlanRow,
    ProjectSpec, ProjectSpecDelta, ProjectSpecVersionRow, ScopeExpansionAssessment, StepRow,
    StepSessionMappingRow,
};
use crate::db::now_ms;
use crate::dive::event_log as dive_event_log;
use crate::dive::plan_router::{PlanRouterContext, PlanRouterStepContext, RouterStepDraft};
use crate::ipc::AppState;
use crate::workspace_plan as workspace_plan_service;

use super::*;

#[derive(Debug, Clone)]
struct AppendPrdUpdate {
    project_spec_id: String,
    from_version: i64,
    to_version: i64,
    delta: ProjectSpecDelta,
    delta_summary: Value,
}

fn empty_project_spec_delta(from_version: i64, to_version: i64) -> ProjectSpecDelta {
    ProjectSpecDelta {
        from_version,
        to_version,
        added_criteria: Vec::new(),
        retired_criterion_ids: Vec::new(),
        scope_changes: Vec::new(),
        non_goal_changes: Vec::new(),
    }
}

fn normalize_plan_mutation_delta(
    provided: Option<&ProjectSpecDelta>,
    from_version: i64,
    to_version: i64,
) -> ProjectSpecDelta {
    let mut delta = provided
        .cloned()
        .unwrap_or_else(|| empty_project_spec_delta(from_version, to_version));
    delta.from_version = from_version;
    delta.to_version = to_version;
    delta.scope_changes = compact_unique_strings(delta.scope_changes);
    delta.non_goal_changes = compact_unique_strings(delta.non_goal_changes);
    delta.retired_criterion_ids = compact_unique_strings(delta.retired_criterion_ids);
    delta.added_criteria = normalize_acceptance_criteria(
        delta.added_criteria,
        to_version.max(1),
        AcceptanceCriterionSource::PlanMutation,
    );
    for criterion in &mut delta.added_criteria {
        criterion.source = AcceptanceCriterionSource::PlanMutation;
        criterion.status = AcceptanceCriterionStatus::Active;
        criterion.created_in_version = to_version.max(1);
        criterion.retired_in_version = None;
    }
    delta
}

fn persist_prd_delta_for_plan_mutation(
    conn: &rusqlite::Connection,
    project_id: i64,
    latest_prd: Option<&ProjectSpecVersionRow>,
    provided_delta: Option<&ProjectSpecDelta>,
) -> Result<AppendPrdUpdate, String> {
    let Some(latest_prd) = latest_prd else {
        let from_version = provided_delta.map(|delta| delta.from_version).unwrap_or(0);
        let to_version = provided_delta
            .map(|delta| delta.to_version)
            .unwrap_or(from_version);
        let delta = normalize_plan_mutation_delta(provided_delta, from_version, to_version);
        let delta_summary = delta_summary_for_plan_mutation(&delta);
        return Ok(AppendPrdUpdate {
            project_spec_id: format!("prd-{project_id}"),
            from_version,
            to_version,
            delta,
            delta_summary,
        });
    };

    let from_version = latest_prd.version;
    let to_version = from_version + 1;
    let mut delta = normalize_plan_mutation_delta(provided_delta, from_version, to_version);
    let mut next = latest_prd.snapshot.clone();
    next.current_version = to_version;
    next.updated_at = now_ms();

    // Mutate `delta.added_criteria` in place (not a clone) so a reallocated id
    // is reflected in the ledger too, not just the snapshot pushed below. A
    // clone-and-discard here used to let the two diverge: when a proposed id
    // collided and got reallocated, only the clone pushed into
    // `next.acceptance_criteria` got the new id — `delta.added_criteria` kept
    // the stale, colliding id and that stale id is what flows into
    // `ProjectSpecVersion.delta_summary`, the `PRD_EDITED` added-ids, the
    // `NewPlanMutation.prd_delta`, and the exported `plan.json`.
    for criterion in &mut delta.added_criteria {
        if criterion.text.trim().is_empty() {
            continue;
        }
        if !is_valid_acceptance_criterion_id(criterion.criterion_id.trim())
            || next
                .acceptance_criteria
                .iter()
                .any(|existing| existing.criterion_id == criterion.criterion_id)
        {
            criterion.criterion_id = allocate_acceptance_criterion_id(&next.acceptance_criteria);
        }
        criterion.source = AcceptanceCriterionSource::PlanMutation;
        criterion.status = AcceptanceCriterionStatus::Active;
        criterion.created_in_version = to_version;
        criterion.retired_in_version = None;
        next.acceptance_criteria.push(criterion.clone());
    }

    let retired_ids = delta
        .retired_criterion_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    for criterion in &mut next.acceptance_criteria {
        if retired_ids.contains(criterion.criterion_id.as_str())
            && criterion.status == AcceptanceCriterionStatus::Active
        {
            criterion.status = AcceptanceCriterionStatus::Retired;
            criterion.retired_in_version = Some(to_version);
        }
    }
    for scope_change in &delta.scope_changes {
        next.scope = append_unique_string(next.scope, scope_change);
    }
    for non_goal_change in &delta.non_goal_changes {
        next.non_goals = append_unique_string(next.non_goals, non_goal_change);
    }

    let delta_summary = delta_summary_for_plan_mutation(&delta);
    prd_dao::insert_version(
        conn,
        &NewProjectSpecVersion {
            project_spec_id: next.project_spec_id.clone(),
            project_id,
            version: to_version,
            previous_version: Some(from_version),
            snapshot: next.clone(),
            reason: "plan_mutation".into(),
            delta_summary: delta_summary.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    let added_ids = delta
        .added_criteria
        .iter()
        .map(|criterion| criterion.criterion_id.clone())
        .collect::<Vec<_>>();
    // Wily P2 cleanup: stamp with the project's session instead of `None` — a
    // NULL session_id makes plan/PRD lifecycle rows permanently unreachable by
    // the session-scoped EventLog export (`ExportEngine::export_session`).
    let mutation_session_id =
        super::plan_lifecycle::latest_session_id_for_project(conn, project_id);
    dive_event_log::append_to_conn(
        conn,
        mutation_session_id,
        dive_event_log::PRD_EDITED_EVENT,
        dive_event_log::prd_edited_payload(
            project_id,
            next.project_spec_id.clone(),
            from_version,
            to_version,
            "plan_mutation",
            changed_fields_for_plan_mutation_delta(&delta),
            added_ids,
            delta.retired_criterion_ids.clone(),
        ),
    )
    .map_err(|e| e.to_string())?;
    dive_event_log::append_to_conn(
        conn,
        mutation_session_id,
        dive_event_log::PRD_VERSION_CREATED_EVENT,
        dive_event_log::prd_version_created_payload(
            project_id,
            next.project_spec_id.clone(),
            to_version,
            Some(from_version),
            delta_summary.clone(),
        ),
    )
    .map_err(|e| e.to_string())?;
    Ok(AppendPrdUpdate {
        project_spec_id: next.project_spec_id,
        from_version,
        to_version,
        delta,
        delta_summary,
    })
}

fn changed_fields_for_plan_mutation_delta(delta: &ProjectSpecDelta) -> Vec<String> {
    let mut fields = Vec::new();
    if !delta.scope_changes.is_empty() {
        fields.push("scope".into());
    }
    if !delta.non_goal_changes.is_empty() {
        fields.push("nonGoals".into());
    }
    if !delta.added_criteria.is_empty() || !delta.retired_criterion_ids.is_empty() {
        fields.push("acceptanceCriteria".into());
    }
    fields
}

fn delta_summary_for_plan_mutation(delta: &ProjectSpecDelta) -> Value {
    json!({
        "changedFields": changed_fields_for_plan_mutation_delta(delta),
        "criterionIdsAdded": delta
            .added_criteria
            .iter()
            .map(|criterion| criterion.criterion_id.clone())
            .collect::<Vec<_>>(),
        "criterionIdsRetired": delta.retired_criterion_ids,
        "scopeChanges": delta.scope_changes,
        "nonGoalChanges": delta.non_goal_changes,
    })
}

pub fn assess_scope_expansion_for_append(
    project_spec: &ProjectSpec,
    draft: &StepDraftInput,
    linked_criterion_ids: &[String],
    prd_delta: Option<&ProjectSpecDelta>,
) -> ScopeExpansionAssessment {
    let mut reason_codes = Vec::new();
    let mut evidence_refs = Vec::new();
    if compact_linked_criterion_ids(linked_criterion_ids).is_empty() {
        push_unique(&mut reason_codes, "missing_criterion_link".into());
        push_unique(&mut evidence_refs, "step.linkedCriterionIds".into());
    }

    if let Some(delta) = prd_delta {
        for (index, scope_change) in delta.scope_changes.iter().enumerate() {
            if !scope_change_is_covered_by_prd(scope_change, project_spec) {
                push_unique(&mut reason_codes, "new_scope_area".into());
                push_unique(
                    &mut evidence_refs,
                    format!("prdDelta.scopeChanges[{index}]"),
                );
            }
        }
    }

    for (index, expected_file) in draft.expected_files.iter().enumerate() {
        if target_file_matches_non_goal(expected_file, project_spec) {
            push_unique(&mut reason_codes, "target_outside_scope".into());
            push_unique(&mut evidence_refs, format!("step.expectedFiles[{index}]"));
        }
    }

    ScopeExpansionAssessment {
        expanded: !reason_codes.is_empty(),
        reason_codes,
        evidence_refs,
    }
}

fn scope_change_is_covered_by_prd(scope_change: &str, project_spec: &ProjectSpec) -> bool {
    let change = normalized_scope_text(scope_change);
    if change.is_empty() {
        return true;
    }
    project_spec
        .scope
        .iter()
        .any(|item| scope_texts_overlap(&change, item))
        || project_spec
            .acceptance_criteria
            .iter()
            .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
            .any(|criterion| scope_texts_overlap(&change, &criterion.text))
}

fn target_file_matches_non_goal(expected_file: &str, project_spec: &ProjectSpec) -> bool {
    let target = normalized_scope_text(expected_file);
    if target.is_empty() {
        return false;
    }
    project_spec
        .non_goals
        .iter()
        .any(|non_goal| scope_texts_overlap(&target, non_goal))
}

fn scope_texts_overlap(normalized_left: &str, right: &str) -> bool {
    let right = normalized_scope_text(right);
    if normalized_left.is_empty() || right.is_empty() {
        return false;
    }
    normalized_left.contains(&right) || right.contains(normalized_left)
}

fn normalized_scope_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|ch| if ch.is_alphanumeric() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn workspace_plan_append_step_impl(
    state: &AppState,
    plan_id: i64,
    draft: StepDraftInput,
) -> Result<StepRow, String> {
    workspace_plan_append_step_with_options_impl(
        state,
        plan_id,
        draft,
        AppendStepOptions::default(),
    )
}

pub fn workspace_plan_append_step_with_options_impl(
    state: &AppState,
    plan_id: i64,
    mut draft: StepDraftInput,
    options: AppendStepOptions,
) -> Result<StepRow, String> {
    let option_linked_criterion_ids = compact_linked_criterion_ids(&options.linked_criterion_ids);
    if !option_linked_criterion_ids.is_empty() {
        draft.linked_criterion_ids = option_linked_criterion_ids;
    } else {
        draft.linked_criterion_ids = compact_linked_criterion_ids(&draft.linked_criterion_ids);
    }
    let mutation_reason = options
        .mutation_reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    validate_append_draft(&draft)?;
    sanitize_step_verification(&mut draft);
    {
        // Wily P2 cleanup: reject before any mutation/checkpoint/export if the
        // plan's own project isn't the currently selected (ambient) one.
        let db = state.db.lock().map_err(|e| e.to_string())?;
        super::plan_lifecycle::require_plan_matches_ambient_project_root(
            state,
            db.conn(),
            plan_id,
        )?;
    }
    let pre_pivot_checkpoint = prepare_pre_pivot_checkpoint(state, plan_id);
    let row = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.conn_mut();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let plan = plan_dao::get_by_id(&tx, plan_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("plan {plan_id} not found"))?;
        if plan.status != "approved" {
            return Err("plan must be approved before appending steps".into());
        }
        let existing_count = step_dao::list_active_by_plan(&tx, plan_id)
            .map_err(|e| e.to_string())?
            .len();
        if existing_count >= MAX_PLAN_STEPS {
            return Err(format!(
                "plan exceeds DIVE execution envelope: at most {MAX_PLAN_STEPS} steps are allowed"
            ));
        }

        validate_draft_dependencies(&tx, plan_id, &draft.dependencies)?;
        if let Some(existing) = find_duplicate_step(&tx, plan_id, &draft)? {
            return Err(format!(
                "step already exists: {} ({})",
                existing.step_id, existing.title
            ));
        }
        let row = append_step_within_tx(
            &tx,
            &plan,
            &draft,
            mutation_reason.as_deref(),
            options.prd_delta.as_ref(),
        )?;
        tx.commit().map_err(|e| e.to_string())?;
        row
    };
    // The DB snapshot was captured before this mutation. Creating the checkpoint
    // after commit avoids holding the mutation transaction open on git I/O, and
    // it still runs before artifact export mutates `.dive/plan.json`.
    maybe_create_pre_pivot_checkpoint(state, pre_pivot_checkpoint);
    let project_root = state.project_root_required()?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    workspace_plan_service::artifacts::export_plan_artifacts(db.conn(), plan_id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(row)
}

/// S-033: insert one step draft within an open transaction — assigns the next
/// stable step_id/position, records the `add_step` PlanMutation, and logs
/// `plan_step_appended`. Shared by the single-append IPC and the supersede /
/// multi-step paths. The caller owns pre-checks (envelope, duplicate,
/// dependency existence) and the surrounding commit + export.
fn append_step_within_tx(
    tx: &rusqlite::Transaction<'_>,
    plan: &PlanRow,
    draft: &StepDraftInput,
    mutation_reason: Option<&str>,
    prd_delta: Option<&ProjectSpecDelta>,
) -> Result<StepRow, String> {
    let latest_prd = prd_dao::latest_version(tx, plan.project_id).map_err(|e| e.to_string())?;
    let scope_expansion = latest_prd
        .as_ref()
        .map(|row| {
            assess_scope_expansion_for_append(
                &row.snapshot,
                draft,
                &draft.linked_criterion_ids,
                prd_delta,
            )
        })
        .unwrap_or_else(|| ScopeExpansionAssessment {
            expanded: false,
            reason_codes: Vec::new(),
            evidence_refs: Vec::new(),
        });
    let step_id = step_dao::next_step_id(tx, plan.id).map_err(|e| e.to_string())?;
    let position = step_dao::next_position(tx, plan.id).map_err(|e| e.to_string())?;
    let acceptance_criteria = append_step_criteria_payload(draft, latest_prd.as_ref())?;
    let step_kind = step_kind_for_draft(draft);
    let inserted_id = step_dao::insert(
        tx,
        &NewStep {
            plan_id: plan.id,
            step_id,
            title: draft.title.clone(),
            summary: Some(draft.summary.clone()),
            instruction_seed: Some(draft.instruction_seed.clone()),
            expected_files: Some(serde_json::json!(draft.expected_files.clone())),
            acceptance_criteria: Some(acceptance_criteria),
            step_kind,
            verification_kind: draft.verification_type.clone(),
            verification_command: draft.verification_command.clone(),
            verification_manual_check: None,
            dependencies: Some(serde_json::json!(draft.dependencies.clone())),
            parallel_group: draft.parallel_group.map(|group| group.to_string()),
            position,
        },
    )
    .map_err(|e| e.to_string())?;
    step_dao::validate_dependencies(tx, plan.id).map_err(|e| e.to_string())?;
    let row = step_dao::get_by_id(tx, inserted_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "step not found after insert".to_string())?;
    let prd_update =
        persist_prd_delta_for_plan_mutation(tx, plan.project_id, latest_prd.as_ref(), prd_delta)?;
    let mutation_id = format!("mut-{}-{}", row.step_id, now_ms());
    plan_mutation_dao::insert_mutation(
        tx,
        &NewPlanMutation {
            mutation_id: mutation_id.clone(),
            project_id: plan.project_id,
            plan_id: plan.id,
            r#type: PlanMutationType::AddStep,
            step_db_id: Some(row.id),
            stable_step_id: Some(row.step_id.clone()),
            reason: mutation_reason.map(str::to_string),
            criterion_ids: draft.linked_criterion_ids.clone(),
            prd_delta: prd_update.delta.clone(),
            scope_expansion: scope_expansion.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    let mut payload = dive_event_log::plan_step_appended_payload(
        mutation_id,
        prd_update.project_spec_id,
        prd_update.from_version,
        prd_update.to_version,
        draft.linked_criterion_ids.clone(),
        serde_json::to_value(&scope_expansion).unwrap_or_else(|_| json!({})),
        prd_update.delta_summary,
    );
    if let Value::Object(map) = &mut payload {
        map.insert("project_id".into(), json!(plan.project_id));
        map.insert("plan_id".into(), json!(plan.id));
        map.insert("step_id".into(), json!(row.id));
        map.insert("stable_step_id".into(), json!(row.step_id.clone()));
        map.insert("step_title".into(), json!(row.title.clone()));
        map.insert("message".into(), json!("Step appended to plan"));
        map.insert("reason".into(), json!(mutation_reason));
    }
    // Wily P2 cleanup: stamp with the project's session instead of `None` — see
    // `latest_session_id_for_project` doc comment for why this matters for export.
    let step_session_id = super::plan_lifecycle::latest_session_id_for_project(tx, plan.project_id);
    dive_event_log::append_to_conn(
        tx,
        step_session_id,
        dive_event_log::PLAN_STEP_APPENDED_EVENT,
        payload,
    )
    .map_err(|e| e.to_string())?;
    Ok(row)
}

/// S-033: retire (soft-remove) a plan step. Records a `RetireStep` plan
/// mutation and a `plan_step_retired` event, then re-exports artifacts — all in
/// one transaction. Rejects when the plan is unapproved, the step is missing /
/// not active, or an active step still depends on the target.
pub fn workspace_plan_remove_step_impl(
    state: &AppState,
    plan_id: i64,
    step_db_id: i64,
    mutation_reason: Option<String>,
) -> Result<(), String> {
    let mutation_reason = mutation_reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    {
        // Wily P2 cleanup: reject before any mutation/checkpoint/export if the
        // plan's own project isn't the currently selected (ambient) one.
        let db = state.db.lock().map_err(|e| e.to_string())?;
        super::plan_lifecycle::require_plan_matches_ambient_project_root(
            state,
            db.conn(),
            plan_id,
        )?;
    }
    let pre_pivot_checkpoint = prepare_pre_pivot_checkpoint(state, plan_id);
    {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.conn_mut();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let plan = plan_dao::get_by_id(&tx, plan_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("plan {plan_id} not found"))?;
        if plan.status != "approved" {
            return Err("plan must be approved before removing steps".into());
        }
        let step = step_dao::get_by_id(&tx, step_db_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("step {step_db_id} not found"))?;
        if step.plan_id != plan_id {
            return Err(format!(
                "step {step_db_id} does not belong to plan {plan_id}"
            ));
        }
        if step.status != "active" {
            return Err(format!("step {} is not active", step.step_id));
        }
        validate_no_active_dependents(&tx, plan_id, &step.step_id)?;

        let latest_prd =
            prd_dao::latest_version(&tx, plan.project_id).map_err(|e| e.to_string())?;
        let prd_update =
            persist_prd_delta_for_plan_mutation(&tx, plan.project_id, latest_prd.as_ref(), None)?;

        step_dao::set_status(&tx, step.id, "removed", None, mutation_reason.as_deref())
            .map_err(|e| e.to_string())?;

        let mutation_id = format!("mut-{}-{}", step.step_id, now_ms());
        plan_mutation_dao::insert_mutation(
            &tx,
            &NewPlanMutation {
                mutation_id: mutation_id.clone(),
                project_id: plan.project_id,
                plan_id: plan.id,
                r#type: PlanMutationType::RetireStep,
                step_db_id: Some(step.id),
                stable_step_id: Some(step.step_id.clone()),
                reason: mutation_reason.clone(),
                criterion_ids: Vec::new(),
                prd_delta: prd_update.delta.clone(),
                scope_expansion: ScopeExpansionAssessment {
                    expanded: false,
                    reason_codes: Vec::new(),
                    evidence_refs: Vec::new(),
                },
            },
        )
        .map_err(|e| e.to_string())?;

        let mut payload = dive_event_log::plan_step_retired_payload(
            mutation_id,
            plan.project_id,
            plan.id,
            step.id,
            step.step_id.clone(),
            Vec::new(),
            prd_update.from_version,
            prd_update.to_version,
        );
        if let Value::Object(map) = &mut payload {
            map.insert("step_title".into(), json!(step.title.clone()));
            map.insert("message".into(), json!("Step retired from plan"));
            map.insert("reason".into(), json!(mutation_reason));
        }
        // Wily P2 cleanup: stamp with the project's session instead of `None` —
        // see `latest_session_id_for_project` doc comment for why this matters.
        let retire_session_id =
            super::plan_lifecycle::latest_session_id_for_project(&tx, plan.project_id);
        dive_event_log::append_to_conn(
            &tx,
            retire_session_id,
            dive_event_log::PLAN_STEP_RETIRED_EVENT,
            payload,
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    maybe_create_pre_pivot_checkpoint(state, pre_pivot_checkpoint);
    let project_root = state.project_root_required()?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    workspace_plan_service::artifacts::export_plan_artifacts(db.conn(), plan_id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// S-033: replace an active step with a new draft, atomically. Inserts the
/// replacement (`add_step` mutation + `plan_step_appended`), marks the target
/// `superseded` pointing at the replacement, and records the target's
/// `change_step` mutation + `plan_step_changed` event — all in one transaction
/// so a crash can never orphan a half-applied supersede.
pub fn workspace_plan_supersede_step_impl(
    state: &AppState,
    plan_id: i64,
    target_step_db_id: i64,
    mut replacement: StepDraftInput,
    options: AppendStepOptions,
) -> Result<StepRow, String> {
    let option_linked_criterion_ids = compact_linked_criterion_ids(&options.linked_criterion_ids);
    if !option_linked_criterion_ids.is_empty() {
        replacement.linked_criterion_ids = option_linked_criterion_ids;
    } else {
        replacement.linked_criterion_ids =
            compact_linked_criterion_ids(&replacement.linked_criterion_ids);
    }
    let mutation_reason = options
        .mutation_reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    validate_append_draft(&replacement)?;
    sanitize_step_verification(&mut replacement);

    {
        // Wily P2 cleanup: reject before any mutation/checkpoint/export if the
        // plan's own project isn't the currently selected (ambient) one.
        let db = state.db.lock().map_err(|e| e.to_string())?;
        super::plan_lifecycle::require_plan_matches_ambient_project_root(
            state,
            db.conn(),
            plan_id,
        )?;
    }
    let pre_pivot_checkpoint = prepare_pre_pivot_checkpoint(state, plan_id);
    let new_row = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.conn_mut();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let plan = plan_dao::get_by_id(&tx, plan_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("plan {plan_id} not found"))?;
        if plan.status != "approved" {
            return Err("plan must be approved before superseding steps".into());
        }
        let target = step_dao::get_by_id(&tx, target_step_db_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("step {target_step_db_id} not found"))?;
        if target.plan_id != plan_id {
            return Err(format!(
                "step {target_step_db_id} does not belong to plan {plan_id}"
            ));
        }
        if target.status != "active" {
            return Err(format!("step {} is not active", target.step_id));
        }
        validate_draft_dependencies(&tx, plan_id, &replacement.dependencies)?;

        // Insert the replacement first so we know its stable step_id for the link.
        let new_row = append_step_within_tx(
            &tx,
            &plan,
            &replacement,
            mutation_reason.as_deref(),
            options.prd_delta.as_ref(),
        )?;

        // Retire the target, pointing it at the replacement.
        step_dao::set_status(
            &tx,
            target.id,
            "superseded",
            Some(&new_row.step_id),
            mutation_reason.as_deref(),
        )
        .map_err(|e| e.to_string())?;

        // Supersede replaces the target in place, so any active step that
        // depended on it must be re-pointed at the replacement's new
        // step_id — the superseded step drops out of `list_active_by_plan`
        // (and therefore `done_step_ids`), so a dependent left pointing at
        // the retired id could never be satisfied and would stay blocked
        // forever. Re-validate afterward: rewriting a dependent's edge onto
        // the replacement is safe in the common case, but if the
        // replacement's own (already-validated) dependencies happen to name
        // that same dependent, the rewrite would close a cycle.
        repoint_active_dependents(&tx, plan_id, &target.step_id, &new_row.step_id)?;
        step_dao::validate_dependencies(&tx, plan_id).map_err(|e| e.to_string())?;

        // Record the target's change_step mutation + plan_step_changed event.
        let latest_prd =
            prd_dao::latest_version(&tx, plan.project_id).map_err(|e| e.to_string())?;
        let target_update =
            persist_prd_delta_for_plan_mutation(&tx, plan.project_id, latest_prd.as_ref(), None)?;
        let change_mutation_id = format!("mut-{}-{}", target.step_id, now_ms());
        plan_mutation_dao::insert_mutation(
            &tx,
            &NewPlanMutation {
                mutation_id: change_mutation_id.clone(),
                project_id: plan.project_id,
                plan_id: plan.id,
                r#type: PlanMutationType::ChangeStep,
                step_db_id: Some(target.id),
                stable_step_id: Some(target.step_id.clone()),
                reason: mutation_reason.clone(),
                criterion_ids: Vec::new(),
                prd_delta: target_update.delta.clone(),
                scope_expansion: ScopeExpansionAssessment {
                    expanded: false,
                    reason_codes: Vec::new(),
                    evidence_refs: Vec::new(),
                },
            },
        )
        .map_err(|e| e.to_string())?;
        let mut payload = dive_event_log::plan_step_changed_payload(
            change_mutation_id,
            plan.project_id,
            plan.id,
            target.id,
            target.step_id.clone(),
            vec!["status".into(), "superseded_by_step_id".into()],
            Vec::new(),
            target_update.from_version,
            target_update.to_version,
        );
        if let Value::Object(map) = &mut payload {
            map.insert(
                "superseded_by_step_id".into(),
                json!(new_row.step_id.clone()),
            );
            map.insert("step_title".into(), json!(target.title.clone()));
            map.insert("message".into(), json!("Step superseded by replacement"));
            map.insert("reason".into(), json!(mutation_reason));
        }
        // Wily P2 cleanup: stamp with the project's session instead of `None` —
        // see `latest_session_id_for_project` doc comment for why this matters.
        let supersede_session_id =
            super::plan_lifecycle::latest_session_id_for_project(&tx, plan.project_id);
        dive_event_log::append_to_conn(
            &tx,
            supersede_session_id,
            dive_event_log::PLAN_STEP_CHANGED_EVENT,
            payload,
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        new_row
    };
    maybe_create_pre_pivot_checkpoint(state, pre_pivot_checkpoint);
    let project_root = state.project_root_required()?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    workspace_plan_service::artifacts::export_plan_artifacts(db.conn(), plan_id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(new_row)
}

/// S-033: fan a genuinely multi-part ask into a dependency-ordered batch of
/// steps. Validates the whole batch up front (envelope, in-range/acyclic
/// sibling edges), inserts in topological order rewriting each draft's
/// `depends_on_draft` to the assigned sibling step_ids, and detects duplicates
/// (including intra-batch) as each step becomes visible — all in one
/// transaction so a partial fan-out can never leak.
pub fn workspace_plan_append_steps_impl(
    state: &AppState,
    plan_id: i64,
    drafts: Vec<MultiStepDraftInput>,
    options: AppendStepOptions,
) -> Result<Vec<StepRow>, String> {
    if drafts.is_empty() {
        return Err("no steps to append".into());
    }
    for (i, item) in drafts.iter().enumerate() {
        for &dep in &item.depends_on_draft {
            if dep >= drafts.len() {
                return Err(format!("dependsOnDraft index {dep} is out of range"));
            }
            if dep == i {
                return Err("a draft cannot depend on itself".into());
            }
        }
    }
    let order = topo_sort_drafts(&drafts)?;
    let batch_reason = options
        .mutation_reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    {
        // Wily P2 cleanup: reject before any mutation/checkpoint/export if the
        // plan's own project isn't the currently selected (ambient) one.
        let db = state.db.lock().map_err(|e| e.to_string())?;
        super::plan_lifecycle::require_plan_matches_ambient_project_root(
            state,
            db.conn(),
            plan_id,
        )?;
    }
    let pre_pivot_checkpoint = prepare_pre_pivot_checkpoint(state, plan_id);
    let rows = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let conn = db.conn_mut();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let plan = plan_dao::get_by_id(&tx, plan_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("plan {plan_id} not found"))?;
        if plan.status != "approved" {
            return Err("plan must be approved before appending steps".into());
        }
        let existing_count = step_dao::list_active_by_plan(&tx, plan_id)
            .map_err(|e| e.to_string())?
            .len();
        if existing_count + drafts.len() > MAX_PLAN_STEPS {
            return Err(format!(
                "plan exceeds DIVE execution envelope: at most {MAX_PLAN_STEPS} steps are allowed"
            ));
        }

        // Wily P2 cleanup: `options.linked_criterion_ids`/`options.prd_delta`
        // are batch-wide (one flat list / one delta for the whole call, same
        // shape as the single-append `AppendStepOptions`) — the batch used to
        // read only `options.mutation_reason` and silently drop both. A
        // non-empty override list applies to every draft in the batch, same
        // as the single-append path; the shared PRD delta is attached exactly
        // once, to the first step in insertion order, so a batch of N drafts
        // does not create N duplicate copies of the same added criteria.
        let batch_linked_criterion_ids =
            compact_linked_criterion_ids(&options.linked_criterion_ids);
        let mut assigned: std::collections::HashMap<usize, String> =
            std::collections::HashMap::new();
        let mut rows = Vec::with_capacity(drafts.len());
        for (position, &idx) in order.iter().enumerate() {
            let mut draft = drafts[idx].draft.clone();
            if !batch_linked_criterion_ids.is_empty() {
                draft.linked_criterion_ids = batch_linked_criterion_ids.clone();
            } else {
                draft.linked_criterion_ids =
                    compact_linked_criterion_ids(&draft.linked_criterion_ids);
            }
            for &dep in &drafts[idx].depends_on_draft {
                let sibling = assigned.get(&dep).ok_or_else(|| {
                    "internal: sibling draft not inserted before dependent".to_string()
                })?;
                if !draft.dependencies.contains(sibling) {
                    draft.dependencies.push(sibling.clone());
                }
            }
            validate_append_draft(&draft)?;
            sanitize_step_verification(&mut draft);
            validate_draft_dependencies(&tx, plan_id, &draft.dependencies)?;
            if let Some(existing) = find_duplicate_step(&tx, plan_id, &draft)? {
                return Err(format!(
                    "step already exists: {} ({})",
                    existing.step_id, existing.title
                ));
            }
            let step_prd_delta = if position == 0 {
                options.prd_delta.as_ref()
            } else {
                None
            };
            let row =
                append_step_within_tx(&tx, &plan, &draft, batch_reason.as_deref(), step_prd_delta)?;
            assigned.insert(idx, row.step_id.clone());
            rows.push(row);
        }
        tx.commit().map_err(|e| e.to_string())?;
        rows
    };
    maybe_create_pre_pivot_checkpoint(state, pre_pivot_checkpoint);
    let project_root = state.project_root_required()?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    workspace_plan_service::artifacts::export_plan_artifacts(db.conn(), plan_id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// S-033: Kahn topological sort over draft-local `depends_on_draft` edges.
/// Returns the insert order, or an error when the batch contains a cycle. Ties
/// break by original index so the order is deterministic.
fn topo_sort_drafts(drafts: &[MultiStepDraftInput]) -> Result<Vec<usize>, String> {
    let n = drafts.len();
    let mut indegree = vec![0usize; n];
    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, item) in drafts.iter().enumerate() {
        for &dep in &item.depends_on_draft {
            dependents[dep].push(i);
            indegree[i] += 1;
        }
    }
    let mut queue: std::collections::VecDeque<usize> =
        (0..n).filter(|&i| indegree[i] == 0).collect();
    let mut order = Vec::with_capacity(n);
    while let Some(node) = queue.pop_front() {
        order.push(node);
        for &next in &dependents[node] {
            indegree[next] -= 1;
            if indegree[next] == 0 {
                queue.push_back(next);
            }
        }
    }
    if order.len() != n {
        return Err("multi-step batch has a dependency cycle".into());
    }
    Ok(order)
}

/// S-033: reject retiring a step that an active step still depends on, so a
/// remove can never leave the active plan with a dangling dependency.
fn validate_no_active_dependents(
    conn: &rusqlite::Connection,
    plan_id: i64,
    target_step_id: &str,
) -> Result<(), String> {
    let steps = step_dao::list_active_by_plan(conn, plan_id).map_err(|e| e.to_string())?;
    for step in steps {
        if step.step_id == target_step_id {
            continue;
        }
        let depends = step
            .dependencies
            .as_ref()
            .and_then(|deps| deps.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|dep| dep.as_str())
                    .any(|dep| dep == target_step_id)
            })
            .unwrap_or(false);
        if depends {
            return Err(format!(
                "cannot remove {target_step_id}: step {} depends on it",
                step.step_id
            ));
        }
    }
    Ok(())
}

/// Supersede fix: rewrite every active step's `dependencies` that names
/// `target_step_id` to `replacement_step_id` instead, so the dependency
/// graph stays satisfiable once the target is marked superseded (and
/// therefore excluded from `list_active_by_plan`/`done_step_ids`). Leaves
/// steps that don't depend on the target untouched.
fn repoint_active_dependents(
    conn: &rusqlite::Connection,
    plan_id: i64,
    target_step_id: &str,
    replacement_step_id: &str,
) -> Result<(), String> {
    for step in step_dao::list_active_by_plan(conn, plan_id).map_err(|e| e.to_string())? {
        let Some(deps) = step.dependencies.as_ref().and_then(Value::as_array) else {
            continue;
        };
        let mut new_deps: Vec<String> = deps
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        if !new_deps.iter().any(|dep| dep == target_step_id) {
            continue;
        }
        for dep in &mut new_deps {
            if dep == target_step_id {
                *dep = replacement_step_id.to_string();
            }
        }
        new_deps.sort();
        new_deps.dedup();
        step_dao::update(
            conn,
            step.id,
            &NewStep {
                plan_id: step.plan_id,
                step_id: step.step_id.clone(),
                title: step.title.clone(),
                summary: step.summary.clone(),
                instruction_seed: step.instruction_seed.clone(),
                expected_files: step.expected_files.clone(),
                acceptance_criteria: step.acceptance_criteria.clone(),
                step_kind: step.step_kind,
                verification_kind: step.verification_kind.clone(),
                verification_command: step.verification_command.clone(),
                verification_manual_check: step.verification_manual_check.clone(),
                dependencies: Some(json!(new_deps)),
                parallel_group: step.parallel_group.clone(),
                position: step.position,
            },
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

const RATIONALE_OFFER_KIND: &str = "redecompose_step";
const RATIONALE_OFFER_MESSAGE: &str =
    "계획 영역에서 이 단계를 다시 나누는 제안을 검토할 수 있어요.";

fn rationale_offer_id(objection_id: &str) -> String {
    format!("offer:{objection_id}")
}

fn rationale_offer_seed(step_title: &str, objection_text: &str) -> String {
    format!("'{step_title}' 단계 재분해 검토: {}", objection_text.trim())
}

pub fn workspace_plan_challenge_step_rationale_impl(
    state: &AppState,
    input: StepRationaleChallengeInput,
) -> Result<StepRationaleChallengeOutput, String> {
    let text = input.text.trim().to_string();
    if text.is_empty() {
        return Err("objection text is required".into());
    }
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    // Wily P2 cleanup: reject before any mutation/export if the plan's own
    // project isn't the currently selected (ambient) one.
    super::plan_lifecycle::require_plan_matches_ambient_project_root(state, conn, input.plan_id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let plan = plan_dao::get_by_id(&tx, input.plan_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("plan {} not found", input.plan_id))?;
    let step = step_dao::get_by_id(&tx, input.step_db_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("step {} not found", input.step_db_id))?;
    if step.plan_id != plan.id {
        return Err(format!(
            "step {} does not belong to plan {}",
            step.id, plan.id
        ));
    }
    let linked_criterion_ids = {
        let provided = compact_linked_criterion_ids(&input.linked_criterion_ids);
        if provided.is_empty() {
            json_linked_criterion_ids(step.acceptance_criteria.as_ref())
        } else {
            provided
        }
    };
    let objection_id = format!("obj-{}-{}", step.step_id, now_ms());
    let offer_id = rationale_offer_id(&objection_id);
    let suggested_seed = rationale_offer_seed(&step.title, &text);
    plan_mutation_dao::insert_objection(
        &tx,
        &NewObjection {
            objection_id: objection_id.clone(),
            project_id: plan.project_id,
            plan_id: plan.id,
            step_db_id: step.id,
            stable_step_id: step.step_id.clone(),
            text: text.clone(),
            linked_criterion_ids: linked_criterion_ids.clone(),
            suggestion_status: ObjectionSuggestionStatus::Offered,
        },
    )
    .map_err(|e| e.to_string())?;
    let mut payload = dive_event_log::plan_step_rationale_challenged_payload(
        plan.project_id,
        plan.id,
        step.id,
        step.step_id.clone(),
        linked_criterion_ids,
        objection_id.clone(),
        text,
        "offered",
    );
    if let Value::Object(map) = &mut payload {
        map.insert(
            "message".into(),
            Value::String("Step rationale challenged".into()),
        );
        map.insert("step_title".into(), Value::String(step.title.clone()));
    }
    // Wily P2 cleanup: stamp with the project's session instead of `None` — see
    // `latest_session_id_for_project` doc comment for why this matters for export.
    let challenge_session_id =
        super::plan_lifecycle::latest_session_id_for_project(&tx, plan.project_id);
    dive_event_log::append_to_conn(
        &tx,
        challenge_session_id,
        dive_event_log::PLAN_STEP_RATIONALE_CHALLENGED_EVENT,
        payload,
    )
    .map_err(|e| e.to_string())?;
    let offer_payload = dive_event_log::plan_adjustment_offered_payload(
        plan.project_id,
        plan.id,
        step.id,
        step.step_id.clone(),
        objection_id.clone(),
        offer_id.clone(),
        RATIONALE_OFFER_KIND,
        RATIONALE_OFFER_MESSAGE,
    );
    dive_event_log::append_to_conn(
        &tx,
        challenge_session_id,
        dive_event_log::PLAN_ADJUSTMENT_OFFERED_EVENT,
        offer_payload,
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let project_root = state.project_root_required()?;
    workspace_plan_service::artifacts::export_plan_artifacts(conn, plan.id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(StepRationaleChallengeOutput {
        objection_id,
        suggestion_status: "offered".into(),
        offer_id,
        offer_kind: RATIONALE_OFFER_KIND.into(),
        message: RATIONALE_OFFER_MESSAGE.into(),
        suggested_seed: Some(suggested_seed),
    })
}

pub fn workspace_plan_respond_to_plan_adjustment_offer_impl(
    state: &AppState,
    input: PlanAdjustmentOfferResponseInput,
) -> Result<PlanAdjustmentOfferResponseOutput, String> {
    let response = input.response;
    let status = response.suggestion_status();
    let event_type = response.event_type();
    if input.offer_id != rationale_offer_id(&input.objection_id) {
        return Err("offer does not match objection".into());
    }

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    // Wily P2 cleanup: reject before any mutation/export if the plan's own
    // project isn't the currently selected (ambient) one.
    super::plan_lifecycle::require_plan_matches_ambient_project_root(state, conn, input.plan_id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let objection = plan_mutation_dao::get_objection(&tx, &input.objection_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("objection {} not found", input.objection_id))?;
    if objection.plan_id != input.plan_id || objection.step_db_id != input.step_db_id {
        return Err("offer context does not match objection".into());
    }
    if objection.suggestion_status == ObjectionSuggestionStatus::None {
        return Err("objection has no plan-adjustment offer".into());
    }
    let updated =
        plan_mutation_dao::update_objection_suggestion_status(&tx, &input.objection_id, status)
            .map_err(|e| e.to_string())?;
    let payload = dive_event_log::plan_adjustment_response_payload(
        updated.project_id,
        updated.plan_id,
        updated.step_db_id,
        updated.stable_step_id.clone(),
        updated.objection_id.clone(),
        input.offer_id.clone(),
        response.as_str(),
    );
    // Wily P2 cleanup: stamp with the project's session instead of `None` — see
    // `latest_session_id_for_project` doc comment for why this matters for export.
    let response_session_id =
        super::plan_lifecycle::latest_session_id_for_project(&tx, updated.project_id);
    dive_event_log::append_to_conn(&tx, response_session_id, event_type, payload)
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let project_root = state.project_root_required()?;
    workspace_plan_service::artifacts::export_plan_artifacts(conn, updated.plan_id, &project_root)
        .map_err(|e| e.to_string())?;
    Ok(PlanAdjustmentOfferResponseOutput {
        objection_id: updated.objection_id,
        offer_id: input.offer_id,
        suggestion_status: response.as_str().to_string(),
    })
}

pub(super) fn build_router_context(
    plan: &PlanRow,
    steps: &[StepRow],
    mappings: &[StepSessionMappingRow],
) -> PlanRouterContext {
    let done_ids = done_step_ids(steps, mappings);
    PlanRouterContext {
        goal: plan.goal.clone(),
        intent_summary: plan.intent_summary.clone(),
        scope: json_string_array(plan.scope.as_ref()),
        acceptance_criteria: json_string_array(plan.acceptance_criteria.as_ref()),
        steps: steps
            .iter()
            .map(|step| {
                let status = mappings
                    .iter()
                    .find(|mapping| mapping.step_id == step.id)
                    .map(|mapping| mapping.status.clone())
                    .unwrap_or_else(|| {
                        if dependencies_done(step, &done_ids) {
                            "ready".into()
                        } else {
                            "blocked".into()
                        }
                    });
                PlanRouterStepContext {
                    step_id: step.step_id.clone(),
                    title: step.title.clone(),
                    status,
                    dependencies: json_string_array(step.dependencies.as_ref()),
                }
            })
            .collect(),
    }
}

/// S-033: map a router draft into a `StepDraftInput` WITHOUT allocating a
/// `step_id`/`position`. Used by the multi_step route arm, where the batch apply
/// IPC (`workspace_plan_append_steps`) owns id allocation in topo order — eager
/// per-draft allocation here would hand every sibling the same id. Shared with
/// `step_draft_input_from_router` so the field mapping has one source of truth.
pub(super) fn router_draft_to_input_unallocated(draft: RouterStepDraft) -> StepDraftInput {
    StepDraftInput {
        title: draft.title,
        summary: draft.summary,
        instruction_seed: draft.instruction_seed,
        expected_files: draft.expected_files,
        acceptance_criteria: draft
            .acceptance_criteria
            .into_iter()
            .map(AcceptanceCriterionInput::Text)
            .collect(),
        linked_criterion_ids: Vec::new(),
        rationale: None,
        step_kind: draft.step_kind,
        verification_command: draft.verification_command,
        verification_type: draft.verification_type,
        dependencies: draft.dependencies,
        parallel_group: draft.parallel_group,
        position: 0,
        step_id: String::new(),
    }
}

pub(super) fn step_draft_input_from_router(
    conn: &rusqlite::Connection,
    plan_id: i64,
    draft: RouterStepDraft,
) -> Result<StepDraftInput, String> {
    let mut input = router_draft_to_input_unallocated(draft);
    input.position = step_dao::next_position(conn, plan_id).map_err(|e| e.to_string())?;
    input.step_id = step_dao::next_step_id(conn, plan_id).map_err(|e| e.to_string())?;
    Ok(input)
}

pub(super) fn find_duplicate_step(
    conn: &rusqlite::Connection,
    plan_id: i64,
    draft: &StepDraftInput,
) -> Result<Option<StepRow>, String> {
    let draft_title = normalize_step_text(&draft.title);
    let draft_instruction = normalize_step_text(&draft.instruction_seed);
    let draft_summary = normalize_step_text(&draft.summary);

    for step in step_dao::list_active_by_plan(conn, plan_id).map_err(|e| e.to_string())? {
        let title_matches =
            !draft_title.is_empty() && draft_title == normalize_step_text(&step.title);
        let instruction_matches = step
            .instruction_seed
            .as_deref()
            .map(normalize_step_text)
            .is_some_and(|existing| !draft_instruction.is_empty() && existing == draft_instruction);
        let summary_matches = step
            .summary
            .as_deref()
            .map(normalize_step_text)
            .is_some_and(|existing| !draft_summary.is_empty() && existing == draft_summary);
        if title_matches || instruction_matches || summary_matches {
            return Ok(Some(step));
        }
    }
    Ok(None)
}

fn normalize_step_text(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .filter(|ch| ch.is_alphanumeric())
        .collect()
}

fn validate_append_draft(draft: &StepDraftInput) -> Result<(), String> {
    if draft.title.trim().is_empty() {
        return Err("step title is required".into());
    }
    if draft.summary.trim().is_empty() {
        return Err("step summary is required".into());
    }
    if draft.instruction_seed.trim().is_empty() {
        return Err("step instruction_seed is required".into());
    }
    validate_step_envelope(draft)?;
    Ok(())
}

fn validate_draft_dependencies(
    conn: &rusqlite::Connection,
    plan_id: i64,
    dependencies: &[String],
) -> Result<(), String> {
    let existing = step_dao::list_active_by_plan(conn, plan_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|step| step.step_id)
        .collect::<HashSet<_>>();
    for dependency in dependencies {
        if !existing.contains(dependency) {
            return Err(format!("invalid dependency: {dependency}"));
        }
    }
    Ok(())
}

fn json_string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    match value {
        Value::Array(items) => items.iter().filter_map(json_criterion_text).collect(),
        Value::Object(map) => map
            .get("criteria")
            .or_else(|| map.get("acceptanceCriteria"))
            .or_else(|| map.get("acceptance_criteria"))
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(json_criterion_text).collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

pub(super) fn json_linked_criterion_ids(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    let mut out = Vec::new();
    collect_json_linked_criterion_ids(value, &mut out);
    out
}

fn collect_json_linked_criterion_ids(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_json_linked_criterion_ids(item, out);
            }
        }
        Value::Object(map) => {
            if let Some(id) = map
                .get("criterionId")
                .or_else(|| map.get("criterion_id"))
                .and_then(Value::as_str)
            {
                push_unique(out, id.to_string());
            }
            for key in ["linkedCriterionIds", "linked_criterion_ids"] {
                if let Some(ids) = map.get(key).and_then(Value::as_array) {
                    for id in ids.iter().filter_map(Value::as_str) {
                        push_unique(out, id.to_string());
                    }
                }
            }
        }
        _ => {}
    }
}

pub(super) fn join_string_array(value: Option<&serde_json::Value>) -> Option<String> {
    let items = json_string_array(value);
    if items.is_empty() {
        None
    } else {
        Some(items.join("\n"))
    }
}

fn json_criterion_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_string());
    }
    let text = value.get("text").and_then(Value::as_str)?.trim();
    (!text.is_empty()).then(|| text.to_string())
}

#[cfg(test)]
mod supersede_repoint_tests {
    use super::*;
    use crate::db::dao::project as project_dao;
    use crate::db::models::{NewPlan, NewProject};

    /// Plan with an approved status, active step B (`step-001`), and active
    /// step C (`step-002`) that depends on B. Returns `(plan_id, step_b_db_id)`.
    fn seed_plan_with_dependent_chain(
        state: &AppState,
        project_root: &std::path::Path,
    ) -> (i64, i64) {
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
                goal: "Build the thing".into(),
                intent_summary: None,
                scope: None,
                non_goals: None,
                constraints: None,
                acceptance_criteria: None,
                status: "approved".into(),
            },
        )
        .unwrap();
        let step_b_db_id = step_dao::insert(
            db.conn(),
            &NewStep {
                plan_id,
                step_id: "step-001".into(),
                title: "Step B".into(),
                summary: Some("Summary B".into()),
                instruction_seed: Some("Seed B".into()),
                expected_files: Some(json!(["src/b.rs"])),
                acceptance_criteria: Some(json!(["Criterion B"])),
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
        step_dao::insert(
            db.conn(),
            &NewStep {
                plan_id,
                step_id: "step-002".into(),
                title: "Step C".into(),
                summary: Some("Summary C".into()),
                instruction_seed: Some("Seed C".into()),
                expected_files: Some(json!(["src/c.rs"])),
                acceptance_criteria: Some(json!(["Criterion C"])),
                step_kind: Default::default(),
                verification_kind: Some("manual".into()),
                verification_command: None,
                verification_manual_check: None,
                dependencies: Some(json!(["step-001"])),
                parallel_group: None,
                position: 2,
            },
        )
        .unwrap();
        (plan_id, step_b_db_id)
    }

    fn replacement_draft() -> StepDraftInput {
        StepDraftInput {
            title: "Step B replacement".into(),
            summary: "Replacement summary".into(),
            instruction_seed: "Replacement seed".into(),
            expected_files: vec!["src/b2.rs".into()],
            acceptance_criteria: vec![AcceptanceCriterionInput::Text(
                "Replacement criterion".into(),
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

    /// Regression for the P1 finding: before the fix, superseding B left C
    /// (which depends on B) permanently blocked — B drops out of
    /// `list_active_by_plan` once superseded, so `done_step_ids` could never
    /// contain it and C's dependency could never resolve. The fix re-points
    /// C's dependency at B's replacement in the same transaction.
    #[test]
    fn supersede_repoints_active_dependents_to_replacement() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();
        let (plan_id, step_b_db_id) = seed_plan_with_dependent_chain(&state, tmp.path());

        let replacement = workspace_plan_supersede_step_impl(
            &state,
            plan_id,
            step_b_db_id,
            replacement_draft(),
            AppendStepOptions::default(),
        )
        .unwrap();

        let db = state.db.lock().unwrap();
        let active = step_dao::list_active_by_plan(db.conn(), plan_id).unwrap();
        assert!(
            !active.iter().any(|s| s.step_id == "step-001"),
            "the superseded target must no longer be active"
        );
        let step_c = active
            .iter()
            .find(|s| s.step_id == "step-002")
            .expect("dependent step C stays active");
        let deps: Vec<&str> = step_c
            .dependencies
            .as_ref()
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect();
        assert_eq!(
            deps,
            vec![replacement.step_id.as_str()],
            "C must now depend on the replacement, not the retired target"
        );

        // Unblockable: C's only blocking dependency must be the replacement —
        // a real, still-active step whose completion can satisfy it — not the
        // retired target, which dropped out of `list_active_by_plan` and
        // could never appear in `done_step_ids`.
        let mappings = mappings_for_steps(db.conn(), &active).unwrap();
        let done_ids = done_step_ids(&active, &mappings);
        assert_eq!(
            blocked_dependency_ids(step_c, &done_ids),
            vec![replacement.step_id.clone()],
            "C must be blocked only on the resolvable replacement, not the retired target"
        );
    }
}

#[cfg(test)]
mod null_session_export_tests {
    use super::*;
    use crate::db::dao::{project as project_dao, session as session_dao};
    use crate::db::models::{NewPlan, NewProject, NewSession};
    use crate::export::{ExportEngine, ExportOptions};

    /// Regression for the P2 finding: plan-mutation EventLog rows used to be
    /// appended with `session_id = NULL`, which the only EventLog export path
    /// (`ExportEngine::export_session`, `WHERE session_id = ?`) can never
    /// match — the entire plan/PRD mutation history silently dropped out of
    /// the pilot JSONL. The fix stamps these rows with the project's latest
    /// session, so a `plan_step_appended` event must now be reachable through
    /// that session's real export.
    #[test]
    fn plan_step_appended_event_is_reachable_by_session_export() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();

        let (plan_id, session_id) = {
            let db = state.db.lock().unwrap();
            let project_id = project_dao::insert(
                db.conn(),
                &NewProject {
                    name: "p".into(),
                    path: tmp.path().to_string_lossy().into(),
                    provider_default: None,
                    model_default: None,
                },
            )
            .unwrap();
            let session_id = session_dao::insert(
                db.conn(),
                &NewSession {
                    project_id,
                    title: "Session 1".into(),
                    ended_at: None,
                    status: "active".into(),
                },
            )
            .unwrap();
            let plan_id = plan_dao::insert(
                db.conn(),
                &NewPlan {
                    project_id,
                    interview_id: None,
                    goal: "Build the thing".into(),
                    intent_summary: None,
                    scope: None,
                    non_goals: None,
                    constraints: None,
                    acceptance_criteria: None,
                    status: "approved".into(),
                },
            )
            .unwrap();
            (plan_id, session_id)
        };

        let draft = StepDraftInput {
            title: "Step A".into(),
            summary: "Summary A".into(),
            instruction_seed: "Seed A".into(),
            expected_files: vec!["src/a.rs".into()],
            acceptance_criteria: vec![AcceptanceCriterionInput::Text("Criterion A".into())],
            linked_criterion_ids: Vec::new(),
            rationale: None,
            step_kind: None,
            verification_command: None,
            verification_type: Some("manual".into()),
            dependencies: Vec::new(),
            parallel_group: None,
            position: 0,
            step_id: String::new(),
        };
        workspace_plan_append_step_impl(&state, plan_id, draft).unwrap();

        // The row's session_id must be the project's session, not NULL.
        let stored_session_id: Option<i64> = {
            let db = state.db.lock().unwrap();
            db.conn()
                .query_row(
                    "SELECT session_id FROM EventLog WHERE type = ?1 ORDER BY id DESC LIMIT 1",
                    [dive_event_log::PLAN_STEP_APPENDED_EVENT],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .unwrap()
        };
        assert_eq!(stored_session_id, Some(session_id));

        // And it must actually be reachable through the real export path —
        // this is the exact mechanism (`WHERE session_id = ?`) that a NULL
        // session_id could never satisfy.
        let engine = ExportEngine::new(state.db.clone());
        let exported = engine
            .export_session(session_id, &ExportOptions::default())
            .unwrap();
        assert!(
            exported.contains("plan_step_appended"),
            "exported JSONL must contain the plan_step_appended event: {exported}"
        );
    }
}

#[cfg(test)]
mod prd_delta_criterion_id_reconciliation_tests {
    use super::*;
    use crate::db::dao::project as project_dao;
    use crate::db::models::{AcceptanceCriterion, NewProject, ProjectSpecStatus};

    fn seed_project_with_prd(conn: &rusqlite::Connection) -> i64 {
        let project_id = project_dao::insert(
            conn,
            &NewProject {
                name: "p".into(),
                path: "/tmp/p".into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let now = now_ms();
        let snapshot = ProjectSpec {
            project_spec_id: format!("prd-{project_id}"),
            project_id,
            current_version: 1,
            goal: "Build the thing".into(),
            intent_summary: None,
            scope: Vec::new(),
            non_goals: Vec::new(),
            constraints: Vec::new(),
            acceptance_criteria: vec![AcceptanceCriterion {
                criterion_id: "AC-001".into(),
                text: "Existing criterion".into(),
                source: AcceptanceCriterionSource::Interview,
                status: AcceptanceCriterionStatus::Active,
                created_in_version: 1,
                retired_in_version: None,
            }],
            architecture: None,
            field_provenance: Default::default(),
            status: ProjectSpecStatus::Approved,
            created_at: now,
            updated_at: now,
        };
        prd_dao::insert_version(
            conn,
            &NewProjectSpecVersion {
                project_spec_id: snapshot.project_spec_id.clone(),
                project_id,
                version: 1,
                previous_version: None,
                snapshot,
                reason: "interview".into(),
                delta_summary: serde_json::json!({}),
            },
        )
        .unwrap();
        project_id
    }

    /// Regression for the P2 finding: a proposed added-criterion id that
    /// collides with one already in the current PRD snapshot gets reallocated
    /// only on the clone pushed into the snapshot — `delta.added_criteria`
    /// (persisted into `ProjectSpecVersion.delta_summary`, the `PRD_EDITED`
    /// added-ids, and `NewPlanMutation.prd_delta`) used to keep the stale,
    /// colliding id. The fix mutates `delta.added_criteria` in place so the
    /// ledger and the snapshot always agree.
    #[test]
    fn colliding_added_criterion_id_is_reconciled_in_the_persisted_delta() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();

        let db = state.db.lock().unwrap();
        let conn = db.conn();
        let project_id = seed_project_with_prd(conn);
        let latest_prd = prd_dao::latest_version(conn, project_id).unwrap().unwrap();

        let provided_delta = ProjectSpecDelta {
            from_version: 1,
            to_version: 2,
            added_criteria: vec![AcceptanceCriterion {
                // Deliberately reuses the existing "AC-001" id — the caller
                // (plan router / model output) has no visibility into the
                // live snapshot's already-assigned ids.
                criterion_id: "AC-001".into(),
                text: "New criterion colliding on id".into(),
                source: AcceptanceCriterionSource::PlanMutation,
                status: AcceptanceCriterionStatus::Active,
                created_in_version: 2,
                retired_in_version: None,
            }],
            retired_criterion_ids: Vec::new(),
            scope_changes: Vec::new(),
            non_goal_changes: Vec::new(),
        };

        let update = persist_prd_delta_for_plan_mutation(
            conn,
            project_id,
            Some(&latest_prd),
            Some(&provided_delta),
        )
        .unwrap();

        assert_eq!(update.delta.added_criteria.len(), 1);
        let reconciled_id = update.delta.added_criteria[0].criterion_id.clone();
        assert_ne!(
            reconciled_id, "AC-001",
            "the colliding id must have been reallocated"
        );

        // The reallocated id must be the SAME one that actually landed in the
        // persisted snapshot, not diverge from it.
        let persisted = prd_dao::latest_version(conn, project_id).unwrap().unwrap();
        let persisted_new_criterion = persisted
            .snapshot
            .acceptance_criteria
            .iter()
            .find(|c| c.text == "New criterion colliding on id")
            .expect("new criterion persisted in the snapshot");
        assert_eq!(
            persisted_new_criterion.criterion_id, reconciled_id,
            "the ledger's criterion id must match the snapshot's"
        );

        // The delta_summary (persisted + exported) must also carry the
        // reconciled id, not the stale one.
        assert_eq!(
            update.delta_summary["criterionIdsAdded"],
            serde_json::json!([reconciled_id]),
        );
    }
}

#[cfg(test)]
mod batch_append_options_tests {
    use super::*;
    use crate::db::dao::project as project_dao;
    use crate::db::models::{AcceptanceCriterion, NewPlan, NewProject, ProjectSpecStatus};

    fn seed_project_with_plan_and_prd(
        conn: &rusqlite::Connection,
        project_root: &std::path::Path,
    ) -> (i64, i64) {
        let project_id = project_dao::insert(
            conn,
            &NewProject {
                name: "p".into(),
                path: project_root.to_string_lossy().into(),
                provider_default: None,
                model_default: None,
            },
        )
        .unwrap();
        let now = now_ms();
        let snapshot = ProjectSpec {
            project_spec_id: format!("prd-{project_id}"),
            project_id,
            current_version: 1,
            goal: "Build the thing".into(),
            intent_summary: None,
            scope: Vec::new(),
            non_goals: Vec::new(),
            constraints: Vec::new(),
            acceptance_criteria: vec![AcceptanceCriterion {
                criterion_id: "AC-001".into(),
                text: "Existing criterion".into(),
                source: AcceptanceCriterionSource::Interview,
                status: AcceptanceCriterionStatus::Active,
                created_in_version: 1,
                retired_in_version: None,
            }],
            architecture: None,
            field_provenance: Default::default(),
            status: ProjectSpecStatus::Approved,
            created_at: now,
            updated_at: now,
        };
        prd_dao::insert_version(
            conn,
            &NewProjectSpecVersion {
                project_spec_id: snapshot.project_spec_id.clone(),
                project_id,
                version: 1,
                previous_version: None,
                snapshot,
                reason: "interview".into(),
                delta_summary: serde_json::json!({}),
            },
        )
        .unwrap();
        let plan_id = plan_dao::insert(
            conn,
            &NewPlan {
                project_id,
                interview_id: None,
                goal: "Build the thing".into(),
                intent_summary: None,
                scope: None,
                non_goals: None,
                constraints: None,
                acceptance_criteria: None,
                status: "approved".into(),
            },
        )
        .unwrap();
        (project_id, plan_id)
    }

    fn batch_draft(title: &str) -> MultiStepDraftInput {
        MultiStepDraftInput {
            draft: StepDraftInput {
                title: title.into(),
                summary: format!("{title} summary"),
                instruction_seed: format!("{title} seed"),
                expected_files: vec![format!("src/{title}.rs")],
                acceptance_criteria: vec![AcceptanceCriterionInput::Text(format!(
                    "{title} criterion"
                ))],
                linked_criterion_ids: Vec::new(),
                rationale: None,
                step_kind: None,
                verification_command: None,
                verification_type: Some("manual".into()),
                dependencies: Vec::new(),
                parallel_group: None,
                position: 0,
                step_id: String::new(),
            },
            depends_on_draft: Vec::new(),
        }
    }

    /// Regression for the P2 finding: `workspace_plan_append_steps` accepted
    /// `linkedCriterionIds`/`prdDelta` (the same batch-wide shape as the
    /// single-append `AppendStepOptions`) but the batch impl silently dropped
    /// both, honoring only `mutationReason`. The fix applies the linked-id
    /// override to every draft in the batch and applies the shared PRD delta
    /// exactly once (to the first step), instead of duplicating it per step.
    #[test]
    fn batch_append_honors_linked_criterion_ids_and_applies_prd_delta_once() {
        let state = AppState::dev_mock();
        let tmp = tempfile::tempdir().unwrap();
        state.swap_project_root(tmp.path().to_path_buf()).unwrap();

        let (project_id, plan_id) = {
            let db = state.db.lock().unwrap();
            seed_project_with_plan_and_prd(db.conn(), tmp.path())
        };

        let options = AppendStepOptions {
            mutation_reason: None,
            linked_criterion_ids: vec!["AC-001".into()],
            prd_delta: Some(ProjectSpecDelta {
                from_version: 1,
                to_version: 2,
                added_criteria: vec![AcceptanceCriterion {
                    criterion_id: "AC-900".into(),
                    text: "New batch-added criterion".into(),
                    source: AcceptanceCriterionSource::PlanMutation,
                    status: AcceptanceCriterionStatus::Active,
                    created_in_version: 2,
                    retired_in_version: None,
                }],
                retired_criterion_ids: Vec::new(),
                scope_changes: Vec::new(),
                non_goal_changes: Vec::new(),
            }),
        };

        let rows = workspace_plan_append_steps_impl(
            &state,
            plan_id,
            vec![batch_draft("stepone"), batch_draft("steptwo")],
            options,
        )
        .unwrap();
        assert_eq!(rows.len(), 2);

        // Every step in the batch must carry the batch-level linked criterion
        // override, not silently drop it.
        for row in &rows {
            let linked = json_linked_criterion_ids(row.acceptance_criteria.as_ref());
            assert_eq!(
                linked,
                vec!["AC-001".to_string()],
                "batch-level linkedCriterionIds must apply to every step, not just the first"
            );
        }

        // The shared PRD delta must be applied exactly once, not once per
        // step in the batch: every `append_step_within_tx` call bumps the PRD
        // version regardless of whether it carries a delta (pre-existing,
        // unrelated to this fix), so assert on content, not the version
        // number — the new criterion must appear exactly once, by text
        // (matching by id alone would miss the pre-fix bug, which reallocated
        // a *different* id — e.g. "AC-901" — for the batch's second copy
        // instead of reusing "AC-900").
        let db = state.db.lock().unwrap();
        let latest_prd = prd_dao::latest_version(db.conn(), project_id)
            .unwrap()
            .expect("prd version exists");
        let occurrences = latest_prd
            .snapshot
            .acceptance_criteria
            .iter()
            .filter(|c| c.text == "New batch-added criterion")
            .count();
        assert_eq!(
            occurrences, 1,
            "the batch's shared added criterion must not be duplicated once per step"
        );
    }
}
