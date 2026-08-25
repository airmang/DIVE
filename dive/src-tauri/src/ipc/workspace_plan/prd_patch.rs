//! PRD patch validation and application against the live draft.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::sync::LazyLock;

use regex::Regex;

use crate::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus,
    LiveProjectSpecDraftRow, PrdPatch, PrdPatchOperation, ProjectSpecDraft, ProvenanceSource,
};
use crate::db::now_ms;

use super::*;

const MAX_PRD_PATCH_OPERATIONS: usize = 20;
const MAX_PRD_PATCH_TEXT_CHARS: usize = 1200;
pub(super) struct PrdPatchApplyResult {
    pub(super) draft: LiveProjectSpecDraftRow,
    pub(super) validation_outcome: String,
    pub(super) applied_field_paths: Vec<String>,
    pub(super) rejected_reasons: Vec<String>,
    pub(super) criterion_ids_assigned: Vec<String>,
    pub(super) student_edited_fields_respected: Vec<String>,
}

pub(super) fn apply_prd_patch_to_draft(
    draft: LiveProjectSpecDraftRow,
    patch: &PrdPatch,
) -> PrdPatchApplyResult {
    let validation_errors = validate_prd_patch_for_draft(patch, &draft);
    if !validation_errors.is_empty() {
        return PrdPatchApplyResult {
            draft,
            validation_outcome: "rejected".into(),
            applied_field_paths: Vec::new(),
            rejected_reasons: validation_errors,
            criterion_ids_assigned: Vec::new(),
            student_edited_fields_respected: Vec::new(),
        };
    }

    let mut next = draft;
    next.spec.scope = compact_unique_strings(next.spec.scope);
    next.spec.non_goals = compact_unique_strings(next.spec.non_goals);
    next.spec.constraints = compact_unique_strings(next.spec.constraints);
    next.last_patch_id = Some(patch.patch_id.clone());
    next.updated_at = now_ms();
    let mut applied_field_paths = Vec::new();
    let mut held_field_paths = Vec::new();
    let mut criterion_ids_assigned = Vec::new();
    let mut student_edited_fields_respected = Vec::new();

    for operation in &patch.operations {
        let field_path = field_path_for_prd_operation(operation);
        if let Some(conflict) =
            conflicts_with_student_edit(&field_path, &next.student_edited_fields)
        {
            push_unique(&mut held_field_paths, field_path_root(&field_path));
            push_unique(&mut student_edited_fields_respected, conflict);
            continue;
        }

        match operation.op.as_str() {
            "set_goal" => {
                next.spec.goal = prd_operation_text(operation)
                    .unwrap_or_default()
                    .to_string();
                push_unique(&mut applied_field_paths, "goal".into());
            }
            "set_intent_summary" => {
                next.spec.intent_summary = prd_operation_text(operation).map(str::to_string);
                push_unique(&mut applied_field_paths, "intentSummary".into());
            }
            "append_scope" => {
                if let Some(value) = prd_operation_text(operation) {
                    next.spec.scope = append_unique_string(next.spec.scope, value);
                    push_unique(&mut applied_field_paths, "scope".into());
                }
            }
            "append_non_goal" => {
                if let Some(value) = prd_operation_text(operation) {
                    next.spec.non_goals = append_unique_string(next.spec.non_goals, value);
                    push_unique(&mut applied_field_paths, "nonGoals".into());
                }
            }
            "append_constraint" => {
                if let Some(value) = prd_operation_text(operation) {
                    next.spec.constraints = append_unique_string(next.spec.constraints, value);
                    push_unique(&mut applied_field_paths, "constraints".into());
                }
            }
            "append_acceptance_criterion" => {
                if let Some(text) = prd_operation_text(operation) {
                    let criterion_id =
                        allocate_acceptance_criterion_id(&next.spec.acceptance_criteria);
                    next.spec.acceptance_criteria.push(AcceptanceCriterion {
                        criterion_id: criterion_id.clone(),
                        text: text.to_string(),
                        source: AcceptanceCriterionSource::Interview,
                        status: AcceptanceCriterionStatus::Active,
                        created_in_version: next.spec.current_version.unwrap_or(1),
                        retired_in_version: None,
                    });
                    push_unique(&mut criterion_ids_assigned, criterion_id);
                    push_unique(&mut applied_field_paths, "acceptanceCriteria".into());
                }
            }
            "revise_acceptance_criterion_text" => {
                if let (Some(criterion_id), Some(text)) = (
                    operation.criterion_id.as_ref(),
                    prd_operation_text(operation),
                ) {
                    for criterion in &mut next.spec.acceptance_criteria {
                        if criterion.criterion_id == *criterion_id {
                            criterion.text = text.to_string();
                        }
                    }
                    push_unique(
                        &mut applied_field_paths,
                        format!("acceptanceCriteria.{criterion_id}.text"),
                    );
                }
            }
            // S-072 (014 theme 2): in-place list edits. `target` addresses the
            // current item by normalized text (D-014-05). Validation already
            // proved a match against the incoming draft, so a miss here can
            // only mean an earlier op in the same patch removed or reworded
            // that item — skip rather than guess at a different item.
            "revise_scope" | "revise_non_goal" | "revise_constraint" => {
                if let (Some(root), Some(target), Some(value)) = (
                    list_root_for_prd_operation(operation.op.as_str()),
                    prd_operation_target(operation),
                    prd_operation_text(operation),
                ) {
                    let list = list_for_root_mut(&mut next.spec, root);
                    if let Some(index) = find_list_item_index(list, target) {
                        list[index] = value.to_string();
                        push_unique(&mut applied_field_paths, root.into());
                    }
                }
            }
            "remove_scope" | "remove_non_goal" | "remove_constraint" => {
                if let (Some(root), Some(target)) = (
                    list_root_for_prd_operation(operation.op.as_str()),
                    prd_operation_target(operation),
                ) {
                    let list = list_for_root_mut(&mut next.spec, root);
                    if let Some(index) = find_list_item_index(list, target) {
                        list.remove(index);
                        push_unique(&mut applied_field_paths, root.into());
                    }
                }
            }
            // D-014-06: criteria are retired, never deleted — the row stays in
            // the snapshot for the versioned PRD / decomposition history and
            // the active-count gate already ignores retired ones.
            "retire_acceptance_criterion" => {
                if let Some(criterion_id) = operation.criterion_id.as_deref() {
                    let version = next.spec.current_version.unwrap_or(1);
                    for criterion in &mut next.spec.acceptance_criteria {
                        if criterion.criterion_id == criterion_id
                            && matches!(criterion.status, AcceptanceCriterionStatus::Active)
                        {
                            criterion.status = AcceptanceCriterionStatus::Retired;
                            criterion.retired_in_version = Some(version);
                        }
                    }
                    push_unique(
                        &mut applied_field_paths,
                        format!("acceptanceCriteria.{criterion_id}.status"),
                    );
                }
            }
            _ => {}
        }
    }

    for field in &applied_field_paths {
        let root = field_path_root(field);
        // S-053 D3: only the five scalar/list fields carry provenance here —
        // acceptanceCriteria keeps its own per-criterion `source` and is
        // deliberately excluded (see ProvenanceSource doc comment).
        if root != "acceptanceCriteria" {
            next.field_provenance
                .insert(root.clone(), ProvenanceSource::AiPatch);
        }
        push_unique(&mut next.dirty_fields, root);
    }

    let validation_outcome = if !held_field_paths.is_empty() {
        "held_for_student"
    } else if !applied_field_paths.is_empty() {
        "applied"
    } else {
        "none"
    }
    .to_string();
    let rejected_reasons = if validation_outcome == "held_for_student" {
        vec!["student_edit_conflict".into()]
    } else {
        Vec::new()
    };

    PrdPatchApplyResult {
        draft: next,
        validation_outcome,
        applied_field_paths,
        rejected_reasons,
        criterion_ids_assigned,
        student_edited_fields_respected,
    }
}

