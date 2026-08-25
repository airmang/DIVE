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
    compact_spec_lists(&mut next.spec);
    next.last_patch_id = Some(patch.patch_id.clone());
    next.updated_at = now_ms();
    let mut applied_field_paths = Vec::new();
    let mut held_field_paths = Vec::new();
    let mut criterion_ids_assigned = Vec::new();
    let mut student_edited_fields_respected = Vec::new();

    for operation in &patch.operations {
        let field_path = field_path_for_prd_operation(operation);
        // Constitution VI / D-014-09: the hold is PER OP, not per patch — the
        // other ops still land (a whole-patch hold would stall the interview
        // every time a student hand-edits one field). The caller audits the
        // partial apply by emitting both the applied and the held event.
        if let Some(conflict) =
            conflicts_with_student_edit(&field_path, &next.student_edited_fields)
        {
            push_unique(&mut held_field_paths, field_path_root(&field_path));
            push_unique(&mut student_edited_fields_respected, conflict);
            continue;
        }

        if let Some(applied) = apply_operation_to_spec(&mut next.spec, operation) {
            push_unique(&mut applied_field_paths, applied.field_path);
            if let Some(criterion_id) = applied.criterion_id_assigned {
                push_unique(&mut criterion_ids_assigned, criterion_id);
            }
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

fn compact_spec_lists(spec: &mut ProjectSpecDraft) {
    spec.scope = compact_unique_strings(std::mem::take(&mut spec.scope));
    spec.non_goals = compact_unique_strings(std::mem::take(&mut spec.non_goals));
    spec.constraints = compact_unique_strings(std::mem::take(&mut spec.constraints));
}

/// What one operation did to a spec: the field path it touched and, for
/// `append_acceptance_criterion`, the id DIVE assigned.
struct AppliedOperation {
    field_path: String,
    criterion_id_assigned: Option<String>,
}

/// The single executor for one patch operation, shared by the real apply and
/// by validation's simulation so the two can never disagree about what an
/// earlier op in the same patch did to the lists. Returns `None` when the op
/// has nothing to apply (validation has already rejected every such case for
/// a real apply; the simulation simply moves on).
fn apply_operation_to_spec(
    spec: &mut ProjectSpecDraft,
    operation: &PrdPatchOperation,
) -> Option<AppliedOperation> {
    let applied = |field_path: String| {
        Some(AppliedOperation {
            field_path,
            criterion_id_assigned: None,
        })
    };
    match operation.op.as_str() {
        "set_goal" => {
            spec.goal = prd_operation_text(operation)
                .unwrap_or_default()
                .to_string();
            applied("goal".into())
        }
        "set_intent_summary" => {
            spec.intent_summary = prd_operation_text(operation).map(str::to_string);
            applied("intentSummary".into())
        }
        "append_scope" | "append_non_goal" | "append_constraint" => {
            let root = list_root_for_prd_operation(operation.op.as_str())?;
            let value = prd_operation_text(operation)?;
            let list = list_for_root_mut(spec, root);
            *list = append_unique_string(std::mem::take(list), value);
            applied(root.into())
        }
        "append_acceptance_criterion" => {
            let text = prd_operation_text(operation)?;
            let criterion_id = allocate_acceptance_criterion_id(&spec.acceptance_criteria);
            spec.acceptance_criteria.push(AcceptanceCriterion {
                criterion_id: criterion_id.clone(),
                text: text.to_string(),
                source: AcceptanceCriterionSource::Interview,
                status: AcceptanceCriterionStatus::Active,
                created_in_version: spec.current_version.unwrap_or(1),
                retired_in_version: None,
            });
            Some(AppliedOperation {
                field_path: "acceptanceCriteria".into(),
                criterion_id_assigned: Some(criterion_id),
            })
        }
        "revise_acceptance_criterion_text" => {
            let criterion_id = operation.criterion_id.as_deref()?;
            let text = prd_operation_text(operation)?;
            for criterion in &mut spec.acceptance_criteria {
                if criterion.criterion_id == criterion_id
                    && matches!(criterion.status, AcceptanceCriterionStatus::Active)
                {
                    criterion.text = text.to_string();
                }
            }
            applied(format!("acceptanceCriteria.{criterion_id}.text"))
        }
        // S-072 (014 theme 2): in-place list edits. `target` addresses the
        // current item by text (D-014-05, see `find_list_item_index`).
        "revise_scope" | "revise_non_goal" | "revise_constraint" => {
            let root = list_root_for_prd_operation(operation.op.as_str())?;
            let target = prd_operation_target(operation)?;
            let value = prd_operation_text(operation)?;
            let list = list_for_root_mut(spec, root);
            let index = find_list_item_index(list, target)?;
            // S-072 review (P2): revising an item INTO wording that already
            // exists elsewhere in the list would leave a duplicate. Treat it
            // as a merge — drop the target, keep the existing item as is.
            if other_index_with_same_text(list, index, value).is_some() {
                list.remove(index);
            } else {
                list[index] = value.to_string();
            }
            applied(root.into())
        }
        "remove_scope" | "remove_non_goal" | "remove_constraint" => {
            let root = list_root_for_prd_operation(operation.op.as_str())?;
            let target = prd_operation_target(operation)?;
            let list = list_for_root_mut(spec, root);
            let index = find_list_item_index(list, target)?;
            list.remove(index);
            applied(root.into())
        }
        // D-014-06: criteria are retired, never deleted — the row stays in
        // the snapshot for the versioned PRD / decomposition history and
        // the active-count gate already ignores retired ones.
        "retire_acceptance_criterion" => {
            let criterion_id = resolve_retire_criterion_id(spec, operation)?;
            // `retiredInVersion` is stamped with the draft's current version,
            // falling back to 1 for a never-saved draft — deliberately the
            // same convention `created_in_version` uses above, so both
            // version columns read on the same scale (a criterion created
            // and retired in the same unsaved draft shows 1 / 1).
            let version = spec.current_version.unwrap_or(1);
            for criterion in &mut spec.acceptance_criteria {
                if criterion.criterion_id == criterion_id
                    && matches!(criterion.status, AcceptanceCriterionStatus::Active)
                {
                    criterion.status = AcceptanceCriterionStatus::Retired;
                    criterion.retired_in_version = Some(version);
                }
            }
            applied(format!("acceptanceCriteria.{criterion_id}.status"))
        }
        _ => None,
    }
}

/// Per-op validation (S-072 made it per-op; before that every op was
/// "requires text"). Any reason rejects the WHOLE patch — same all-or-nothing
/// rule 004 applied to `criterion_not_found` (D-014-05).
///
/// | op                                               | requires                                              | reason when unmet      |
/// | ------------------------------------------------ | ----------------------------------------------------- | ---------------------- |
/// | `set_*`, `append_*`                              | non-empty `value`/`text`                              | `missing_text`         |
/// | `revise_acceptance_criterion_text`               | non-empty text; `criterionId` exists AND is `active`  | `missing_text` / `criterion_not_found` |
/// | `revise_scope` / `_non_goal` / `_constraint`     | non-empty text; `target` matches an item              | `missing_text` / `item_not_found` |
/// | `remove_scope` / `_non_goal` / `_constraint`     | `target` matches an item (no text)                    | `item_not_found`       |
/// | `retire_acceptance_criterion`                    | `criterionId` (or a text that resolves to exactly one active criterion) exists AND is `active` | `criterion_not_found` |
///
/// `text_too_large` is checked on every text field an op carries (`value`,
/// `text`, `target`). `secret_like_text` too — except the `target` of a
/// `remove_*` op: that text is already IN the draft, and blocking its removal
/// would keep a leaked secret there instead of letting the student drop it.
///
/// Ops are validated in order against a SIMULATED copy of the spec that is
/// mutated exactly as apply would mutate it (held ops excluded), so a later
/// op that addresses an item an earlier op already removed or reworded is
/// caught here as `item_not_found` rather than no-op'ing at apply time.
fn validate_prd_patch_for_draft(patch: &PrdPatch, draft: &LiveProjectSpecDraftRow) -> Vec<String> {
    let mut reasons = Vec::new();
    if patch.operations.len() > MAX_PRD_PATCH_OPERATIONS {
        push_unique(&mut reasons, "too_many_operations".into());
    }
    let mut simulated = draft.spec.clone();
    compact_spec_lists(&mut simulated);
    for operation in &patch.operations {
        let op = operation.op.as_str();
        if !is_supported_prd_operation(op) {
            push_unique(&mut reasons, "unsupported_operation".into());
            continue;
        }
        let is_remove = matches!(op, "remove_scope" | "remove_non_goal" | "remove_constraint");
        for (field, carried) in [
            ("value", operation.value.as_deref()),
            ("text", operation.text.as_deref()),
            ("target", operation.target.as_deref()),
        ] {
            let Some(carried) = carried else {
                continue;
            };
            if carried.chars().count() > MAX_PRD_PATCH_TEXT_CHARS {
                push_unique(&mut reasons, "text_too_large".into());
            }
            let secret_gate_exempt = is_remove && field == "target";
            if !secret_gate_exempt && looks_secret_like(carried) {
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
                // S-072 review (P1): a retired criterion is already dropped —
                // revising it would resurrect wording the student let go of.
                let found = operation
                    .criterion_id
                    .as_deref()
                    .is_some_and(|criterion_id| is_active_criterion(&simulated, criterion_id));
                if !found {
                    push_unique(&mut reasons, "criterion_not_found".into());
                }
            }
            "retire_acceptance_criterion" => {
                let found = resolve_retire_criterion_id(&simulated, operation)
                    .is_some_and(|criterion_id| is_active_criterion(&simulated, &criterion_id));
                if !found {
                    push_unique(&mut reasons, "criterion_not_found".into());
                }
            }
            "revise_scope" | "revise_non_goal" | "revise_constraint" | "remove_scope"
            | "remove_non_goal" | "remove_constraint" => {
                let found = list_root_for_prd_operation(op).is_some_and(|root| {
                    prd_operation_target(operation)
                        .and_then(|target| {
                            find_list_item_index(list_for_root(&simulated, root), target)
                        })
                        .is_some()
                });
                if !found {
                    push_unique(&mut reasons, "item_not_found".into());
                }
            }
            _ => {}
        }
        // Advance the simulation only for ops apply would actually run: a
        // held op leaves the draft untouched, so it must leave the
        // simulation untouched too.
        let field_path = field_path_for_prd_operation(operation);
        if conflicts_with_student_edit(&field_path, &draft.student_edited_fields).is_none() {
            apply_operation_to_spec(&mut simulated, operation);
        }
    }
    reasons
}

fn is_active_criterion(spec: &ProjectSpecDraft, criterion_id: &str) -> bool {
    spec.acceptance_criteria.iter().any(|criterion| {
        criterion.criterion_id == criterion_id
            && matches!(criterion.status, AcceptanceCriterionStatus::Active)
    })
}

/// The criterion a `retire_acceptance_criterion` op addresses. `criterionId`
/// wins when present (its existence/status is checked by the caller). Without
/// one, the op's `target`/`text` is resolved against the ACTIVE criteria only:
/// first as a literal criterion id, then by criterion text with the same
/// exact-then-unique-normalized matching the list ops use — so an ambiguous
/// or retired-only match resolves to nothing (`criterion_not_found`).
fn resolve_retire_criterion_id(
    spec: &ProjectSpecDraft,
    operation: &PrdPatchOperation,
) -> Option<String> {
    if let Some(criterion_id) = operation
        .criterion_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        return Some(criterion_id.to_string());
    }
    let wanted = prd_operation_target(operation)
        .or_else(|| prd_operation_text(operation))
        .filter(|text| !text.is_empty())?;
    let active: Vec<&AcceptanceCriterion> = spec
        .acceptance_criteria
        .iter()
        .filter(|criterion| matches!(criterion.status, AcceptanceCriterionStatus::Active))
        .collect();
    if let Some(by_id) = active
        .iter()
        .find(|criterion| criterion.criterion_id == wanted)
    {
        return Some(by_id.criterion_id.clone());
    }
    let texts: Vec<String> = active
        .iter()
        .map(|criterion| criterion.text.clone())
        .collect();
    let index = find_list_item_index(&texts, wanted)?;
    Some(active[index].criterion_id.clone())
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

/// S-072 / D-014-05 strict normalization: trim, collapse internal whitespace
/// runs to a single space, case-insensitive.
fn normalize_list_item_text(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// S-072 review loose normalization for the drift a model introduces when it
/// re-types a Korean/mixed item: curly quotes → straight, ALL whitespace
/// removed (so `기능(구글, 카카오)` and `기능 (구글,카카오)` agree), trailing
/// `.` / `。` / `,` dropped, case-insensitive. Unicode NFC normalization is
/// NOT applied — the crate is not a dependency and adding one for this was
/// out of scope; decomposed Hangul jamo input therefore still has to match
/// byte-for-byte.
fn loose_normalize_list_item_text(text: &str) -> String {
    let unified: String = text
        .chars()
        .map(|ch| match ch {
            '\u{2018}' | '\u{2019}' => '\'',
            '\u{201C}' | '\u{201D}' => '"',
            other => other,
        })
        .filter(|ch| !ch.is_whitespace())
        .collect();
    unified
        .to_lowercase()
        .trim_end_matches(['.', '\u{3002}', ','])
        .to_string()
}

/// The single index satisfying `matches`, or `None` when zero OR MORE THAN
/// ONE item does — an ambiguous address must never edit "whichever came
/// first" (a wrong-item edit is worse than a rejection, D-014-05).
fn unique_position(items: &[String], matches: impl Fn(&str) -> bool) -> Option<usize> {
    let mut found = None;
    for (index, item) in items.iter().enumerate() {
        if matches(item) {
            if found.is_some() {
                return None;
            }
            found = Some(index);
        }
    }
    found
}

/// Resolves a `target` to an index in three passes, each only consulted when
/// the previous one found nothing:
/// 1. exact trimmed equality — first match wins (an exact duplicate in the
///    list is the list's own problem, not an addressing ambiguity);
/// 2. strict normalization (`normalize_list_item_text`) — accepted only when
///    it identifies exactly ONE item;
/// 3. loose normalization (`loose_normalize_list_item_text`) — likewise only
///    when unique.
///
/// A blank target never matches. Two items that collapse together under the
/// pass that would otherwise match therefore yield `None` → `item_not_found`.
fn find_list_item_index(items: &[String], target: &str) -> Option<usize> {
    let target = target.trim();
    if target.is_empty() {
        return None;
    }
    if let Some(index) = items.iter().position(|item| item.trim() == target) {
        return Some(index);
    }
    let strict = normalize_list_item_text(target);
    if let Some(index) = unique_position(items, |item| normalize_list_item_text(item) == strict) {
        return Some(index);
    }
    let loose = loose_normalize_list_item_text(target);
    unique_position(items, |item| loose_normalize_list_item_text(item) == loose)
}

/// For a revise: another index whose item already carries `value` (exact
/// trimmed or strict-normalized equal) — the merge case.
fn other_index_with_same_text(list: &[String], index: usize, value: &str) -> Option<usize> {
    let value = value.trim();
    let wanted = normalize_list_item_text(value);
    list.iter().enumerate().find_map(|(candidate, item)| {
        (candidate != index && (item.trim() == value || normalize_list_item_text(item) == wanted))
            .then_some(candidate)
    })
}

/// The list root (field-path root AND provenance key) an `append_*` /
/// `revise_*` / `remove_*` list op addresses; `None` for every other op.
fn list_root_for_prd_operation(op: &str) -> Option<&'static str> {
    match op {
        "append_scope" | "revise_scope" | "remove_scope" => Some("scope"),
        "append_non_goal" | "revise_non_goal" | "remove_non_goal" => Some("nonGoals"),
        "append_constraint" | "revise_constraint" | "remove_constraint" => Some("constraints"),
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
        // A retire addressed by text (no `criterionId`) resolves its id at
        // apply time; the root is what the hold check needs here.
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
    fn find_list_item_index_prefers_exact_then_unique_normalized_match() {
        let items = vec!["Alpha".to_string(), "beta".to_string(), "ALPHA".to_string()];
        // Exact trimmed match wins outright, even with a case-variant twin.
        assert_eq!(find_list_item_index(&items, " Alpha "), Some(0));
        assert_eq!(find_list_item_index(&items, "ALPHA"), Some(2));
        // No exact match and TWO strict-normalized matches → ambiguous → None.
        assert_eq!(find_list_item_index(&items, "alpha"), None);
        // Unique normalized match is accepted.
        assert_eq!(find_list_item_index(&items, "  BETA "), Some(1));
        assert_eq!(find_list_item_index(&items, "gamma"), None);
        assert_eq!(find_list_item_index(&items, "   "), None);
        assert_eq!(find_list_item_index(&[], "alpha"), None);
    }

    #[test]
    fn loose_normalize_unifies_quotes_strips_whitespace_and_trailing_punctuation() {
        assert_eq!(
            loose_normalize_list_item_text("로그인 기능 (구글,카카오)."),
            "로그인기능(구글,카카오)"
        );
        assert_eq!(
            loose_normalize_list_item_text("\u{201C}Today\u{2019}s\u{201D} classes。"),
            "\"today's\"classes"
        );
        assert_eq!(
            loose_normalize_list_item_text("Export as PDF,"),
            "exportaspdf"
        );
    }

    #[test]
    fn find_list_item_index_loose_pass_matches_korean_spacing_drift_only_when_unique() {
        let items = vec![
            "로그인 기능(구글, 카카오)".to_string(),
            "과제 알림".to_string(),
        ];
        assert_eq!(
            find_list_item_index(&items, "로그인 기능 (구글,카카오)"),
            Some(0)
        );
        assert_eq!(
            find_list_item_index(&items, "로그인 기능(구글, 카카오)."),
            Some(0)
        );
        // Two items that collapse together under the loose pass → None.
        let ambiguous = vec!["Export as PDF.".to_string(), "Export as PDF,".to_string()];
        assert_eq!(find_list_item_index(&ambiguous, "export as pdf"), None);
        // ...but an exact hit on one of them still resolves.
        assert_eq!(find_list_item_index(&ambiguous, "Export as PDF,"), Some(1));
    }

    #[test]
    fn case_variant_duplicates_reject_with_item_not_found_unless_addressed_exactly() {
        let mut draft = draft_with_lists();
        draft.spec.scope = vec!["Login page".into(), "login page".into()];
        let original = draft.clone();
        let rejected = apply_prd_patch_to_draft(
            draft.clone(),
            &patch(vec![revise("revise_scope", "LOGIN PAGE", "Sign-in page")]),
        );
        assert_eq!(rejected.validation_outcome, "rejected");
        assert_eq!(rejected.rejected_reasons, vec!["item_not_found"]);
        assert_eq!(rejected.draft, original);

        let exact = apply_prd_patch_to_draft(
            draft,
            &patch(vec![revise("revise_scope", "login page", "Sign-in page")]),
        );
        assert_eq!(exact.validation_outcome, "applied");
        assert_eq!(
            exact.draft.spec.scope,
            vec!["Login page".to_string(), "Sign-in page".to_string()]
        );
    }

    #[test]
    fn loose_pass_rejects_when_two_items_collapse_equal() {
        let mut draft = draft_with_lists();
        draft.spec.constraints = vec!["Export as PDF.".into(), "Export as PDF,".into()];
        let original = draft.clone();
        let result = apply_prd_patch_to_draft(
            draft,
            &patch(vec![remove("remove_constraint", "export as pdf")]),
        );
        assert_eq!(result.validation_outcome, "rejected");
        assert_eq!(result.rejected_reasons, vec!["item_not_found"]);
        assert_eq!(result.draft, original);
    }

    #[test]
    fn revise_korean_item_with_spacing_and_punctuation_drift_matches_in_place() {
        let mut draft = draft_with_lists();
        draft.spec.scope = vec!["로그인 기능(구글, 카카오)".into(), "과제 알림".into()];
        let result = apply_prd_patch_to_draft(
            draft,
            &patch(vec![revise(
                "revise_scope",
                "로그인 기능 (구글,카카오)",
                "로그인 기능(구글만)",
            )]),
        );
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(
            result.draft.spec.scope,
            vec!["로그인 기능(구글만)".to_string(), "과제 알림".to_string()]
        );
    }

    #[test]
    fn revise_to_an_existing_item_merges_instead_of_duplicating() {
        let mut draft = draft_with_lists();
        draft.spec.scope = vec!["A".into(), "B".into()];
        let result = apply_prd_patch_to_draft(
            draft.clone(),
            &patch(vec![revise("revise_scope", "A", "B")]),
        );
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.applied_field_paths, vec!["scope"]);
        assert_eq!(result.draft.spec.scope, vec!["B".to_string()]);

        // Normalized equality merges too, keeping the EXISTING wording.
        let normalized =
            apply_prd_patch_to_draft(draft, &patch(vec![revise("revise_scope", "A", "  b ")]));
        assert_eq!(normalized.validation_outcome, "applied");
        assert_eq!(normalized.draft.spec.scope, vec!["B".to_string()]);
    }

    #[test]
    fn sequential_validation_rejects_reuse_of_a_removed_target() {
        let original = draft_with_lists();
        let result = apply_prd_patch_to_draft(
            original.clone(),
            &patch(vec![
                remove("remove_scope", "Add and remove schedule items"),
                revise(
                    "revise_scope",
                    "Add and remove schedule items",
                    "Edit items",
                ),
            ]),
        );
        assert_eq!(result.validation_outcome, "rejected");
        assert_eq!(result.rejected_reasons, vec!["item_not_found"]);
        assert_eq!(result.draft, original);
    }

    #[test]
    fn sequential_validation_rejects_double_revise_of_the_same_target() {
        let original = draft_with_lists();
        let result = apply_prd_patch_to_draft(
            original.clone(),
            &patch(vec![
                revise(
                    "revise_scope",
                    "Show today's classes",
                    "Show today's classes v1",
                ),
                revise(
                    "revise_scope",
                    "Show today's classes",
                    "Show today's classes v2",
                ),
            ]),
        );
        assert_eq!(result.validation_outcome, "rejected");
        assert_eq!(result.rejected_reasons, vec!["item_not_found"]);
        assert_eq!(result.draft, original);
    }

    #[test]
    fn sequential_validation_accepts_a_chained_revise_and_sees_appended_items() {
        let result = apply_prd_patch_to_draft(
            draft_with_lists(),
            &patch(vec![
                revise("revise_scope", "Show today's classes", "Show this week"),
                revise("revise_scope", "Show this week", "Show this month"),
                PrdPatchOperation {
                    value: Some("Print a timetable".into()),
                    ..op("append_non_goal")
                },
                remove("remove_non_goal", "Print a timetable"),
            ]),
        );
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.draft.spec.scope[1], "Show this month");
        assert_eq!(result.draft.spec.non_goals.len(), 2);
    }

    #[test]
    fn sequential_validation_resolves_a_criterion_appended_earlier_in_the_patch() {
        let mut append = op("append_acceptance_criterion");
        append.text = Some("Exports a CSV of the week".into());
        let mut retire_by_text = op("retire_acceptance_criterion");
        retire_by_text.text = Some("Exports a CSV of the week".into());
        let result =
            apply_prd_patch_to_draft(draft_with_lists(), &patch(vec![append, retire_by_text]));
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(result.criterion_ids_assigned, vec!["AC-003"]);
        assert!(result
            .applied_field_paths
            .contains(&"acceptanceCriteria.AC-003.status".to_string()));
        let added = &result.draft.spec.acceptance_criteria[2];
        assert_eq!(added.criterion_id, "AC-003");
        assert!(matches!(added.status, AcceptanceCriterionStatus::Retired));
        assert_eq!(added.retired_in_version, Some(2));
    }

    #[test]
    fn held_ops_do_not_advance_the_validation_simulation() {
        // Both ops address the same (student-edited) item. Neither will
        // apply, so the second must NOT be rejected as item_not_found on
        // account of the first — the whole patch is held, not rejected.
        let mut draft = draft_with_lists();
        draft.student_edited_fields = vec!["scope".into()];
        let result = apply_prd_patch_to_draft(
            draft,
            &patch(vec![
                revise("revise_scope", "Show today's classes", "v1"),
                revise("revise_scope", "Show today's classes", "v2"),
            ]),
        );
        assert_eq!(result.validation_outcome, "held_for_student");
        assert_eq!(result.rejected_reasons, vec!["student_edit_conflict"]);
        assert_eq!(result.draft.spec.scope[1], "Show today's classes");
    }

    #[test]
    fn revise_acceptance_criterion_text_on_retired_criterion_rejects() {
        let original = draft_with_lists();
        let mut revise_retired = op("revise_acceptance_criterion_text");
        revise_retired.criterion_id = Some("AC-002".into());
        revise_retired.text = Some("Resurrected wording".into());
        let result = apply_prd_patch_to_draft(original.clone(), &patch(vec![revise_retired]));
        assert_eq!(result.validation_outcome, "rejected");
        assert_eq!(result.rejected_reasons, vec!["criterion_not_found"]);
        assert_eq!(result.draft, original);

        // The active one still revises.
        let mut revise_active = op("revise_acceptance_criterion_text");
        revise_active.criterion_id = Some("AC-001".into());
        revise_active.text = Some("Schedules and tasks are listed separately".into());
        let ok = apply_prd_patch_to_draft(original, &patch(vec![revise_active]));
        assert_eq!(ok.validation_outcome, "applied");
        assert_eq!(
            ok.draft.spec.acceptance_criteria[0].text,
            "Schedules and tasks are listed separately"
        );
    }

    #[test]
    fn retire_resolves_criterion_by_text_when_no_id_is_given() {
        let mut by_text = op("retire_acceptance_criterion");
        by_text.text = Some("  schedules and tasks appear in separate lists ".into());
        let result = apply_prd_patch_to_draft(draft_with_lists(), &patch(vec![by_text]));
        assert_eq!(result.validation_outcome, "applied");
        assert_eq!(
            result.applied_field_paths,
            vec!["acceptanceCriteria.AC-001.status"]
        );
        assert!(matches!(
            result.draft.spec.acceptance_criteria[0].status,
            AcceptanceCriterionStatus::Retired
        ));

        // A literal id in `target` also resolves.
        let mut by_id_in_target = op("retire_acceptance_criterion");
        by_id_in_target.target = Some("AC-001".into());
        let via_target =
            apply_prd_patch_to_draft(draft_with_lists(), &patch(vec![by_id_in_target]));
        assert_eq!(via_target.validation_outcome, "applied");

        // Text of an already-retired criterion → nothing active matches.
        let original = draft_with_lists();
        let mut retired_text = op("retire_acceptance_criterion");
        retired_text.text = Some("Old criterion already retired".into());
        let miss = apply_prd_patch_to_draft(original.clone(), &patch(vec![retired_text]));
        assert_eq!(miss.rejected_reasons, vec!["criterion_not_found"]);
        assert_eq!(miss.draft, original);

        // Ambiguous text (two active criteria collapse equal) → not found.
        let mut ambiguous = draft_with_lists();
        ambiguous.spec.acceptance_criteria.push(criterion(
            "AC-003",
            "SCHEDULES AND TASKS APPEAR IN SEPARATE LISTS",
            true,
        ));
        let mut ambiguous_op = op("retire_acceptance_criterion");
        ambiguous_op.text = Some("schedules and tasks appear in separate lists".into());
        let dup = apply_prd_patch_to_draft(ambiguous, &patch(vec![ambiguous_op]));
        assert_eq!(dup.rejected_reasons, vec!["criterion_not_found"]);
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
    fn remove_with_secret_like_target_succeeds_but_revise_with_secret_like_value_rejects() {
        // S-072 review (P2): a remove target is text ALREADY in the draft —
        // the student is trying to get the secret out, so the gate must not
        // keep it in.
        let mut draft = draft_with_lists();
        draft
            .spec
            .constraints
            .push("api_key=supersecretvalue".into());
        let removed = apply_prd_patch_to_draft(
            draft.clone(),
            &patch(vec![remove(
                "remove_constraint",
                "api_key=supersecretvalue",
            )]),
        );
        assert_eq!(removed.validation_outcome, "applied");
        assert_eq!(removed.applied_field_paths, vec!["constraints"]);
        assert!(!removed
            .draft
            .spec
            .constraints
            .iter()
            .any(|item| item.contains("supersecretvalue")));

        // Every other text field keeps the gate: a revise whose NEW value is
        // secret-like still rejects, and so does a secret-like revise target.
        let revised = apply_prd_patch_to_draft(
            draft.clone(),
            &patch(vec![revise(
                "revise_constraint",
                "Must run offline",
                "token=abc123XYZ",
            )]),
        );
        assert_eq!(revised.validation_outcome, "rejected");
        assert_eq!(revised.rejected_reasons, vec!["secret_like_text"]);

        let revise_target = apply_prd_patch_to_draft(
            draft,
            &patch(vec![revise(
                "revise_constraint",
                "api_key=supersecretvalue",
                "Keys live in the environment",
            )]),
        );
        assert_eq!(revise_target.validation_outcome, "rejected");
        assert_eq!(revise_target.rejected_reasons, vec!["secret_like_text"]);
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
