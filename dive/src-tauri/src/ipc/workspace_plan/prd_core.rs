//! PRD read/write I/O, project-spec normalization, and draft persistence.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::collections::{BTreeMap, HashSet};

use serde_json::{json, Value};

use crate::db::dao::{
    interview as interview_dao, plan as plan_dao, prd as prd_dao, project as project_dao,
    step as step_dao,
};
use crate::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus,
    LiveProjectSpecDraftRow, NewLiveProjectSpecDraft, NewProjectSpecVersion,
    PrdPatchValidationOutcome, ProjectSpec, ProjectSpecDraft, ProjectSpecStatus,
    ProjectSpecVersionRow, ProvenanceSource,
};
use crate::db::now_ms;
use crate::dive::event_log as dive_event_log;
use crate::ipc::AppState;
use crate::providers::FinishReason;

use super::*;

pub fn workspace_plan_status_impl(
    state: &AppState,
    project_id: i64,
) -> Result<WorkspacePlanStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let prd_status = workspace_prd_status_from_conn(db.conn(), project_id)?;
    let plan = plan_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?;
    let Some(plan) = plan else {
        if prd_status.status != "minimal" {
            let status = if prd_status.status == "draft" {
                "prd_draft"
            } else {
                "needs_prd"
            };
            return Ok(WorkspacePlanStatus {
                status: status.to_string(),
                has_plan: false,
                has_approved_plan: false,
                plan_summary: None,
                plan_id: None,
                step_count: 0,
                ready_count: 0,
                blocked_count: 0,
                active_count: 0,
                done_count: 0,
                prd_status,
            });
        }
        let interview =
            interview_dao::get_by_project(db.conn(), project_id).map_err(|e| e.to_string())?;
        let status = interview
            .as_ref()
            .map(|row| match row.status.as_str() {
                "draft" => "interview_draft",
                "submitted" => "interview_submitted",
                "approved" => "interview_approved",
                _ => "needs_interview",
            })
            .unwrap_or("needs_interview");
        return Ok(WorkspacePlanStatus {
            status: status.to_string(),
            has_plan: false,
            has_approved_plan: false,
            plan_summary: None,
            plan_id: None,
            step_count: 0,
            ready_count: 0,
            blocked_count: 0,
            active_count: 0,
            done_count: 0,
            prd_status,
        });
    };

    let steps = step_dao::list_active_by_plan(db.conn(), plan.id).map_err(|e| e.to_string())?;
    let mappings = mappings_for_steps(db.conn(), &steps)?;
    let progress = derive_plan_progress(&steps, &mappings);

    Ok(WorkspacePlanStatus {
        status: if plan.status == "approved" {
            "approved".into()
        } else {
            "draft".into()
        },
        has_plan: true,
        has_approved_plan: plan.status == "approved",
        plan_summary: Some(plan.goal),
        plan_id: Some(plan.id),
        step_count: progress.step_count,
        ready_count: progress.ready_count,
        blocked_count: progress.blocked_count,
        active_count: progress.active_count,
        done_count: progress.done_count,
        prd_status,
    })
}

pub fn workspace_prd_status_impl(
    state: &AppState,
    project_id: i64,
) -> Result<WorkspacePrdStatus, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    workspace_prd_status_from_conn(db.conn(), project_id)
}

pub fn workspace_prd_get_impl(
    state: &AppState,
    project_id: i64,
) -> Result<Option<ProjectSpec>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(prd_dao::latest_version(db.conn(), project_id)
        .map_err(|e| e.to_string())?
        .map(|row| row.snapshot))
}

pub fn workspace_prd_draft_get_impl(
    state: &AppState,
    project_id: i64,
    draft_id: Option<String>,
) -> Result<LiveProjectSpecDraftRow, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    project_dao::get_by_id(db.conn(), project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {} not found", project_id))?;
    load_or_create_prd_draft(
        db.conn(),
        project_id,
        draft_id.as_deref().unwrap_or_default(),
    )
}