/// Per-op validation (S-072 made it per-op; before that every op was
/// "requires text"). Any reason rejects the WHOLE patch — same all-or-nothing
/// rule 004 applied to `criterion_not_found` (D-014-05).
///
/// | op                                               | requires                                  | reason when unmet      |
/// | ------------------------------------------------ | ----------------------------------------- | ---------------------- |
/// | `set_*`, `append_*`                              | non-empty `value`/`text`                  | `missing_text`         |
/// | `revise_acceptance_criterion_text`               | non-empty text; `criterionId` exists      | `missing_text` / `criterion_not_found` |
/// | `revise_scope` / `_non_goal` / `_constraint`     | non-empty text; `target` matches an item  | `missing_text` / `item_not_found` |
/// | `remove_scope` / `_non_goal` / `_constraint`     | `target` matches an item (no text)        | `item_not_found`       |
/// | `retire_acceptance_criterion`                    | `criterionId` exists AND is `active`      | `criterion_not_found`  |
///
/// `text_too_large` / `secret_like_text` are checked on every text field an
/// op carries (`value`, `text`, `target`), whatever the op.
fn validate_prd_patch_for_draft(patch: &PrdPatch, draft: &LiveProjectSpecDraftRow) -> Vec<String> {
    let mut reasons = Vec::new();
    if patch.operations.len() > MAX_PRD_PATCH_OPERATIONS {
        push_unique(&mut reasons, "too_many_operations".into());
    }
    for operation in &patch.operations {
        let op = operation.op.as_str();
        if !is_supported_prd_operation(op) {
            push_unique(&mut reasons, "unsupported_operation".into());
            continue;
        }
        for carried in [
            operation.value.as_deref(),
            operation.text.as_deref(),
            operation.target.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if carried.chars().count() > MAX_PRD_PATCH_TEXT_CHARS {
                push_unique(&mut reasons, "text_too_large".into());
            }
            if looks_secret_like(carried) {
                push_unique(&mut reasons, "secret_like_text".into());
            }
        }
        if prd_operation_requires_text(op)
            && prd_operation_text(operation)
                .map(str::is_empty)
                .unwrap_or(true)
        {
            push_unique(&mut reasons, "missing_text".into());
        }
        match op {
            "revise_acceptance_criterion_text" => {
                let found = operation.criterion_id.as_ref().is_some_and(|criterion_id| {
                    draft
                        .spec
                        .acceptance_criteria
                        .iter()
                        .any(|criterion| criterion.criterion_id == *criterion_id)
                });
                if !found {
                    push_unique(&mut reasons, "criterion_not_found".into());
                }
            }
            "retire_acceptance_criterion" => {
                let found = operation.criterion_id.as_ref().is_some_and(|criterion_id| {
                    draft.spec.acceptance_criteria.iter().any(|criterion| {
                        criterion.criterion_id == *criterion_id
                            && matches!(criterion.status, AcceptanceCriterionStatus::Active)
                    })
                });
                if !found {
                    push_unique(&mut reasons, "criterion_not_found".into());
                }
            }
            "revise_scope" | "revise_non_goal" | "revise_constraint" | "remove_scope"
            | "remove_non_goal" | "remove_constraint" => {
                let found = list_root_for_prd_operation(op).is_some_and(|root| {
                    prd_operation_target(operation)
                        .and_then(|target| {
                            find_list_item_index(list_for_root(&draft.spec, root), target)
                        })
                        .is_some()
                });
                if !found {
                    push_unique(&mut reasons, "item_not_found".into());
                }
            }
            _ => {}
        }
    }
    reasons
}

