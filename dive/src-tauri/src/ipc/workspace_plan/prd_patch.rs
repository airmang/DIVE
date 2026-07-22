//! PRD patch validation and application against the live draft.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::sync::LazyLock;

use regex::Regex;

use crate::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus,
    LiveProjectSpecDraftRow, PrdPatch, PrdPatchOperation, ProvenanceSource,
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

fn validate_prd_patch_for_draft(patch: &PrdPatch, draft: &LiveProjectSpecDraftRow) -> Vec<String> {
    let mut reasons = Vec::new();
    if patch.operations.len() > MAX_PRD_PATCH_OPERATIONS {
        push_unique(&mut reasons, "too_many_operations".into());
    }
    for operation in &patch.operations {
        if !is_supported_prd_operation(operation.op.as_str()) {
            push_unique(&mut reasons, "unsupported_operation".into());
            continue;
        }
        let text = prd_operation_text(operation);
        if text
            .as_ref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
        {
            push_unique(&mut reasons, "missing_text".into());
            continue;
        }
        let text = text.unwrap();
        if text.chars().count() > MAX_PRD_PATCH_TEXT_CHARS {
            push_unique(&mut reasons, "text_too_large".into());
        }
        if looks_secret_like(text) {
            push_unique(&mut reasons, "secret_like_text".into());
        }
        if operation.op == "revise_acceptance_criterion_text" {
            let Some(criterion_id) = operation.criterion_id.as_ref() else {
                push_unique(&mut reasons, "criterion_not_found".into());
                continue;
            };
            if !draft
                .spec
                .acceptance_criteria
                .iter()
                .any(|criterion| criterion.criterion_id == *criterion_id)
            {
                push_unique(&mut reasons, "criterion_not_found".into());
            }
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
    )
}

fn prd_operation_text(operation: &PrdPatchOperation) -> Option<&str> {
    operation
        .value
        .as_deref()
        .or(operation.text.as_deref())
        .map(str::trim)
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