pub fn workspace_prd_draft_save_impl(
    state: &AppState,
    input: PrdDraftSaveInput,
) -> Result<LiveProjectSpecDraftRow, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    project_dao::get_by_id(conn, input.project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {} not found", input.project_id))?;
    let mut draft = input.draft;
    draft.project_id = input.project_id;
    draft.spec.project_id = input.project_id;
    if draft.draft_id.trim().is_empty() {
        draft.draft_id = format!("prd-draft-{}", input.project_id);
    }
    draft.updated_at = now_ms();
    persist_live_prd_draft(conn, &draft)?;
    Ok(draft)
}

pub fn workspace_prd_save_impl(
    state: &AppState,
    input: PrdSaveInput,
) -> Result<ProjectSpec, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let conn = db.conn_mut();
    project_dao::get_by_id(conn, input.project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {} not found", input.project_id))?;
    let save_reason = normalize_prd_save_reason(&input.reason);
    let latest = prd_dao::latest_version(conn, input.project_id).map_err(|e| e.to_string())?;
    // S-053 D3: the confirmed field_provenance comes from the persisted live
    // draft, not the wire `PrdSaveInput` (see project_spec_from_save_input doc
    // comment). Looked up before `input` moves into that call.
    let draft_field_provenance = prd_dao::get_draft(conn, input.project_id)
        .map_err(|e| e.to_string())?
        .map(|row| row.field_provenance)
        .unwrap_or_default();
    let snapshot =
        project_spec_from_save_input(input, latest.as_ref(), &save_reason, draft_field_provenance)?;
    if !is_confirmable_project_spec(&snapshot) {
        return Err(
            "PRD confirmation requires a goal, at least one acceptance criterion, and a decided architecture (form and tech stack)"
                .into(),
        );
    }
    let previous_version = latest.as_ref().map(|row| row.version);
    let reason = save_reason;
    let delta_summary = prd_delta_summary(latest.as_ref().map(|row| &row.snapshot), &snapshot);
    let changed_fields =
        changed_project_spec_fields(latest.as_ref().map(|row| &row.snapshot), &snapshot);
    let added_criterion_ids =
        added_criterion_ids(latest.as_ref().map(|row| &row.snapshot), &snapshot);
    let retired_criterion_ids =
        retired_criterion_ids(latest.as_ref().map(|row| &row.snapshot), &snapshot);
    let criterion_ids = snapshot
        .acceptance_criteria
        .iter()
        .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
        .map(|criterion| criterion.criterion_id.clone())
        .collect::<Vec<_>>();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    prd_dao::insert_version(
        &tx,
        &NewProjectSpecVersion {
            project_spec_id: snapshot.project_spec_id.clone(),
            project_id: snapshot.project_id,
            version: snapshot.current_version,
            previous_version,
            snapshot: snapshot.clone(),
            reason: reason.clone(),
            delta_summary: delta_summary.clone(),
        },
    )
    .map_err(|e| e.to_string())?;
    prd_dao::delete_draft(&tx, snapshot.project_id).map_err(|e| e.to_string())?;

    if previous_version.is_none() {
        dive_event_log::append_to_conn(
            &tx,
            None,
            dive_event_log::PRD_AUTHORED_EVENT,
            dive_event_log::prd_authored_payload(
                snapshot.project_id,
                snapshot.project_spec_id.clone(),
                snapshot.current_version,
                criterion_ids,
                summarize_prd(&snapshot),
            ),
        )
        .map_err(|e| e.to_string())?;
    } else {
        dive_event_log::append_to_conn(
            &tx,
            None,
            dive_event_log::PRD_EDITED_EVENT,
            dive_event_log::prd_edited_payload(
                snapshot.project_id,
                snapshot.project_spec_id.clone(),
                previous_version.unwrap_or(0),
                snapshot.current_version,
                reason,
                changed_fields,
                added_criterion_ids,
                retired_criterion_ids,
            ),
        )
        .map_err(|e| e.to_string())?;
    }
    dive_event_log::append_to_conn(
        &tx,
        None,
        dive_event_log::PRD_VERSION_CREATED_EVENT,
        dive_event_log::prd_version_created_payload(
            snapshot.project_id,
            snapshot.project_spec_id.clone(),
            snapshot.current_version,
            previous_version,
            delta_summary,
        ),
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(snapshot)
}

/// Maps the stringly-typed `validation_outcome` this module has always used on
/// the wire (`PrdInterviewTurnOutput.validation_outcome`, `AppliedPrdPatch`)
/// onto the typed `PrdPatchValidationOutcome` enum for the `InterviewTurn`
/// row. Infallible by construction: every value this module ever assigns to
/// `validation_outcome` is one of these five literals.
pub(super) fn prd_validation_outcome_enum(value: &str) -> PrdPatchValidationOutcome {
    match value {
        "applied" => PrdPatchValidationOutcome::Applied,
        "rejected" => PrdPatchValidationOutcome::Rejected,
        "held_for_student" => PrdPatchValidationOutcome::HeldForStudent,
        "not_structured" => PrdPatchValidationOutcome::NotStructured,
        _ => PrdPatchValidationOutcome::None,
    }
}

fn workspace_prd_status_from_conn(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<WorkspacePrdStatus, String> {
    project_dao::get_by_id(conn, project_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("project {project_id} not found"))?;
    let latest = prd_dao::latest_version(conn, project_id).map_err(|e| e.to_string())?;
    let draft = prd_dao::get_draft(conn, project_id).map_err(|e| e.to_string())?;
    if let Some(row) = latest
        .as_ref()
        .filter(|row| is_minimal_project_spec(&row.snapshot))
    {
        return Ok(WorkspacePrdStatus {
            status: "minimal".into(),
            project_spec_id: Some(row.project_spec_id.clone()),
            current_version: Some(row.version),
            draft_id: draft.as_ref().map(|row| row.draft_id.clone()),
            base_version: draft.as_ref().and_then(|row| row.base_version),
        });
    }
    if let Some(row) = draft {
        return Ok(WorkspacePrdStatus {
            status: "draft".into(),
            project_spec_id: row.spec.project_spec_id.clone(),
            current_version: row.spec.current_version,
            draft_id: Some(row.draft_id),
            base_version: row.base_version,
        });
    }
    if let Some(row) = latest {
        return Ok(WorkspacePrdStatus {
            status: "draft".into(),
            project_spec_id: Some(row.project_spec_id),
            current_version: Some(row.version),
            draft_id: None,
            base_version: None,
        });
    }
    Ok(WorkspacePrdStatus {
        status: "missing".into(),
        project_spec_id: None,
        current_version: None,
        draft_id: None,
        base_version: None,
    })
}

fn project_spec_from_save_input(
    input: PrdSaveInput,
    latest: Option<&ProjectSpecVersionRow>,
    reason: &str,
    // S-053 D3: the live draft's field_provenance is NOT part of `PrdSaveInput`
    // (it lives on the outer LiveProjectSpecDraft, sibling to dirty_fields —
    // never on the `spec` the client sends here). The caller looks up the
    // persisted draft row for this project and passes its map through so it
    // survives onto the confirmed snapshot without widening the save wire
    // shape.
    field_provenance: BTreeMap<String, ProvenanceSource>,
) -> Result<ProjectSpec, String> {
    let now = now_ms();
    let version = latest.map(|row| row.version + 1).unwrap_or(1);
    let project_spec_id = input
        .spec
        .project_spec_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| latest.map(|row| row.project_spec_id.clone()))
        .unwrap_or_else(|| format!("prd-{}", input.project_id));
    let acceptance_criteria = normalize_acceptance_criteria(
        input.spec.acceptance_criteria,
        version,
        criterion_source_for_reason(reason),
    );
    Ok(ProjectSpec {
        project_spec_id,
        project_id: input.project_id,
        current_version: version,
        goal: input.spec.goal.trim().to_string(),
        intent_summary: input
            .spec
            .intent_summary
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        scope: compact_unique_strings(input.spec.scope),
        non_goals: compact_unique_strings(input.spec.non_goals),
        constraints: compact_unique_strings(input.spec.constraints),
        acceptance_criteria,
        // S-047: carry the student's architecture decision onto the saved spec,
        // normalizing the stack and stamping the version DIVE recorded it at.
        architecture: input.spec.architecture.map(|mut architecture| {
            architecture.stack = architecture
                .stack
                .map(|stack| stack.trim().to_string())
                .filter(|stack| !stack.is_empty());
            architecture.decided_in_version = version;
            architecture
        }),
        field_provenance,
        status: input.spec.status,
        created_at: latest
            .map(|row| row.snapshot.created_at)
            .filter(|created_at| *created_at > 0)
            .unwrap_or(now),
        updated_at: now,
    })
}

fn normalize_prd_save_reason(reason: &str) -> String {
    match reason {
        "interview" | "student_edit" | "ai_assist" | "plan_mutation" => reason.to_string(),
        _ => "student_edit".into(),
    }
}

fn criterion_source_for_reason(reason: &str) -> AcceptanceCriterionSource {
    match reason {
        "interview" | "ai_assist" => AcceptanceCriterionSource::Interview,
        "plan_mutation" => AcceptanceCriterionSource::PlanMutation,
        _ => AcceptanceCriterionSource::StudentEdit,
    }
}

pub(super) fn compact_unique_strings(values: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for raw in values {
        let value = raw.trim();
        if !value.is_empty() && !out.iter().any(|existing| existing == value) {
            out.push(value.to_string());
        }
    }
    out
}

pub(super) fn normalize_acceptance_criteria(
    criteria: Vec<AcceptanceCriterion>,
    version: i64,
    fallback_source: AcceptanceCriterionSource,
) -> Vec<AcceptanceCriterion> {
    let mut out = Vec::new();
    let mut used_ids = HashSet::new();
    for mut criterion in criteria {
        let text = criterion.text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        criterion.text = text;
        criterion.criterion_id = criterion.criterion_id.trim().to_string();
        if !is_valid_acceptance_criterion_id(&criterion.criterion_id)
            || used_ids.contains(&criterion.criterion_id)
        {
            criterion.criterion_id = allocate_acceptance_criterion_id(&out);
        }
        used_ids.insert(criterion.criterion_id.clone());
        if criterion.created_in_version <= 0 {
            criterion.created_in_version = version;
        }
        if criterion.status != AcceptanceCriterionStatus::Retired {
            criterion.status = AcceptanceCriterionStatus::Active;
            criterion.retired_in_version = None;
        }
        if matches!(criterion.source, AcceptanceCriterionSource::Migration)
            && fallback_source != AcceptanceCriterionSource::Migration
        {
            criterion.source = fallback_source;
        }
        out.push(criterion);
    }
    out
}

/// 011 live-QA fix (tier1-run-log 2026-07-11, 저니 B): some models (observed
/// with claude-sonnet-5) echo the saved PRD criterion IDs ("AC-001") into the
/// plan draft's `acceptance_criteria` arrays instead of the criterion text —
/// the generation prompt's "Use the saved PRD criterion IDs exactly"
/// (intended for `linked_criterion_ids`) gets over-applied. Downstream
/// matching is text-equality only (`criterion_input_to_object`), so such a
/// reference reads as literal five-character text and the quality gate
/// blocked every plan as `criterion_too_short: "AC-001"`. Resolve exact
/// ACTIVE-criterion ID references to their full PRD criterion object before
/// validation, so both the gate and persistence see the real criterion.
/// Unknown or retired IDs stay literal and fail the gate honestly.
pub(super) fn resolve_prd_criterion_id_references(
    plan_input: &mut PlanDraftInput,
    prd: &crate::db::models::ProjectSpec,
) {
    fn resolve(input: &mut AcceptanceCriterionInput, criteria: &[AcceptanceCriterion]) {
        let AcceptanceCriterionInput::Text(value) = input else {
            return;
        };
        let candidate = value.trim();
        if candidate.is_empty() {
            return;
        }
        if let Some(existing) = criteria.iter().find(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && criterion.criterion_id == candidate
        }) {
            *input = AcceptanceCriterionInput::Object(existing.clone());
        }
    }
    for criterion in &mut plan_input.acceptance_criteria {
        resolve(criterion, &prd.acceptance_criteria);
    }
    for step in &mut plan_input.steps {
        for criterion in &mut step.acceptance_criteria {
            resolve(criterion, &prd.acceptance_criteria);
        }
    }
}