fn is_supported_prd_operation(op: &str) -> bool {
    matches!(
        op,
        "set_goal"
            | "set_intent_summary"
            | "append_scope"
            | "append_non_goal"
            | "append_constraint"
            | "append_acceptance_criterion"
            | "revise_acceptance_criterion_text"
            | "revise_scope"
            | "revise_non_goal"
            | "revise_constraint"
            | "remove_scope"
            | "remove_non_goal"
            | "remove_constraint"
            | "retire_acceptance_criterion"
    )
}

/// Ops that write new wording and therefore need a non-empty `value`/`text`.
/// `remove_*` and `retire_acceptance_criterion` only address an existing item.
fn prd_operation_requires_text(op: &str) -> bool {
    matches!(
        op,
        "set_goal"
            | "set_intent_summary"
            | "append_scope"
            | "append_non_goal"
            | "append_constraint"
            | "append_acceptance_criterion"
            | "revise_acceptance_criterion_text"
            | "revise_scope"
            | "revise_non_goal"
            | "revise_constraint"
    )
}

fn prd_operation_text(operation: &PrdPatchOperation) -> Option<&str> {
    operation
        .value
        .as_deref()
        .or(operation.text.as_deref())
        .map(str::trim)
}

/// The current-item address of a `revise_*` / `remove_*` list op, trimmed;
/// a blank target is the same as no target.
fn prd_operation_target(operation: &PrdPatchOperation) -> Option<&str> {
    operation
        .target
        .as_deref()
        .map(str::trim)
        .filter(|target| !target.is_empty())
}

/// S-072 / D-014-05: the address of a scope / non-goal / constraint item is
/// its text, normalized just enough to survive the model re-typing it — trim,
/// collapse internal whitespace runs to a single space, case-insensitive.
/// Anything fuzzier is deliberately NOT attempted: editing the wrong item is
/// worse than a rejection.
fn normalize_list_item_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Index of the first item whose normalized text equals the normalized
/// `target`; `None` for a blank target or no match. First match wins.
fn find_list_item_index(items: &[String], target: &str) -> Option<usize> {
    let wanted = normalize_list_item_text(target);
    if wanted.is_empty() {
        return None;
    }
    items
        .iter()
        .position(|item| normalize_list_item_text(item) == wanted)
}

/// The list root (field-path root AND provenance key) a `revise_*` /
/// `remove_*` op addresses; `None` for every other op.
fn list_root_for_prd_operation(op: &str) -> Option<&'static str> {
    match op {
        "revise_scope" | "remove_scope" => Some("scope"),
        "revise_non_goal" | "remove_non_goal" => Some("nonGoals"),
        "revise_constraint" | "remove_constraint" => Some("constraints"),
        _ => None,
    }
}

fn list_for_root<'a>(spec: &'a ProjectSpecDraft, root: &str) -> &'a [String] {
    match root {
        "nonGoals" => &spec.non_goals,
        "constraints" => &spec.constraints,
        _ => &spec.scope,
    }
}

fn list_for_root_mut<'a>(spec: &'a mut ProjectSpecDraft, root: &str) -> &'a mut Vec<String> {
    match root {
        "nonGoals" => &mut spec.non_goals,
        "constraints" => &mut spec.constraints,
        _ => &mut spec.scope,
    }
}

fn field_path_for_prd_operation(operation: &PrdPatchOperation) -> String {
    match operation.op.as_str() {
        "set_goal" => "goal".into(),
        "set_intent_summary" => "intentSummary".into(),
        "append_scope" => "scope".into(),
        "append_non_goal" => "nonGoals".into(),
        "append_constraint" => "constraints".into(),
        "append_acceptance_criterion" => "acceptanceCriteria".into(),
        "revise_acceptance_criterion_text" => operation
            .criterion_id
            .as_ref()
            .map(|id| format!("acceptanceCriteria.{id}.text"))
            .unwrap_or_else(|| "acceptanceCriteria".into()),
        // S-072: revise/remove map to their list root so `held_for_student`
        // and the `data-changed` highlight keep working unchanged.
        "revise_scope" | "remove_scope" => "scope".into(),
        "revise_non_goal" | "remove_non_goal" => "nonGoals".into(),
        "revise_constraint" | "remove_constraint" => "constraints".into(),
        "retire_acceptance_criterion" => operation
            .criterion_id
            .as_ref()
            .map(|id| format!("acceptanceCriteria.{id}.status"))
            .unwrap_or_else(|| "acceptanceCriteria".into()),
        _ => "unknown".into(),
    }
}

fn field_path_root(path: &str) -> String {
    path.split('.').next().unwrap_or(path).to_string()
}

fn conflicts_with_student_edit(
    field_path: &str,
    student_edited_fields: &[String],
) -> Option<String> {
    let root = field_path_root(field_path);
    student_edited_fields
        .iter()
        .find(|field| field.as_str() == field_path || field.as_str() == root)
        .cloned()
}

pub(super) fn append_unique_string(mut values: Vec<String>, value: &str) -> Vec<String> {
    let value = value.trim();
    if !value.is_empty() && !values.iter().any(|existing| existing == value) {
        values.push(value.to_string());
    }
    values
}

// Wily P2 cleanup: mirrors `dive::event_log::SECRET_RE` (the pattern the
// exported EventLog ledger redacts before persistence) — this gate is the
// sole check standing between a live PRD-interview turn and an unredacted
// secret landing in the draft row, `ProjectSpecVersion` snapshots, and the
// exported `.dive/plan.json`, so it must catch at least everything the
// export-time redactor does. The prior fixed substring list missed
// `password: x` (a bare colon+space, not `secret:`/`token:` exactly),
// `authorization: Basic ...` (no `authorization` substring check at all), and
// a no-space `token=value` (only `"token ="` with a space was checked).
static SECRET_LIKE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?ix)
        sk-[A-Za-z0-9_\-]{3,}
        |(?:api[_-]?key|token|secret|authorization|password)["']?\s*[:=]\s*["']?[A-Za-z0-9_./+=\-]{4,}
        |bearer\s+[A-Za-z0-9_\-\.]{4,}
        "#,
    )
    .expect("secret-like detection regex")
});

fn looks_secret_like(text: &str) -> bool {
    SECRET_LIKE_RE.is_match(text)
}

pub(super) fn push_unique(items: &mut Vec<String>, value: String) {
    if !items.contains(&value) {
        items.push(value);
    }
}