pub(super) fn criterion_input_text(input: &AcceptanceCriterionInput) -> Option<String> {
    match input {
        AcceptanceCriterionInput::Text(value) => {
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_string())
        }
        AcceptanceCriterionInput::Object(criterion) => {
            let value = criterion.text.trim();
            (!value.is_empty()).then(|| value.to_string())
        }
    }
}

fn criterion_input_to_object(
    input: &AcceptanceCriterionInput,
    existing: &[AcceptanceCriterion],
    version: i64,
    fallback_source: AcceptanceCriterionSource,
) -> Option<AcceptanceCriterion> {
    match input {
        AcceptanceCriterionInput::Text(text) => {
            let text = text.trim();
            if text.is_empty() {
                return None;
            }
            if let Some(existing) = existing.iter().find(|criterion| {
                criterion.status == AcceptanceCriterionStatus::Active
                    && criterion.text.trim() == text
            }) {
                return Some(existing.clone());
            }
            Some(AcceptanceCriterion {
                criterion_id: String::new(),
                text: text.to_string(),
                source: fallback_source,
                status: AcceptanceCriterionStatus::Active,
                created_in_version: version,
                retired_in_version: None,
            })
        }
        AcceptanceCriterionInput::Object(criterion) => Some(criterion.clone()),
    }
}