#[cfg(test)]
mod looks_secret_like_tests {
    use super::*;

    /// Regression for the P2 finding: the old fixed substring list only
    /// checked `secret:`/`token:` and `"token ="`/`"secret ="` (a required
    /// space around `=`), and never checked `authorization` at all — so a
    /// bare `password: ...`, a spelled-out `authorization: ...`, and a
    /// no-space `token=...` all sailed through unredacted into the live PRD
    /// draft, `ProjectSpecVersion` snapshots, and the exported plan.json.
    #[test]
    fn flags_forms_the_old_fixed_substring_list_missed() {
        assert!(looks_secret_like("password: hunter2"));
        assert!(looks_secret_like("authorization: Basic dXNlcjpwYXNz"));
        assert!(looks_secret_like("token=abc123XYZ"));
    }

    #[test]
    fn still_flags_previously_covered_forms() {
        assert!(looks_secret_like("here is my sk-abc123secretvalue"));
        assert!(looks_secret_like("api_key=supersecretvalue"));
        assert!(looks_secret_like("Authorization: Bearer abc123XYZtoken"));
    }

    #[test]
    fn does_not_flag_ordinary_text_mentioning_the_keywords_in_passing() {
        assert!(!looks_secret_like(
            "Thanks for your effort — tokens of appreciation for the team."
        ));
        assert!(!looks_secret_like(
            "Students should feel a sense of ownership over the project."
        ));
    }
}

// S-072 (014 theme 2): in-place PRD edits — revise / remove list items by
// normalized target text and retire (never delete) acceptance criteria.
#[cfg(test)]
mod prd_patch_apply_tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::db::models::{ProjectSpecDraft, ProjectSpecStatus};

    fn criterion(id: &str, text: &str, active: bool) -> AcceptanceCriterion {
        AcceptanceCriterion {
            criterion_id: id.into(),
            text: text.into(),
            source: AcceptanceCriterionSource::Interview,
            status: if active {
                AcceptanceCriterionStatus::Active
            } else {
                AcceptanceCriterionStatus::Retired
            },
            created_in_version: 1,
            retired_in_version: if active { None } else { Some(1) },
        }
    }

    /// A confirmable-shaped draft on version 2 with two items per list, one
    /// active and one already-retired criterion.
    fn draft_with_lists() -> LiveProjectSpecDraftRow {
        LiveProjectSpecDraftRow {
            draft_id: "draft-1".into(),
            project_id: 1,
            base_version: Some(2),
            spec: ProjectSpecDraft {
                project_spec_id: Some("prd-1".into()),
                project_id: 1,
                current_version: Some(2),
                goal: "Build a personal schedule app".into(),
                intent_summary: Some("Track classes and homework".into()),
                scope: vec![
                    "Add and remove schedule items".into(),
                    "Show today's classes".into(),
                ],
                non_goals: vec![
                    "No account or login in the first version".into(),
                    "No mobile app".into(),
                ],
                constraints: vec!["Must run offline".into(), "Korean UI only".into()],
                acceptance_criteria: vec![
                    criterion(
                        "AC-001",
                        "Schedules and tasks appear in separate lists",
                        true,
                    ),
                    criterion("AC-002", "Old criterion already retired", false),
                ],
                architecture: None,
                status: ProjectSpecStatus::Draft,
            },
            dirty_fields: Vec::new(),
            student_edited_fields: Vec::new(),
            last_patch_id: None,
            field_provenance: BTreeMap::new(),
            updated_at: 1,
        }
    }

    fn op(name: &str) -> PrdPatchOperation {
        PrdPatchOperation {
            op: name.into(),
            value: None,
            text: None,
            criterion_id: None,
            target: None,
        }
    }

    fn revise(name: &str, target: &str, value: &str) -> PrdPatchOperation {
        PrdPatchOperation {
            target: Some(target.into()),
            value: Some(value.into()),
            ..op(name)
        }
    }

    fn remove(name: &str, target: &str) -> PrdPatchOperation {
        PrdPatchOperation {
            target: Some(target.into()),
            ..op(name)
        }
    }

    fn retire(criterion_id: &str) -> PrdPatchOperation {
        PrdPatchOperation {
            criterion_id: Some(criterion_id.into()),
            ..op("retire_acceptance_criterion")
        }
    }

    fn patch(operations: Vec<PrdPatchOperation>) -> PrdPatch {
        PrdPatch {
            patch_id: "prd-patch-test".into(),
            operations,
            rationale: None,
            source_turn_id: "turn-1".into(),
        }
    }

    #[test]
    fn normalize_list_item_text_trims_collapses_and_lowercases() {
        assert_eq!(
            normalize_list_item_text("  Show   Today's\tClasses \n"),
            "show today's classes"
        );
        assert_eq!(normalize_list_item_text("   "), "");
        // Non-ASCII text is preserved (only whitespace and case are folded).
        assert_eq!(normalize_list_item_text(" 로그인  없음 "), "로그인 없음");
    }

    #[test]
    fn find_list_item_index_first_match_wins_and_blank_target_never_matches() {
        let items = vec!["Alpha".to_string(), "beta".to_string(), "ALPHA".to_string()];
        assert_eq!(find_list_item_index(&items, "alpha"), Some(0));
        assert_eq!(find_list_item_index(&items, "  BETA "), Some(1));
        assert_eq!(find_list_item_index(&items, "gamma"), None);
        assert_eq!(find_list_item_index(&items, "   "), None);
        assert_eq!(find_list_item_index(&[], "alpha"), None);
    }

    #[test]
    fn revise_scope_replaces_item_in_place_and_leaves_others_untouched() {
        let result = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![revise(
                "revise_scope",
                "Add and remove schedule items",
                "Add, edit, and remove schedule items",
            )]),
        );
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.applied_field_paths, vec!["scope"]);
        assert_eq!(
            result.draft.spec.scope,
            vec![
                "Add, edit, and remove schedule items".to_string(),
                "Show today's classes".to_string(),
            ]
        );
        assert_eq!(result.draft.spec.non_goals.len(), 2);
        assert_eq!(result.draft.spec.constraints.len(), 2);
        assert_eq!(
            result.draft.field_provenance.get("scope"),
            Some(&ProvenanceSource::AiPatch)
        );
        assert!(result.draft.dirty_fields.contains(&"scope".to_string()));
        assert_eq!(
            result.draft.last_patch_id.as_deref(),
            Some("prd-patch-test")
        );
    }

    #[test]
    fn revise_non_goal_and_constraint_replace_in_place_at_the_same_index() {
        let result = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![
                revise(
                    "revise_non_goal",
                    "No mobile app",
                    "No native mobile app yet",
                ),
                revise(
                    "revise_constraint",
                    "Must run offline",
                    "Must work without internet",
                ),
            ]),
        );
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.applied_field_paths, vec!["nonGoals", "constraints"]);
        assert_eq!(
            result.draft.spec.non_goals[0],
            "No account or login in the first version"
        );
        assert_eq!(result.draft.spec.non_goals[1], "No native mobile app yet");
        assert_eq!(
            result.draft.spec.constraints[0],
            "Must work without internet"
        );
        assert_eq!(result.draft.spec.constraints[1], "Korean UI only");
    }

    #[test]
    fn revise_folds_text_into_value_when_only_text_is_carried() {
        let mut operation = op("revise_scope");
        operation.target = Some("Show today's classes".into());
        operation.text = Some("Show this week's classes".into());
        let result = apply_prd_patch_to_draft(draft_with_lists(), &patch(vec![operation]));
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.draft.spec.scope[1], "Show this week's classes");
    }

    #[test]
    fn remove_scope_deletes_only_the_matching_item() {
        let result = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![remove(
                "remove_scope",
                "Add and remove schedule items",
            )]),
        );
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.applied_field_paths, vec!["scope"]);
        assert_eq!(
            result.draft.spec.scope,
            vec!["Show today's classes".to_string()]
        );
        assert_eq!(result.draft.spec.non_goals.len(), 2);
        assert_eq!(result.draft.spec.constraints.len(), 2);
    }

    #[test]
    fn remove_non_goal_and_constraint_delete_only_the_match() {
        let result = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![
                remove("remove_non_goal", "No mobile app"),
                remove("remove_constraint", "Korean UI only"),
            ]),
        );
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.applied_field_paths, vec!["nonGoals", "constraints"]);
        assert_eq!(
            result.draft.spec.non_goals,
            vec!["No account or login in the first version".to_string()]
        );
        assert_eq!(
            result.draft.spec.constraints,
            vec!["Must run offline".to_string()]
        );
        assert_eq!(result.draft.spec.scope.len(), 2);
    }

    #[test]
    fn target_match_is_normalized_for_case_and_whitespace() {
        let result = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![
                revise(
                    "revise_scope",
                    "  show   TODAY'S classes ",
                    "Show tomorrow's classes",
                ),
                remove("remove_constraint", "korean  ui   ONLY"),
            ]),
        );
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.draft.spec.scope[1], "Show tomorrow's classes");
        assert_eq!(
            result.draft.spec.constraints,
            vec!["Must run offline".to_string()]
        );
    }

    #[test]
    fn revise_with_unknown_target_rejects_whole_patch_and_leaves_draft_unchanged() {
        let original = draft_with_lists();
        let result = apply_prd_patch_to_draft(
            original.clone(),
            &patch(vec![
                // A perfectly valid op in the same patch must NOT be applied
                // (all-or-nothing, D-014-05).
                PrdPatchOperation {
                    value: Some("A schedule app for students".into()),
                    ..op("set_goal")
                },
                revise("revise_scope", "This item does not exist", "Whatever"),
            ]),
        );
        assert_eq!(result.validation_outcome, "rejected");
        assert_eq!(result.rejected_reasons, vec!["item_not_found"]);
        assert!(result.applied_field_paths.is_empty());
        assert_eq!(result.draft, original);
    }

    #[test]
    fn remove_with_missing_or_unknown_target_rejects_with_item_not_found() {
        let original = draft_with_lists();
        let missing = apply_prd_patch_to_draft(original.clone(), &patch(vec![op("remove_scope")]));
        assert_eq!(missing.validation_outcome, "rejected");
        assert_eq!(missing.rejected_reasons, vec!["item_not_found"]);
        assert_eq!(missing.draft, original);

        let blank = apply_prd_patch_to_draft(
            original.clone(),
            &patch(vec![remove("remove_non_goal", "   ")]),
        );
        assert_eq!(blank.rejected_reasons, vec!["item_not_found"]);

        let unknown = apply_prd_patch_to_draft(
            original.clone(),
            &patch(vec![remove("remove_constraint", "No such constraint")]),
        );
        assert_eq!(unknown.rejected_reasons, vec!["item_not_found"]);
        assert_eq!(unknown.draft, original);
    }

    #[test]
    fn revise_without_new_text_rejects_with_missing_text() {
        let result = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![remove("revise_scope", "Show today's classes")]),
        );
        assert_eq!(result.validation_outcome, "rejected");
        assert_eq!(result.rejected_reasons, vec!["missing_text"]);
    }

    #[test]
    fn retire_acceptance_criterion_sets_status_and_version_and_keeps_it_listed() {
        let result = apply_prd_patch_to_draft(draft_with_lists(), &patch(vec![retire("AC-001")]));
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(
            result.applied_field_paths,
            vec!["acceptanceCriteria.AC-001.status"]
        );
        assert_eq!(result.draft.spec.acceptance_criteria.len(), 2);
        let retired = &result.draft.spec.acceptance_criteria[0];
        assert_eq!(retired.criterion_id, "AC-001");
        assert!(matches!(retired.status, AcceptanceCriterionStatus::Retired));
        assert_eq!(retired.retired_in_version, Some(2));
        assert_eq!(retired.text, "Schedules and tasks appear in separate lists");
        // The already-retired one is untouched.
        assert_eq!(
            result.draft.spec.acceptance_criteria[1].retired_in_version,
            Some(1)
        );
        // S-053 D3: acceptanceCriteria keeps per-criterion `source`, so no
        // AiPatch provenance is written for it — but the root is dirty.
        assert!(!result
            .draft
            .field_provenance
            .contains_key("acceptanceCriteria"));
        assert!(result
            .draft
            .dirty_fields
            .contains(&"acceptanceCriteria".to_string()));
        assert!(result.criterion_ids_assigned.is_empty());
    }

    #[test]
    fn retire_falls_back_to_version_one_when_draft_has_no_version() {
        let mut draft = draft_with_lists();
        draft.spec.current_version = None;
        let result = apply_prd_patch_to_draft(draft, &patch(vec![retire("AC-001")]));
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(
            result.draft.spec.acceptance_criteria[0].retired_in_version,
            Some(1)
        );
    }

    #[test]
    fn retire_already_retired_or_unknown_criterion_rejects_with_criterion_not_found() {
        let original = draft_with_lists();
        let already = apply_prd_patch_to_draft(original.clone(), &patch(vec![retire("AC-002")]));
        assert_eq!(already.validation_outcome, "rejected");
        assert_eq!(already.rejected_reasons, vec!["criterion_not_found"]);
        assert_eq!(already.draft, original);

        let unknown = apply_prd_patch_to_draft(original.clone(), &patch(vec![retire("AC-999")]));
        assert_eq!(unknown.rejected_reasons, vec!["criterion_not_found"]);

        let no_id = apply_prd_patch_to_draft(
            original.clone(),
            &patch(vec![op("retire_acceptance_criterion")]),
        );
        assert_eq!(no_id.rejected_reasons, vec!["criterion_not_found"]);
        assert_eq!(no_id.draft, original);
    }

    #[test]
    fn revise_scope_on_student_edited_list_is_held_for_student() {
        let mut draft = draft_with_lists();
        draft.student_edited_fields = vec!["scope".into()];
        let result = apply_prd_patch_to_draft(
            draft,
            &patch(vec![revise(
                "revise_scope",
                "Show today's classes",
                "Show this week's classes",
            )]),
        );
        assert_eq!(result.validation_outcome, "held_for_student");
        assert_eq!(result.rejected_reasons, vec!["student_edit_conflict"]);
        assert_eq!(result.student_edited_fields_respected, vec!["scope"]);
        assert!(result.applied_field_paths.is_empty());
        // Constitution VI: the student's wording stays exactly as they left it.
        assert_eq!(result.draft.spec.scope[1], "Show today's classes");
    }

    #[test]
    fn remove_on_student_edited_list_is_held_for_student() {
        let mut draft = draft_with_lists();
        draft.student_edited_fields = vec!["constraints".into()];
        let result = apply_prd_patch_to_draft(
            draft,
            &patch(vec![remove("remove_constraint", "Must run offline")]),
        );
        assert_eq!(result.validation_outcome, "held_for_student");
        assert_eq!(result.draft.spec.constraints.len(), 2);
    }

    #[test]
    fn secret_like_target_rejects_with_secret_like_text() {
        let mut draft = draft_with_lists();
        draft
            .spec
            .constraints
            .push("api_key=supersecretvalue".into());
        let result = apply_prd_patch_to_draft(
            draft,
            &patch(vec![remove(
                "remove_constraint",
                "api_key=supersecretvalue",
            )]),
        );
        assert_eq!(result.validation_outcome, "rejected");
        assert!(result
            .rejected_reasons
            .contains(&"secret_like_text".to_string()));
        assert!(!result
            .rejected_reasons
            .contains(&"item_not_found".to_string()));
    }

    #[test]
    fn oversized_target_rejects_with_text_too_large() {
        let huge = "x".repeat(MAX_PRD_PATCH_TEXT_CHARS + 1);
        let result = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![remove("remove_scope", &huge)]),
        );
        assert_eq!(result.validation_outcome, "rejected");
        assert!(result
            .rejected_reasons
            .contains(&"text_too_large".to_string()));
    }

    #[test]
    fn append_ops_keep_their_missing_text_and_secret_gates() {
        let missing =
            apply_prd_patch_to_draft(draft_with_lists(), &patch(vec![op("append_scope")]));
        assert_eq!(missing.rejected_reasons, vec!["missing_text"]);

        let secret = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![PrdPatchOperation {
                value: Some("Authorization: Bearer abc123XYZtoken".into()),
                ..op("append_constraint")
            }]),
        );
        assert_eq!(secret.rejected_reasons, vec!["secret_like_text"]);
    }

    #[test]
    fn new_ops_are_supported_and_map_to_their_list_roots() {
        for name in [
            "revise_scope",
            "revise_non_goal",
            "revise_constraint",
            "remove_scope",
            "remove_non_goal",
            "remove_constraint",
            "retire_acceptance_criterion",
        ] {
            assert!(is_supported_prd_operation(name), "{name} must be supported");
        }
        assert!(!is_supported_prd_operation("delete_scope"));

        assert_eq!(field_path_for_prd_operation(&op("revise_scope")), "scope");
        assert_eq!(field_path_for_prd_operation(&op("remove_scope")), "scope");
        assert_eq!(
            field_path_for_prd_operation(&op("revise_non_goal")),
            "nonGoals"
        );
        assert_eq!(
            field_path_for_prd_operation(&op("remove_non_goal")),
            "nonGoals"
        );
        assert_eq!(
            field_path_for_prd_operation(&op("revise_constraint")),
            "constraints"
        );
        assert_eq!(
            field_path_for_prd_operation(&op("remove_constraint")),
            "constraints"
        );
        assert_eq!(
            field_path_for_prd_operation(&retire("AC-001")),
            "acceptanceCriteria.AC-001.status"
        );
        assert_eq!(
            field_path_for_prd_operation(&op("retire_acceptance_criterion")),
            "acceptanceCriteria"
        );
    }
}