pub(super) fn normalize_criterion_inputs(
    inputs: &[AcceptanceCriterionInput],
    existing: &[AcceptanceCriterion],
    version: i64,
    fallback_source: AcceptanceCriterionSource,
) -> Vec<AcceptanceCriterion> {
    normalize_acceptance_criteria(
        inputs
            .iter()
            .filter_map(|input| {
                criterion_input_to_object(input, existing, version, fallback_source)
            })
            .collect(),
        version,
        fallback_source,
    )
}

pub(super) fn compact_linked_criterion_ids(ids: &[String]) -> Vec<String> {
    compact_unique_strings(ids.to_vec())
}

pub(super) fn criterion_by_id(
    criteria: &[AcceptanceCriterion],
    criterion_id: &str,
) -> Option<AcceptanceCriterion> {
    criteria
        .iter()
        .find(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && criterion.criterion_id == criterion_id
        })
        .cloned()
}

pub(super) fn is_minimal_project_spec(spec: &ProjectSpec) -> bool {
    !spec.goal.trim().is_empty()
        && spec.acceptance_criteria.iter().any(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && !criterion.text.trim().is_empty()
        })
}

/// S-047 (010 theme 7): an architecture is "decided" once a form is picked AND a
/// non-empty stack is set (the two-stage bar). Mirrors the draft gate in
/// `confirmable_draft_gaps` and the TS `validateConfirmableProjectSpec` stack check.
fn architecture_is_decided(spec: &ProjectSpec) -> bool {
    spec.architecture
        .as_ref()
        .and_then(|arch| arch.stack.as_deref())
        .is_some_and(|stack| !stack.trim().is_empty())
}

fn is_confirmable_project_spec(spec: &ProjectSpec) -> bool {
    // Server-side backstop for the confirm/version-commit path: a saved PRD must
    // clear the minimal bar AND carry a student-decided architecture (form + stack).
    // The frontend already blocks confirmation earlier; this defends a direct
    // `workspace_prd_save` call from persisting a half-decided architecture.
    is_minimal_project_spec(spec) && architecture_is_decided(spec)
}

// Confirm-gate thresholds mirror the frontend `validateConfirmableProjectSpec`
// (dive/src/features/planning/projectSpec.ts). The PRD interview readiness signal
// MUST track these so DIVE never tells the student to confirm while the "PRD 확정"
// button is disabled (round-2 S-041 / P1-09, P1-10). Lengths are char counts to
// match the TS validator's string-length semantics.
const MIN_CONFIRMABLE_GOAL_CHARS: usize = 10;
const MIN_CONFIRMABLE_INTENT_CHARS: usize = 8;
const MIN_CONFIRMABLE_LIST_ITEM_CHARS: usize = 4;
const MIN_CONFIRMABLE_CRITERION_CHARS: usize = 6;
const MIN_CONFIRMABLE_ACCEPTANCE_CRITERIA: usize = 2;
const VAGUE_GOAL_TERMS: &[&str] = &[
    "대충",
    "적당히",
    "알아서",
    "아무거나",
    "뭔가",
    "그냥 만들",
    "그냥 해",
    "something",
    "whatever",
    "anything",
];

pub(super) struct ConfirmableGap {
    /// Short field name for `missing_confirmable_prd_fields`.
    pub(super) label: &'static str,
    /// One-field interview focus instruction for `prd_interview_next_focus`.
    pub(super) focus: &'static str,
}

fn goal_is_vague(goal: &str) -> bool {
    let trimmed = goal.trim();
    let len = trimmed.chars().count();
    if len < MIN_CONFIRMABLE_GOAL_CHARS {
        return true;
    }
    if len < 24 {
        let lower = trimmed.to_lowercase();
        if VAGUE_GOAL_TERMS
            .iter()
            .any(|term| lower.contains(&term.to_lowercase()))
        {
            return true;
        }
    }
    false
}

fn substantive_list_count(values: &[String], min_chars: usize) -> usize {
    values
        .iter()
        .filter(|value| value.trim().chars().count() >= min_chars)
        .count()
}

fn substantive_active_criteria_count(criteria: &[AcceptanceCriterion]) -> usize {
    criteria
        .iter()
        .filter(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && criterion.text.trim().chars().count() >= MIN_CONFIRMABLE_CRITERION_CHARS
        })
        .count()
}

/// Ordered gaps between the draft and the confirmable bar. Empty == confirmable.
/// Mirrors `validateConfirmableProjectSpec` (non-vague goal + intent + >=1 scope +
/// >=1 non-goal + >=2 substantive criteria); constraints stay optional there too.
pub(super) fn confirmable_draft_gaps(spec: &ProjectSpecDraft) -> Vec<ConfirmableGap> {
    let mut gaps = Vec::new();
    let goal = spec.goal.trim();
    if goal.is_empty() {
        gaps.push(ConfirmableGap {
            label: "goal",
            focus: "clarify_goal_in_plain_language: ask who needs this, in what situation, and what problem it should solve",
        });
    } else if goal_is_vague(goal) {
        gaps.push(ConfirmableGap {
            label: "specific goal",
            focus: "sharpen_goal: the goal is too short or vague — ask one plain question so it names who it is for and what it should concretely do",
        });
    }
    let intent_len = spec
        .intent_summary
        .as_deref()
        .map(|value| value.trim().chars().count())
        .unwrap_or(0);
    if intent_len < MIN_CONFIRMABLE_INTENT_CHARS {
        gaps.push(ConfirmableGap {
            label: "intent summary",
            focus: "capture_intent_summary: ask in one plain question who will use this and why, so it can be summarized in one sentence",
        });
    }
    if substantive_list_count(&spec.scope, MIN_CONFIRMABLE_LIST_ITEM_CHARS) < 1 {
        gaps.push(ConfirmableGap {
            label: "in-scope item",
            focus: "capture_scope: ask what the first version should include — one concrete thing it must do",
        });
    }
    if substantive_list_count(&spec.non_goals, MIN_CONFIRMABLE_LIST_ITEM_CHARS) < 1 {
        gaps.push(ConfirmableGap {
            label: "non-goal",
            focus: "capture_non_goal: ask what the first version should NOT include or do — one thing to leave out for now",
        });
    }
    match substantive_active_criteria_count(&spec.acceptance_criteria) {
        0 => gaps.push(ConfirmableGap {
            label: "observable done state",
            focus: "capture_observable_done_state: ask what the student would see when the project is working",
        }),
        count if count < MIN_CONFIRMABLE_ACCEPTANCE_CRITERIA => gaps.push(ConfirmableGap {
            label: "second observable done state",
            focus: "capture_second_observable_done_state: ask for one more concrete, checkable sign that the project works, so there are at least two",
        }),
        _ => {}
    }
    // S-047: two-stage architecture decision, last (grounded on the goal/scope
    // above). The AI proposes <=2 options with plain rationale; the student decides.
    match spec.architecture.as_ref() {
        None => gaps.push(ConfirmableGap {
            label: "architecture form",
            focus: "propose_architecture_form: recommend up to 2 application forms that fit this goal (web app / static page / CLI tool / desktop app / API service), each with a one-line plain-language reason a beginner understands, then ask the student to pick or change one in the PRD board — never decide for them",
        }),
        Some(arch)
            if arch
                .stack
                .as_deref()
                .map(|stack| stack.trim().is_empty())
                .unwrap_or(true) =>
        {
            gaps.push(ConfirmableGap {
                label: "tech stack",
                focus: "propose_architecture_stack: recommend up to 2 concrete tech stacks that fit the chosen application form, each with a one-line beginner reason, then ask the student to pick or change one",
            })
        }
        Some(_) => {}
    }
    gaps
}

pub(super) fn allocate_acceptance_criterion_id(criteria: &[AcceptanceCriterion]) -> String {
    let mut max = 0_i64;
    for criterion in criteria {
        if let Some(raw) = criterion.criterion_id.strip_prefix("AC-") {
            if let Ok(value) = raw.parse::<i64>() {
                if value > 0 {
                    max = max.max(value);
                }
            }
        }
    }
    format!("AC-{:03}", max + 1)
}

pub(super) fn is_valid_acceptance_criterion_id(criterion_id: &str) -> bool {
    criterion_id
        .strip_prefix("AC-")
        .and_then(|raw| raw.parse::<i64>().ok())
        .map(|value| value > 0)
        .unwrap_or(false)
}

fn changed_project_spec_fields(previous: Option<&ProjectSpec>, next: &ProjectSpec) -> Vec<String> {
    let Some(previous) = previous else {
        return vec![
            "goal".into(),
            "intentSummary".into(),
            "scope".into(),
            "nonGoals".into(),
            "constraints".into(),
            "acceptanceCriteria".into(),
        ];
    };
    let mut fields = Vec::new();
    if previous.goal != next.goal {
        fields.push("goal".into());
    }
    if previous.intent_summary != next.intent_summary {
        fields.push("intentSummary".into());
    }
    if previous.scope != next.scope {
        fields.push("scope".into());
    }
    if previous.non_goals != next.non_goals {
        fields.push("nonGoals".into());
    }
    if previous.constraints != next.constraints {
        fields.push("constraints".into());
    }
    if previous.acceptance_criteria != next.acceptance_criteria {
        fields.push("acceptanceCriteria".into());
    }
    fields
}

fn added_criterion_ids(previous: Option<&ProjectSpec>, next: &ProjectSpec) -> Vec<String> {
    let previous_ids = previous
        .map(|spec| {
            spec.acceptance_criteria
                .iter()
                .map(|criterion| criterion.criterion_id.as_str())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    next.acceptance_criteria
        .iter()
        .filter(|criterion| !previous_ids.contains(criterion.criterion_id.as_str()))
        .map(|criterion| criterion.criterion_id.clone())
        .collect()
}

pub(super) fn retired_criterion_ids(
    previous: Option<&ProjectSpec>,
    next: &ProjectSpec,
) -> Vec<String> {
    let next_retired = next
        .acceptance_criteria
        .iter()
        .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Retired)
        .map(|criterion| criterion.criterion_id.clone())
        .collect::<HashSet<_>>();
    let Some(previous) = previous else {
        return next_retired.into_iter().collect();
    };
    previous
        .acceptance_criteria
        .iter()
        .filter(|criterion| {
            criterion.status == AcceptanceCriterionStatus::Active
                && next_retired.contains(&criterion.criterion_id)
        })
        .map(|criterion| criterion.criterion_id.clone())
        .collect()
}

fn prd_delta_summary(previous: Option<&ProjectSpec>, next: &ProjectSpec) -> Value {
    json!({
        "changedFields": changed_project_spec_fields(previous, next),
        "criterionIdsAdded": added_criterion_ids(previous, next),
        "criterionIdsRetired": retired_criterion_ids(previous, next),
        "goalChanged": previous.map(|spec| spec.goal.as_str()) != Some(next.goal.as_str()),
    })
}

fn summarize_prd(spec: &ProjectSpec) -> String {
    format!(
        "{} criterion(s), {} scope item(s)",
        spec.acceptance_criteria
            .iter()
            .filter(|criterion| criterion.status == AcceptanceCriterionStatus::Active)
            .count(),
        spec.scope.len()
    )
}

pub(super) fn load_or_create_prd_draft(
    conn: &rusqlite::Connection,
    project_id: i64,
    draft_id: &str,
) -> Result<LiveProjectSpecDraftRow, String> {
    if let Some(row) = prd_dao::get_draft(conn, project_id).map_err(|e| e.to_string())? {
        return Ok(row);
    }
    let latest = prd_dao::latest_version(conn, project_id).map_err(|e| e.to_string())?;
    let now = now_ms();
    let spec = latest
        .as_ref()
        .map(|row| ProjectSpecDraft {
            project_spec_id: Some(row.snapshot.project_spec_id.clone()),
            project_id,
            current_version: Some(row.version),
            goal: row.snapshot.goal.clone(),
            intent_summary: row.snapshot.intent_summary.clone(),
            scope: row.snapshot.scope.clone(),
            non_goals: row.snapshot.non_goals.clone(),
            constraints: row.snapshot.constraints.clone(),
            acceptance_criteria: row.snapshot.acceptance_criteria.clone(),
            // S-047: reopening the board carries the recorded architecture so the
            // student can change it (pre-S-047 specs deserialize as None).
            architecture: row.snapshot.architecture.clone(),
            status: row.snapshot.status,
        })
        .unwrap_or_else(|| ProjectSpecDraft {
            project_spec_id: Some(format!("prd-{project_id}")),
            project_id,
            current_version: None,
            goal: String::new(),
            intent_summary: None,
            scope: Vec::new(),
            non_goals: Vec::new(),
            constraints: Vec::new(),
            acceptance_criteria: Vec::new(),
            architecture: None,
            status: ProjectSpecStatus::Draft,
        });
    // S-053 D3: reopening a previously-confirmed PRD carries its recorded
    // provenance forward (pattern: `architecture` above) so the intent-check
    // card stays honest across edit sessions instead of resetting to the
    // legacy-empty-map fallback every time a student reopens their PRD.
    let field_provenance = latest
        .as_ref()
        .map(|row| row.snapshot.field_provenance.clone())
        .unwrap_or_default();
    Ok(LiveProjectSpecDraftRow {
        draft_id: if draft_id.trim().is_empty() {
            format!("prd-draft-{project_id}")
        } else {
            draft_id.trim().to_string()
        },
        project_id,
        base_version: latest.map(|row| row.version),
        spec,
        dirty_fields: Vec::new(),
        student_edited_fields: Vec::new(),
        last_patch_id: None,
        field_provenance,
        updated_at: now,
    })
}

pub(super) fn persist_live_prd_draft(
    conn: &rusqlite::Connection,
    draft: &LiveProjectSpecDraftRow,
) -> Result<(), String> {
    prd_dao::upsert_draft(
        conn,
        &NewLiveProjectSpecDraft {
            draft_id: draft.draft_id.clone(),
            project_id: draft.project_id,
            base_version: draft.base_version,
            spec: draft.spec.clone(),
            dirty_fields: draft.dirty_fields.clone(),
            student_edited_fields: draft.student_edited_fields.clone(),
            last_patch_id: draft.last_patch_id.clone(),
            field_provenance: draft.field_provenance.clone(),
        },
    )
    .map_err(|e| e.to_string())
}

pub(super) fn project_spec_id_for_draft(draft: &LiveProjectSpecDraftRow) -> String {
    draft
        .spec
        .project_spec_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| format!("prd-{}", draft.project_id))
}

/// Suffixes a parse-failure kind with `_truncated` when the provider finish
/// was a Length cut — the difference between "model disobeyed the contract"
/// and "model ran out of budget" is invisible in the raw text alone.
pub(super) fn kind_with_truncation(kind: &str, finish_reason: FinishReason) -> String {
    if matches!(finish_reason, FinishReason::Length) {
        format!("{kind}_truncated")
    } else {
        kind.to_string()
    }
}
