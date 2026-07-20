//! Criterion-quality lint engine and step-envelope validation.
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use std::collections::{BTreeMap, HashSet};

use serde::Serialize;

use crate::db::models::StepKind;
#[cfg(test)]
use crate::db::models::{
    AcceptanceCriterion, AcceptanceCriterionSource, AcceptanceCriterionStatus,
};
use crate::dive::plan_quality_constants::{
    contains_any, criterion_class_is_covered, data_fetch_keywords, ui_goal_keywords, vague_terms,
    verification_type_from_legacy, MissingCriterionClass, VerificationType, COMPARATOR_MARKERS,
    NAMED_UI_MARKERS, NUMERIC_CONTEXT_MARKERS, STATE_MARKERS, VAGUE_FILLER_WORDS,
};
#[cfg(test)]
use crate::dive::plan_quality_constants::{EMPTY_STATE_MARKERS, RESPONSIVE_MARKERS};

use super::*;

pub(super) const MAX_PLAN_STEPS: usize = 8;
const MAX_STEP_EXPECTED_FILES: usize = 8;
const MAX_STEP_ACCEPTANCE_CRITERIA: usize = 8;
const MAX_VERIFICATION_COMMAND_WORDS: usize = 24;
const PLAN_DRAFT_QUALITY_ERROR_PREFIX: &str = "PLAN_DRAFT_QUALITY_ERROR:";
const BROAD_SCOPE_MARKERS: &[&str] = &[
    "desktop app",
    "full app",
    "full-stack",
    "full stack",
    "crud",
    "calendar",
    "notification",
    "auth",
    "database",
    "end-to-end",
    "end to end",
    "데스크톱 앱",
    "전체 앱",
    "전체 기능",
    "일정",
    "캘린더",
    "알림",
    "인증",
    "데이터베이스",
    "완성",
];

fn validate_unique_step_ids(steps: &[StepDraftInput]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for step in steps {
        if !ids.insert(step.step_id.as_str()) {
            return Err(format!("duplicate step_id: {}", step.step_id));
        }
    }
    Ok(())
}

pub(super) fn validate_plan_draft(plan_input: &PlanDraftInput) -> Result<(), String> {
    if plan_input.steps.is_empty() {
        return Err("plan must include at least one step".into());
    }
    if plan_input.steps.len() > MAX_PLAN_STEPS {
        return Err(format!(
            "plan exceeds DIVE execution envelope: at most {MAX_PLAN_STEPS} steps are allowed"
        ));
    }
    validate_unique_step_ids(&plan_input.steps)?;
    for step in &plan_input.steps {
        validate_step_envelope(step)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CriterionQualityErrorReason {
    VagueCriteria,
    MissingStateCriteria,
}

impl CriterionQualityErrorReason {
    fn as_str(&self) -> &'static str {
        match self {
            CriterionQualityErrorReason::VagueCriteria => "vague_criteria",
            CriterionQualityErrorReason::MissingStateCriteria => "missing_state_criteria",
        }
    }
}

/// S-050 D4: machine-coded issue attached to a `CriterionQualityError`. One
/// issue per Err-site finding (e.g. one per junk criterion, one per missing
/// class) so the frontend can render localized, code-driven recovery copy
/// instead of parsing the English `unresolved_questions` prose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct CriterionQualityIssue {
    code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    step_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    missing_class: Option<&'static str>,
}

impl CriterionQualityIssue {
    fn code(code: &'static str) -> Self {
        Self {
            code,
            preview: None,
            step_ref: None,
            missing_class: None,
        }
    }

    fn with_preview(code: &'static str, preview: String) -> Self {
        Self {
            code,
            preview: Some(preview),
            step_ref: None,
            missing_class: None,
        }
    }

    fn with_step_ref(code: &'static str, step_ref: String) -> Self {
        Self {
            code,
            preview: None,
            step_ref: Some(step_ref),
            missing_class: None,
        }
    }

    fn with_missing_class(code: &'static str, missing_class: &'static str) -> Self {
        Self {
            code,
            preview: None,
            step_ref: None,
            missing_class: Some(missing_class),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CriterionQualityError {
    reason: CriterionQualityErrorReason,
    unresolved_questions: Vec<String>,
    issues: Vec<CriterionQualityIssue>,
}

impl CriterionQualityError {
    fn new(
        reason: CriterionQualityErrorReason,
        unresolved_questions: Vec<String>,
        issues: Vec<CriterionQualityIssue>,
    ) -> Self {
        Self {
            reason,
            unresolved_questions,
            issues,
        }
    }
}

impl std::fmt::Display for CriterionQualityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        #[derive(Serialize)]
        struct Payload<'a> {
            code: &'static str,
            reason: &'static str,
            unresolved_questions: &'a [String],
            issues: &'a [CriterionQualityIssue],
        }

        let payload = Payload {
            code: "plan_draft_quality",
            reason: self.reason.as_str(),
            unresolved_questions: &self.unresolved_questions,
            issues: &self.issues,
        };
        let encoded = serde_json::to_string(&payload).unwrap_or_else(|_| {
            format!(
                "{{\"code\":\"plan_draft_quality\",\"reason\":\"{}\",\"unresolved_questions\":[],\"issues\":[]}}",
                self.reason.as_str()
            )
        });
        write!(f, "{PLAN_DRAFT_QUALITY_ERROR_PREFIX}{encoded}")
    }
}

/// S-050 D1: the accepted draft's non-blocking findings. Surfaced to the
/// EventLog as `plan.criterion_quality_advisory` annotations by
/// `log_criterion_quality_advisories`, once the draft is persisted (P3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CriterionQualityReport {
    pub(super) advisories: Vec<CriterionQualityAdvisory>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct CriterionQualityAdvisory {
    pub(super) code: &'static str,
    pub(super) criterion_preview: String,
    pub(super) step_ref: Option<String>,
}

/// S-050 D1: blocking is now bundle/step-level rather than a per-criterion
/// veto. A non-junk criterion that merely lacks an observable marker no
/// longer blocks by itself — it only blocks if it leaves the whole plan, or
/// one of its steps, with zero marker-bearing criteria; otherwise it is
/// returned as an advisory on the accepted report.
pub(super) fn validate_criterion_quality(
    goal: &str,
    plan_input: &PlanDraftInput,
) -> Result<CriterionQualityReport, CriterionQualityError> {
    let criteria = collect_acceptance_criterion_texts(plan_input);
    if criteria.is_empty() {
        return Err(CriterionQualityError::new(
            CriterionQualityErrorReason::VagueCriteria,
            vec!["Add at least one independently checkable acceptance criterion.".into()],
            vec![CriterionQualityIssue::code("criteria_empty")],
        ));
    }

    let mut criterion_issues = Vec::new();
    let mut criterion_issue_codes = Vec::new();
    for criterion in &criteria {
        if criterion_substantive_len(criterion) < 8 {
            criterion_issues.push(format!(
                "Rewrite acceptance criterion with a concrete observable result: \"{}\"",
                compact_preview(criterion)
            ));
            criterion_issue_codes.push(CriterionQualityIssue::with_preview(
                "criterion_too_short",
                compact_preview(criterion),
            ));
        } else if criterion_is_pure_vague_filler(criterion) {
            criterion_issues.push(format!(
                "Replace vague acceptance criterion with a concrete observable result: \"{}\"",
                compact_preview(criterion)
            ));
            criterion_issue_codes.push(CriterionQualityIssue::with_preview(
                "criterion_vague_filler",
                compact_preview(criterion),
            ));
        }
    }
    if !criterion_issues.is_empty() {
        return Err(CriterionQualityError::new(
            CriterionQualityErrorReason::VagueCriteria,
            criterion_issues,
            criterion_issue_codes,
        ));
    }

    if !criteria
        .iter()
        .any(|criterion| criterion_has_observable_marker(criterion))
    {
        return Err(CriterionQualityError::new(
            CriterionQualityErrorReason::VagueCriteria,
            vec![
                "Add at least one acceptance criterion with an independently checkable marker such as a number, comparator, named UI element, or state.".into(),
            ],
            vec![CriterionQualityIssue::code("plan_no_marker")],
        ));
    }

    for (index, step) in plan_input.steps.iter().enumerate() {
        let step_has_marker = step
            .acceptance_criteria
            .iter()
            .filter_map(criterion_input_text)
            .any(|criterion| criterion_has_observable_marker(&criterion));
        if !step_has_marker {
            let step_ref = step_display_name(step, index);
            return Err(CriterionQualityError::new(
                CriterionQualityErrorReason::VagueCriteria,
                vec![format!(
                    "Step \"{}\" has no independently checkable acceptance criterion; add one with a number, comparator, named UI element, or state.",
                    step_ref
                )],
                vec![CriterionQualityIssue::with_step_ref(
                    "step_unverifiable",
                    step_ref,
                )],
            ));
        }
    }

    let locale_is_en = text_prefers_english(goal);
    let goal_text = normalize_quality_text(&format!("{goal}\n{}", plan_input.goal));
    let criteria_text = normalize_quality_text(&criteria.join("\n"));
    let mut missing = Vec::new();
    let mut missing_issues = Vec::new();
    let mut advisories = Vec::new();

    if contains_any(&goal_text, ui_goal_keywords()) {
        if !criterion_class_is_covered(&criteria_text, MissingCriterionClass::Responsive) {
            missing.push(
                MissingCriterionClass::Responsive
                    .label(locale_is_en)
                    .to_string(),
            );
            missing_issues.push(CriterionQualityIssue::with_missing_class(
                "missing_state_class",
                MissingCriterionClass::Responsive.as_str(),
            ));
        }
        for class in [
            MissingCriterionClass::Persistence,
            MissingCriterionClass::Accessibility,
        ] {
            if !criterion_class_is_covered(&criteria_text, class) {
                advisories.push(CriterionQualityAdvisory {
                    code: "missing_state_class_advisory",
                    criterion_preview: class.as_str().to_string(),
                    step_ref: None,
                });
            }
        }
    }

    if contains_any(&goal_text, data_fetch_keywords()) {
        for class in [
            MissingCriterionClass::Loading,
            MissingCriterionClass::Empty,
            MissingCriterionClass::Error,
        ] {
            if !criterion_class_is_covered(&criteria_text, class) {
                missing.push(class.label(locale_is_en).to_string());
                missing_issues.push(CriterionQualityIssue::with_missing_class(
                    "missing_state_class",
                    class.as_str(),
                ));
            }
        }
    }

    if !missing.is_empty() {
        return Err(CriterionQualityError::new(
            CriterionQualityErrorReason::MissingStateCriteria,
            missing,
            missing_issues,
        ));
    }

    advisories.extend(marker_less_criterion_advisories(plan_input));
    advisories.extend(step_overlap_advisories(plan_input));

    Ok(CriterionQualityReport { advisories })
}

fn step_display_name(step: &StepDraftInput, index: usize) -> String {
    let title = step.title.trim();
    if title.is_empty() {
        format!("Step {}", index + 1)
    } else {
        title.to_string()
    }
}

/// S-050 D1: non-junk criteria that lack an observable marker, collected once
/// the blocking checks above have all passed. Global-level and per-step
/// criteria are walked separately so each advisory can carry its step_ref.
fn marker_less_criterion_advisories(plan_input: &PlanDraftInput) -> Vec<CriterionQualityAdvisory> {
    let mut advisories = Vec::new();
    for criterion in &plan_input.acceptance_criteria {
        if let Some(text) = criterion_input_text(criterion) {
            if !criterion_has_observable_marker(&text) {
                advisories.push(CriterionQualityAdvisory {
                    code: "criterion_no_marker",
                    criterion_preview: compact_preview(&text),
                    step_ref: None,
                });
            }
        }
    }
    for (index, step) in plan_input.steps.iter().enumerate() {
        for criterion in &step.acceptance_criteria {
            if let Some(text) = criterion_input_text(criterion) {
                if !criterion_has_observable_marker(&text) {
                    advisories.push(CriterionQualityAdvisory {
                        code: "criterion_no_marker",
                        criterion_preview: compact_preview(&text),
                        step_ref: Some(step_display_name(step, index)),
                    });
                }
            }
        }
    }
    advisories
}

/// S-056 D2 (011 theme 7 / P2-03): two deterministic cross-step advisories,
/// per D-011-01's hard constraint that this check is advisory-first and can
/// never block a plan. Neither sub-check below touches an `Err` path — both
/// only ever push onto the accepted report's `advisories` vec.
fn step_overlap_advisories(plan_input: &PlanDraftInput) -> Vec<CriterionQualityAdvisory> {
    let mut advisories = step_expected_file_overlap_advisories(plan_input);
    advisories.extend(step_criterion_duplicate_advisories(plan_input));
    advisories
}

/// `step_expected_file_overlap`: the same `expected_files` entry (trimmed,
/// lowercased, backslashes normalized to forward slashes) is claimed by two
/// or more steps. Emits one advisory per duplicated path — not per pair —
/// naming the highest-index ("later") step that claims it.
fn step_expected_file_overlap_advisories(
    plan_input: &PlanDraftInput,
) -> Vec<CriterionQualityAdvisory> {
    let mut steps_by_path: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, step) in plan_input.steps.iter().enumerate() {
        let mut seen_in_step = HashSet::new();
        for raw in &step.expected_files {
            let normalized = normalize_expected_file_path(raw);
            if normalized.is_empty() || !seen_in_step.insert(normalized.clone()) {
                continue;
            }
            steps_by_path.entry(normalized).or_default().push(index);
        }
    }

    steps_by_path
        .into_iter()
        .filter(|(_, indices)| indices.len() >= 2)
        .map(|(path, indices)| {
            let last_index = *indices.iter().max().expect("checked len >= 2");
            CriterionQualityAdvisory {
                code: "step_expected_file_overlap",
                criterion_preview: compact_preview(&path),
                step_ref: Some(step_display_name(&plan_input.steps[last_index], last_index)),
            }
        })
        .collect()
}

fn normalize_expected_file_path(value: &str) -> String {
    value.trim().to_lowercase().replace('\\', "/")
}

/// `step_criterion_duplicate`: an acceptance criterion — normalized via the
/// existing `normalize_quality_text` plus whitespace collapse, exact match
/// only, no fuzzy scoring (D-011-01: false-positive risk near zero for
/// legitimate multi-touch steps) — shows up in two or more *different*
/// steps. A criterion repeated twice within the *same* step is ordinary step
/// authoring, not cross-step overlap, so it never trips this code.
fn step_criterion_duplicate_advisories(
    plan_input: &PlanDraftInput,
) -> Vec<CriterionQualityAdvisory> {
    let mut steps_by_text: BTreeMap<String, Vec<(usize, String)>> = BTreeMap::new();
    for (index, step) in plan_input.steps.iter().enumerate() {
        let mut seen_in_step = HashSet::new();
        for criterion in &step.acceptance_criteria {
            let Some(text) = criterion_input_text(criterion) else {
                continue;
            };
            let normalized = normalized_criterion_text(&text);
            if normalized.is_empty() || !seen_in_step.insert(normalized.clone()) {
                continue;
            }
            steps_by_text
                .entry(normalized)
                .or_default()
                .push((index, text));
        }
    }

    steps_by_text
        .into_values()
        .filter(|occurrences| occurrences.len() >= 2)
        .map(|mut occurrences| {
            occurrences.sort_by_key(|(index, _)| *index);
            let (last_index, text) = occurrences.pop().expect("checked len >= 2");
            CriterionQualityAdvisory {
                code: "step_criterion_duplicate",
                criterion_preview: compact_preview(&text),
                step_ref: Some(step_display_name(&plan_input.steps[last_index], last_index)),
            }
        })
        .collect()
}

fn normalized_criterion_text(value: &str) -> String {
    normalize_quality_text(value)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn collect_acceptance_criterion_texts(plan_input: &PlanDraftInput) -> Vec<String> {
    plan_input
        .acceptance_criteria
        .iter()
        .chain(
            plan_input
                .steps
                .iter()
                .flat_map(|step| step.acceptance_criteria.iter()),
        )
        .filter_map(criterion_input_text)
        .collect()
}

fn criterion_substantive_len(value: &str) -> usize {
    value.chars().filter(|ch| ch.is_alphanumeric()).count()
}

fn criterion_is_pure_vague_filler(value: &str) -> bool {
    let normalized = normalize_quality_text(value);
    let has_vague_term = contains_any(&normalized, vague_terms(true))
        || contains_any(&normalized, vague_terms(false));
    if !has_vague_term {
        return false;
    }
    !criterion_has_observable_marker(value)
        && normalized
            .split(|ch: char| !ch.is_alphanumeric())
            .filter(|token| {
                !token.is_empty()
                    && !VAGUE_FILLER_WORDS.contains(token)
                    && !vague_terms(true).contains(token)
                    && !vague_terms(false).contains(token)
            })
            .count()
            <= 1
}

fn criterion_has_observable_marker(value: &str) -> bool {
    let normalized = normalize_quality_text(value);
    contains_any(&normalized, COMPARATOR_MARKERS)
        || contains_any(&normalized, NAMED_UI_MARKERS)
        || contains_any(&normalized, STATE_MARKERS)
        || has_meaningful_numeric_marker(&normalized)
}

fn normalize_quality_text(value: &str) -> String {
    value.to_lowercase()
}

fn has_meaningful_numeric_marker(value: &str) -> bool {
    if !value.chars().any(|ch| ch.is_ascii_digit()) {
        return false;
    }
    if value.contains('%') {
        return true;
    }
    let tokens = value
        .split(|ch: char| !ch.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();

    tokens.iter().enumerate().any(|(index, token)| {
        let token = *token;
        if !token.chars().any(|ch| ch.is_ascii_digit()) {
            return false;
        }
        if token.chars().any(|ch| ch.is_ascii_alphabetic()) {
            return true;
        }
        // Korean counters attach directly to the digit with no separator
        // (e.g. "3개"), so the digit and the counter land in the same
        // alphanumeric token — credit it without needing a neighbor lookup.
        if token.chars().any(is_hangul_char) {
            return true;
        }
        let previous = index
            .checked_sub(1)
            .and_then(|previous| tokens.get(previous))
            .copied();
        let next = tokens.get(index + 1).copied();
        previous
            .into_iter()
            .chain(next)
            .any(|context| NUMERIC_CONTEXT_MARKERS.contains(&context))
    })
}

fn is_hangul_char(ch: char) -> bool {
    matches!(ch as u32, 0xAC00..=0xD7AF | 0x1100..=0x11FF | 0x3130..=0x318F)
}

fn text_prefers_english(value: &str) -> bool {
    let hangul = value
        .chars()
        .filter(|ch| matches!(*ch as u32, 0xAC00..=0xD7AF | 0x1100..=0x11FF | 0x3130..=0x318F))
        .count();
    let ascii_alpha = value.chars().filter(|ch| ch.is_ascii_alphabetic()).count();
    ascii_alpha >= hangul
}

fn compact_preview(value: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 96;
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= MAX_PREVIEW_CHARS {
        return compact;
    }
    let mut preview = compact
        .chars()
        .take(MAX_PREVIEW_CHARS.saturating_sub(1))
        .collect::<String>();
    preview.push_str("...");
    preview
}

pub(super) fn validate_step_envelope(step: &StepDraftInput) -> Result<(), String> {
    if step.expected_files.len() > MAX_STEP_EXPECTED_FILES {
        return Err(format!(
            "step '{}' exceeds DIVE execution envelope: at most {MAX_STEP_EXPECTED_FILES} expected files per step",
            step.step_id
        ));
    }
    if step.acceptance_criteria.len() > MAX_STEP_ACCEPTANCE_CRITERIA {
        return Err(format!(
            "step '{}' exceeds DIVE execution envelope: at most {MAX_STEP_ACCEPTANCE_CRITERIA} acceptance criteria per step",
            step.step_id
        ));
    }
    let scope_score = broad_scope_score(step);
    if scope_score >= 2 && step.expected_files.len() >= 4 {
        return Err(format!(
            "step '{}' is too broad for the DIVE execution envelope; split it into smaller file-focused steps",
            step.step_id
        ));
    }
    Ok(())
}

fn broad_scope_score(step: &StepDraftInput) -> usize {
    let acceptance_text = step
        .acceptance_criteria
        .iter()
        .filter_map(criterion_input_text)
        .collect::<Vec<_>>()
        .join("\n");
    let mut text = format!(
        "{}\n{}\n{}\n{}",
        step.title, step.summary, step.instruction_seed, acceptance_text
    )
    .to_ascii_lowercase();
    for item in &step.expected_files {
        text.push('\n');
        text.push_str(&item.to_ascii_lowercase());
    }
    BROAD_SCOPE_MARKERS
        .iter()
        .filter(|marker| text.contains(&marker.to_ascii_lowercase()))
        .count()
}

pub(super) fn step_kind_for_draft(step: &StepDraftInput) -> StepKind {
    step.step_kind
        .unwrap_or_else(|| classify_step_kind_from_draft(step))
}

fn classify_step_kind_from_draft(step: &StepDraftInput) -> StepKind {
    let acceptance_text = step
        .acceptance_criteria
        .iter()
        .filter_map(criterion_input_text)
        .collect::<Vec<_>>()
        .join("\n");
    let mut text = format!(
        "{}\n{}\n{}\n{}",
        step.title, step.summary, step.instruction_seed, acceptance_text
    )
    .to_ascii_lowercase();
    for item in &step.expected_files {
        text.push('\n');
        text.push_str(&item.to_ascii_lowercase());
    }

    if contains_any(
        &text,
        &[
            "rename",
            "renaming",
            "renamed",
            "이름 변경",
            "이름을 변경",
            "명칭 변경",
        ],
    ) {
        StepKind::Rename
    } else if contains_any(
        &text,
        &[
            "refactor",
            "restructure",
            "reorganize",
            "extract",
            "move code",
            "split module",
            "동작 보존",
            "리팩터",
            "리팩토",
            "구조 개선",
        ],
    ) {
        StepKind::Refactor
    } else if contains_any(
        &text,
        &[
            "debug",
            "diagnose",
            "investigate",
            "fix bug",
            "failing",
            "error",
            "디버그",
            "진단",
            "오류",
            "버그",
        ],
    ) {
        StepKind::Debug
    } else if contains_any(
        &text,
        &[
            "comment",
            "documentation",
            "docs",
            "readme",
            "copy update",
            "주석",
            "문서",
            "설명",
        ],
    ) {
        StepKind::Comment
    } else {
        StepKind::Feature
    }
}

/// Whether a verification_command fits DIVE's no-shell, single-command, 60s
/// execution envelope. Used to *sanitize* (drop) rather than reject: a model
/// emitting a shell-y command should not block the whole plan from generating.
fn verification_command_is_envelope_safe(command: &str) -> bool {
    let command = command.trim();
    if command.is_empty() {
        return true;
    }
    const FORBIDDEN_CHARS: &[char] = &['|', '&', ';', '<', '>', '(', ')', '$', '`', '\n', '\r'];
    if command.chars().any(|c| FORBIDDEN_CHARS.contains(&c)) {
        return false;
    }
    if command.split_whitespace().count() > MAX_VERIFICATION_COMMAND_WORDS {
        return false;
    }
    let executable = command
        .split_whitespace()
        .next()
        .unwrap_or("")
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim_end_matches(".exe")
        .to_ascii_lowercase();
    !matches!(
        executable.as_str(),
        "bash" | "sh" | "zsh" | "fish" | "cmd" | "powershell" | "pwsh"
    )
}

/// Normalize a step's verification type/command into DIVE's execution envelope.
/// Preview/manual steps never carry a command. Run/test steps must carry one
/// no-shell command with explicit args; otherwise they downgrade to manual
/// instead of producing an inert or unsafe command. Returns true when the input
/// changed.
pub(super) fn sanitize_step_verification(step: &mut StepDraftInput) -> bool {
    let original_command = step.verification_command.clone();
    let original_type = step.verification_type.clone();
    let command = step
        .verification_command
        .as_deref()
        .map(str::trim)
        .filter(|command| !command.is_empty());
    let requested_type = VerificationType::from_str_opt(step.verification_type.as_deref())
        .unwrap_or_else(|| verification_type_from_legacy(command));

    let (verification_type, verification_command) = match requested_type {
        VerificationType::Preview | VerificationType::Manual => (requested_type, None),
        VerificationType::Run | VerificationType::Test => match command {
            Some(command) if verification_command_is_envelope_safe(command) => {
                (requested_type, Some(command.to_string()))
            }
            _ => (VerificationType::Manual, None),
        },
    };

    step.verification_type = Some(verification_type.as_str().to_string());
    step.verification_command = verification_command;

    original_command != step.verification_command || original_type != step.verification_type
}

#[cfg(test)]
mod criterion_quality_tests {
    use super::*;

    fn step_with_criteria(criteria: &[&str]) -> StepDraftInput {
        StepDraftInput {
            title: "Implement focused behavior".into(),
            summary: "Implement the smallest visible slice.".into(),
            instruction_seed: "Update the relevant UI and state in one focused pass.".into(),
            expected_files: vec!["src/App.tsx".into()],
            acceptance_criteria: criteria
                .iter()
                .map(|criterion| AcceptanceCriterionInput::Text((*criterion).into()))
                .collect(),
            linked_criterion_ids: vec!["AC-001".into()],
            rationale: Some("This step maps directly to the acceptance criteria.".into()),
            step_kind: None,
            verification_command: Some("pnpm test".into()),
            verification_type: Some("run".into()),
            dependencies: Vec::new(),
            parallel_group: None,
            position: 1,
            step_id: "step-001".into(),
        }
    }

    fn plan_with_criteria(goal: &str, criteria: &[&str]) -> PlanDraftInput {
        PlanDraftInput {
            goal: goal.into(),
            intent_summary: "Deliver a focused, checkable slice.".into(),
            scope: vec!["Focused slice".into()],
            non_goals: vec!["No extra features".into()],
            constraints: vec!["Keep existing architecture".into()],
            acceptance_criteria: criteria
                .iter()
                .map(|criterion| AcceptanceCriterionInput::Text((*criterion).into()))
                .collect(),
            steps: vec![step_with_criteria(criteria)],
        }
    }

    /// Builds a plan from caller-supplied steps with no duplicate global-level
    /// criteria, so per-step / advisory counts in a test aren't doubled by
    /// `plan_with_criteria`'s global+step duplication.
    fn plan_with_steps(goal: &str, steps: Vec<StepDraftInput>) -> PlanDraftInput {
        PlanDraftInput {
            goal: goal.into(),
            intent_summary: "Deliver a focused, checkable slice.".into(),
            scope: vec!["Focused slice".into()],
            non_goals: vec!["No extra features".into()],
            constraints: vec!["Keep existing architecture".into()],
            acceptance_criteria: Vec::new(),
            steps,
        }
    }

    fn named_step_with_criteria(title: &str, step_id: &str, criteria: &[&str]) -> StepDraftInput {
        let mut step = step_with_criteria(criteria);
        step.title = title.into();
        step.step_id = step_id.into();
        step
    }

    #[test]
    fn upload_goal_does_not_match_load_inside_word() {
        let plan = plan_with_criteria(
            "Build upload widget",
            &["Clicking Upload adds the selected file to the list and shows its name."],
        );

        assert!(validate_criterion_quality("Build upload widget", &plan).is_ok());
    }

    #[test]
    fn ascii_keyword_matching_requires_whole_words() {
        let rapid_plan = plan_with_criteria(
            "rapid prototype dashboard",
            &["Prototype dashboard list shows the selected card title."],
        );

        assert!(validate_criterion_quality("rapid prototype dashboard", &rapid_plan).is_ok());
        assert!(!contains_any("build upload widget", data_fetch_keywords()));
        assert!(!contains_any(
            "rapid prototype dashboard",
            data_fetch_keywords()
        ));
        assert!(!contains_any("overall layout polish", COMPARATOR_MARKERS));
    }

    #[test]
    fn short_hangul_markers_require_standalone_tokens() {
        let text = "발표 내용을 나열하고 빈칸을 정리한다";

        assert!(!criterion_has_observable_marker(text));
        assert!(!contains_any(text, NAMED_UI_MARKERS));
        assert!(!contains_any(text, RESPONSIVE_MARKERS));
        assert!(!contains_any(text, EMPTY_STATE_MARKERS));
    }

    #[test]
    fn terse_algorithmic_criteria_have_observable_markers() {
        let sort_plan = plan_with_criteria("Implement number sorting", &["Sorts numerically"]);
        let validate_plan = plan_with_criteria(
            "Implement input validation",
            &["Returns true for valid input"],
        );

        assert!(criterion_has_observable_marker("Sorts numerically"));
        assert!(criterion_has_observable_marker(
            "Returns true for valid input"
        ));
        assert!(validate_criterion_quality("Implement number sorting", &sort_plan).is_ok());
        assert!(validate_criterion_quality("Implement input validation", &validate_plan).is_ok());
    }

    #[test]
    fn vague_criterion_with_stray_digit_is_blocked() {
        let plan = plan_with_criteria("Build a small calculator", &["make it nice in 2 ways"]);

        let err = validate_criterion_quality("Build a small calculator", &plan).unwrap_err();

        assert_eq!(err.reason, CriterionQualityErrorReason::VagueCriteria);
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item.contains("make it nice in 2 ways")));
    }

    // S-050 D2: `ui_goal_keywords` narrowed to explicit responsive/mobile
    // signals, so this now requires the goal to say "responsive" rather than
    // just being page-ish. Persistence/accessibility are covered here too,
    // so the only blocking item is the missing Responsive class.
    #[test]
    fn responsive_goal_missing_responsive_criteria_is_blocked() {
        let plan = plan_with_criteria(
            "Build a responsive settings page",
            &[
                "The saved theme choice survives reload and remains visible after refresh.",
                "Keyboard focus reaches the Save button and ARIA label describes the action.",
            ],
        );

        let err =
            validate_criterion_quality("Build a responsive settings page", &plan).unwrap_err();

        assert_eq!(
            err.reason,
            CriterionQualityErrorReason::MissingStateCriteria
        );
        assert_eq!(
            err.unresolved_questions,
            vec!["responsive behavior".to_string()]
        );
    }

    // S-050 D2: a generic UI noun (버튼/화면/페이지) is no longer a signal at
    // all — no responsive/persistence/accessibility check, blocking or
    // advisory, is performed.
    #[test]
    fn generic_ui_nouns_no_longer_trigger_responsive_requirement() {
        let plan = plan_with_criteria(
            "화면에 버튼이 있는 할 일 페이지",
            &["버튼을 클릭하면 할 일이 목록에 추가된다"],
        );

        assert!(validate_criterion_quality("화면에 버튼이 있는 할 일 페이지", &plan).is_ok());
    }

    // S-050 D1/D2: persistence/accessibility no longer block a responsive-
    // signaled goal — they surface as `missing_state_class_advisory` items on
    // the accepted report instead.
    #[test]
    fn responsive_goal_missing_persistence_and_accessibility_yields_advisories_not_block() {
        let plan = plan_with_criteria(
            "responsive 모바일 dashboard",
            &["The 3-column grid collapses to 1 column at 390px width."],
        );

        let report = validate_criterion_quality("responsive 모바일 dashboard", &plan)
            .expect("responsive class is covered, so persistence/accessibility must not block");

        assert_eq!(report.advisories.len(), 2);
        assert!(report
            .advisories
            .iter()
            .all(|advisory| advisory.code == "missing_state_class_advisory"));
        assert!(report
            .advisories
            .iter()
            .any(|advisory| advisory.criterion_preview == "persistence"));
        assert!(report
            .advisories
            .iter()
            .any(|advisory| advisory.criterion_preview == "accessibility"));
    }

    #[test]
    fn fetch_goal_missing_empty_and_error_states_is_blocked() {
        let plan = plan_with_criteria(
            "Fetch account balances from an API",
            &["Loading spinner appears while the API request is pending."],
        );

        let err =
            validate_criterion_quality("Fetch account balances from an API", &plan).unwrap_err();

        assert_eq!(
            err.reason,
            CriterionQualityErrorReason::MissingStateCriteria
        );
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item == "empty state"));
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item == "error state"));
        assert!(!err
            .unresolved_questions
            .iter()
            .any(|item| item == "loading state"));
    }

    #[test]
    fn vague_criterion_is_blocked() {
        let plan = plan_with_criteria("Build a small calculator", &["make it nice"]);

        let err = validate_criterion_quality("Build a small calculator", &plan).unwrap_err();

        assert_eq!(err.reason, CriterionQualityErrorReason::VagueCriteria);
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item.contains("make it nice")));
    }

    #[test]
    fn quick_intake_vague_criteria_routes_back_through_same_gate() {
        let plan = plan_with_criteria("make it nice", &["looks good", "works well"]);

        let err = validate_criterion_quality("make it nice", &plan).unwrap_err();

        assert_eq!(err.reason, CriterionQualityErrorReason::VagueCriteria);
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item.contains("looks good")));
    }

    #[test]
    fn quick_intake_concrete_static_ui_criteria_pass_same_gate() {
        let plan = plan_with_criteria(
            "A responsive bakery menu page shows categories, item names, and prices",
            &[
                "At 390px width, every menu category, item name, and price remains readable.",
                "Refreshing the page keeps all menu content visible, and keyboard focus reaches navigation links with ARIA labels.",
            ],
        );

        assert!(validate_criterion_quality(
            "A responsive bakery menu page shows categories, item names, and prices",
            &plan,
        )
        .is_ok());
    }

    #[test]
    fn concrete_single_criterion_passes_without_domain_coverage() {
        let balance_plan = plan_with_criteria(
            "Calculate wallet balance",
            &["Balance shows 70 after +100 then -30."],
        );
        let layout_plan = plan_with_criteria(
            "Organize dashboard cards",
            &["3 columns desktop, 1 column phone, survives reload."],
        );

        assert!(validate_criterion_quality("Calculate wallet balance", &balance_plan).is_ok());
        assert!(validate_criterion_quality("Organize dashboard cards", &layout_plan).is_ok());
    }

    #[test]
    fn full_concrete_ui_and_data_prd_passes() {
        let plan = plan_with_criteria(
            "Build a responsive page that fetches API data",
            &[
                "At 1024px desktop the results grid shows 3 columns, and at 390px phone it shows 1 column.",
                "Saved filter selection survives reload and remains visible after refresh.",
                "Keyboard focus reaches the Search button and ARIA label announces loading status.",
                "Loading spinner appears while the API request is pending.",
                "Empty state displays 'No results' when the API returns zero items.",
                "Error state shows a retry button when the network request fails.",
            ],
        );

        assert!(
            validate_criterion_quality("Build a responsive page that fetches API data", &plan)
                .is_ok()
        );
    }

    // S-050 acceptance mapping #1: the exact QA journey that failed to
    // converge (static-checklist PRD, 클릭/취소선/개수 style criteria) now
    // passes the re-tuned gate.
    #[test]
    fn qa_repro_korean_static_checklist_plan_passes() {
        let plan = plan_with_criteria(
            "정적 체크리스트 앱",
            &[
                "완료한 항목을 클릭하면 취소선이 표시된다",
                "할 일 3개를 추가하면 목록에 3개 항목이 보인다",
            ],
        );

        let report = validate_criterion_quality("정적 체크리스트 앱", &plan)
            .expect("static checklist criteria should pass the re-tuned gate");
        let _ = report.advisories; // may be non-empty; the gate no longer vetoes on it
    }

    // S-050 D3: a Korean counter attaches directly to its digit with no
    // separator ("3개"), so the digit+Hangul token itself must earn credit.
    #[test]
    fn korean_digit_counter_earns_numeric_credit() {
        assert!(criterion_has_observable_marker(
            "할 일 3개를 추가하면 목록에 나타난다"
        ));
    }

    #[test]
    fn empty_criteria_set_still_blocks() {
        let plan = plan_with_criteria("Build a small utility", &[]);

        let err = validate_criterion_quality("Build a small utility", &plan).unwrap_err();

        assert_eq!(err.reason, CriterionQualityErrorReason::VagueCriteria);
    }

    #[test]
    fn all_junk_criterion_still_blocks() {
        let plan = plan_with_criteria("작은 계산기 만들기", &["적당히 잘"]);

        let err = validate_criterion_quality("작은 계산기 만들기", &plan).unwrap_err();

        assert_eq!(err.reason, CriterionQualityErrorReason::VagueCriteria);
    }

    // S-050 D1(c): a plan where no criterion anywhere carries an observable
    // marker is still unverifiable and must still block.
    #[test]
    fn plan_with_no_marker_anywhere_blocks() {
        let plan = plan_with_criteria(
            "Build a small utility",
            &["The utility follows the existing project code style."],
        );

        let err = validate_criterion_quality("Build a small utility", &plan).unwrap_err();

        assert_eq!(err.reason, CriterionQualityErrorReason::VagueCriteria);
    }

    // S-050 D1(d): one step with zero marker-bearing criteria blocks even
    // though a sibling step is fine — and the message names that step.
    #[test]
    fn step_missing_marker_blocks_naming_that_step() {
        let good_step = named_step_with_criteria(
            "Add item to list",
            "step-001",
            &["Clicking Add appends a new item to the list."],
        );
        let mut unverifiable_step = named_step_with_criteria(
            "Polish the styling",
            "step-002",
            &["The styling follows the existing project conventions."],
        );
        unverifiable_step.position = 2;

        let plan = plan_with_steps("Build a small utility", vec![good_step, unverifiable_step]);

        let err = validate_criterion_quality("Build a small utility", &plan).unwrap_err();

        assert_eq!(err.reason, CriterionQualityErrorReason::VagueCriteria);
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item.contains("Polish the styling")));
    }

    // S-050 D2/D3: a clearly-signaled Korean data-fetch goal missing
    // loading/empty/error still blocks (narrowed keywords still catch it).
    #[test]
    fn korean_data_fetch_goal_missing_states_blocks() {
        let plan = plan_with_criteria(
            "api에서 데이터를 불러온다",
            &["불러온 데이터 3개를 표시한다"],
        );

        let err = validate_criterion_quality("api에서 데이터를 불러온다", &plan).unwrap_err();

        assert_eq!(
            err.reason,
            CriterionQualityErrorReason::MissingStateCriteria
        );
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item == "로딩 상태"));
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item == "빈 상태"));
        assert!(err
            .unresolved_questions
            .iter()
            .any(|item| item == "오류 상태"));
    }

    // S-050 acceptance mapping / D1: a non-junk marker-less criterion no
    // longer blocks by itself when the plan and its step are each otherwise
    // verifiable — it is collected as a single advisory instead.
    #[test]
    fn advisory_collection_returns_single_marker_less_advisory() {
        let step = named_step_with_criteria(
            "Print confirmations",
            "step-001",
            &[
                "Clicking the button prints 5 confirmations to the console.",
                "The utility follows the existing project code style.",
            ],
        );
        let plan = plan_with_steps("Build a small utility", vec![step]);

        let report = validate_criterion_quality("Build a small utility", &plan)
            .expect("one marker-less non-junk criterion should not block");

        assert_eq!(report.advisories.len(), 1);
        assert_eq!(report.advisories[0].code, "criterion_no_marker");
        assert_eq!(
            report.advisories[0].step_ref.as_deref(),
            Some("Print confirmations")
        );
        assert!(report.advisories[0]
            .criterion_preview
            .contains("follows the existing project code style"));
    }

    /// S-050 D4 acceptance mapping item 2: the recovery-screen copy editors
    /// touch is `dive/src/i18n/{ko,en}.json`, not this file — but every string
    /// under `planning.interview.recovery.examples.*` is a promise that it
    /// self-passes the same validator it is meant to unblock a student from.
    /// This test reads both locale files at their real repo path and enforces
    /// that promise so a future copy edit can't silently break it.
    #[test]
    fn recovery_examples_locales_self_pass_the_validator() {
        for locale_file in ["ko.json", "en.json"] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../src/i18n")
                .join(locale_file);
            let raw = std::fs::read_to_string(&path)
                .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()));
            let json: serde_json::Value = serde_json::from_str(&raw)
                .unwrap_or_else(|err| panic!("failed to parse {}: {err}", path.display()));
            let examples = json
                .pointer("/planning/interview/recovery/examples")
                .and_then(|value| value.as_object())
                .unwrap_or_else(|| {
                    panic!(
                        "{locale_file} is missing planning.interview.recovery.examples \
                         (the self-passing recovery example lock)"
                    )
                });
            assert!(
                examples.len() >= 8,
                "{locale_file} planning.interview.recovery.examples must keep at least 8 \
                 entries (found {}); this set is the self-pass regression lock",
                examples.len()
            );

            let mut marker_examples: Vec<String> = Vec::new();
            for (key, value) in examples {
                let text = value
                    .as_str()
                    .unwrap_or_else(|| panic!("{locale_file} examples.{key} must be a string"));
                assert!(
                    !text.trim().is_empty(),
                    "{locale_file} examples.{key} must not be empty"
                );
                assert!(
                    criterion_has_observable_marker(text),
                    "{locale_file} examples.{key} = \"{text}\" must self-pass \
                     criterion_has_observable_marker"
                );

                if let Some(class_name) = key.strip_prefix("class_") {
                    let class = match class_name {
                        "responsive" => MissingCriterionClass::Responsive,
                        "persistence" => MissingCriterionClass::Persistence,
                        "accessibility" => MissingCriterionClass::Accessibility,
                        "loading" => MissingCriterionClass::Loading,
                        "empty" => MissingCriterionClass::Empty,
                        "error" => MissingCriterionClass::Error,
                        other => panic!(
                            "{locale_file} examples.{key} has unrecognized class name \"{other}\""
                        ),
                    };
                    assert!(
                        criterion_class_is_covered(&text.to_lowercase(), class),
                        "{locale_file} examples.{key} = \"{text}\" must satisfy \
                         criterion_class_is_covered for {class:?}"
                    );
                }

                if key == "marker_click" || key == "marker_count" {
                    marker_examples.push(text.to_string());
                }
            }

            assert_eq!(
                marker_examples.len(),
                2,
                "{locale_file} must define both examples.marker_click and examples.marker_count"
            );
            let plan = plan_with_criteria(
                "Beginner todo list app",
                &[marker_examples[0].as_str(), marker_examples[1].as_str()],
            );
            assert!(
                validate_criterion_quality("Beginner todo list app", &plan).is_ok(),
                "{locale_file} marker examples assembled into a minimal one-step plan must \
                 pass validate_criterion_quality"
            );
        }
    }

    /// 011 live-QA regression lock (tier1-run-log 2026-07-11 저니 B): models
    /// can echo PRD criterion IDs into `acceptance_criteria`; the resolver
    /// must turn exact ACTIVE-ID references into the full PRD criterion
    /// before the gate sees them, and leave everything else literal.
    mod prd_criterion_id_reference_tests {
        use super::*;
        use crate::db::models::{ProjectSpec, ProjectSpecStatus};
        use std::collections::BTreeMap;

        fn prd_with_criteria() -> ProjectSpec {
            let criterion = |id: &str, text: &str, active: bool| AcceptanceCriterion {
                criterion_id: id.into(),
                text: text.into(),
                source: AcceptanceCriterionSource::Interview,
                status: if active {
                    AcceptanceCriterionStatus::Active
                } else {
                    AcceptanceCriterionStatus::Retired
                },
                created_in_version: 1,
                retired_in_version: if active { None } else { Some(2) },
            };
            ProjectSpec {
                project_spec_id: "prd-test".into(),
                project_id: 1,
                current_version: 2,
                goal: "정적 체크리스트 앱".into(),
                intent_summary: Some("체크리스트를 만든다".into()),
                scope: vec!["할 일 목록".into()],
                non_goals: vec!["서버 저장".into()],
                constraints: vec!["정적 페이지".into()],
                acceptance_criteria: vec![
                    criterion(
                        "AC-001",
                        "완료한 항목을 클릭하면 취소선이 표시되고 다시 클릭하면 해제된다.",
                        true,
                    ),
                    criterion(
                        "AC-002",
                        "할 일 3개를 추가하면 목록에 3개 항목이 보인다.",
                        true,
                    ),
                    criterion("AC-003", "은퇴한 기준은 해석되지 않는다.", false),
                ],
                architecture: None,
                field_provenance: BTreeMap::new(),
                status: ProjectSpecStatus::Approved,
                created_at: 1,
                updated_at: 1,
            }
        }

        // The exact live failure: step acceptance_criteria carrying bare IDs
        // blocked the plan as criterion_too_short "AC-001". After resolution
        // the gate must validate the real criterion text and pass.
        #[test]
        fn active_id_references_resolve_and_pass_the_gate() {
            let prd = prd_with_criteria();
            let mut plan = plan_with_steps(
                "정적 체크리스트 앱",
                vec![named_step_with_criteria(
                    "체크리스트 구현",
                    "step-001",
                    &["AC-001", "AC-002"],
                )],
            );

            resolve_prd_criterion_id_references(&mut plan, &prd);

            let resolved: Vec<String> = plan.steps[0]
                .acceptance_criteria
                .iter()
                .filter_map(criterion_input_text)
                .collect();
            assert!(resolved[0].contains("취소선"));
            assert!(resolved[1].contains("3개 항목"));
            assert!(matches!(
                plan.steps[0].acceptance_criteria[0],
                AcceptanceCriterionInput::Object(ref c) if c.criterion_id == "AC-001"
            ));
            validate_criterion_quality("정적 체크리스트 앱", &plan)
                .expect("resolved ID references must pass the re-tuned gate");
        }

        #[test]
        fn unknown_and_retired_ids_stay_literal_and_block_honestly() {
            let prd = prd_with_criteria();
            let mut plan = plan_with_steps(
                "정적 체크리스트 앱",
                vec![named_step_with_criteria(
                    "체크리스트 구현",
                    "step-001",
                    &["AC-099", "AC-003"],
                )],
            );

            resolve_prd_criterion_id_references(&mut plan, &prd);

            for criterion in &plan.steps[0].acceptance_criteria {
                assert!(matches!(criterion, AcceptanceCriterionInput::Text(_)));
            }
            let err = validate_criterion_quality("정적 체크리스트 앱", &plan)
                .expect_err("unresolvable ID-only criteria must still block");
            assert_eq!(err.reason, CriterionQualityErrorReason::VagueCriteria);
        }

        #[test]
        fn full_text_and_object_inputs_are_untouched() {
            let prd = prd_with_criteria();
            let mut plan = plan_with_steps(
                "정적 체크리스트 앱",
                vec![named_step_with_criteria(
                    "체크리스트 구현",
                    "step-001",
                    &["완료한 항목을 클릭하면 취소선이 표시된다"],
                )],
            );
            let before = plan.steps[0].acceptance_criteria.clone();

            resolve_prd_criterion_id_references(&mut plan, &prd);

            assert_eq!(plan.steps[0].acceptance_criteria, before);
        }
    }

    /// S-056 D2 self-pass lock: the two cross-step advisories must never
    /// fire on legitimate multi-touch plans and must fire exactly once,
    /// naming the later step, on genuine overlap.
    mod step_overlap_advisory_tests {
        use super::*;

        // (a) The S-050 QA-repro plan shape (single step, two distinct
        // Korean criteria) must stay overlap-clean.
        #[test]
        fn qa_repro_plan_produces_zero_overlap_advisories() {
            let plan = plan_with_criteria(
                "정적 체크리스트 앱",
                &[
                    "완료한 항목을 클릭하면 취소선이 표시된다",
                    "할 일 3개를 추가하면 목록에 3개 항목이 보인다",
                ],
            );

            assert!(step_overlap_advisories(&plan).is_empty());

            let report = validate_criterion_quality("정적 체크리스트 앱", &plan)
                .expect("qa-repro fixture must still pass the gate");
            assert!(!report.advisories.iter().any(|advisory| {
                advisory.code == "step_expected_file_overlap"
                    || advisory.code == "step_criterion_duplicate"
            }));
        }

        // (b) The recovery-example strings are deliberately distinct texts;
        // assembling one per step must not trip step_criterion_duplicate,
        // which would mean normalization is over-matching.
        #[test]
        fn recovery_example_locale_criteria_produce_zero_duplicate_advisories() {
            for locale_file in ["ko.json", "en.json"] {
                let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../src/i18n")
                    .join(locale_file);
                let raw = std::fs::read_to_string(&path)
                    .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()));
                let json: serde_json::Value = serde_json::from_str(&raw)
                    .unwrap_or_else(|err| panic!("failed to parse {}: {err}", path.display()));
                let examples = json
                    .pointer("/planning/interview/recovery/examples")
                    .and_then(|value| value.as_object())
                    .unwrap_or_else(|| {
                        panic!(
                            "{locale_file} is missing planning.interview.recovery.examples \
                             (the self-passing recovery example lock)"
                        )
                    });

                let steps: Vec<StepDraftInput> = examples
                    .iter()
                    .enumerate()
                    .map(|(index, (key, value))| {
                        let text = value.as_str().unwrap_or_else(|| {
                            panic!("{locale_file} examples.{key} must be a string")
                        });
                        named_step_with_criteria(key.as_str(), &format!("step-{index:03}"), &[text])
                    })
                    .collect();
                let plan = plan_with_steps("Assemble recovery examples", steps);

                assert!(
                    step_criterion_duplicate_advisories(&plan).is_empty(),
                    "{locale_file} recovery examples are meant to be textually distinct; \
                     assembling them one per step must not trip step_criterion_duplicate"
                );
            }
        }

        // (c) The same expected_files path, differing only in case/whitespace,
        // claimed by two steps yields exactly one advisory naming the later step.
        #[test]
        fn duplicated_expected_file_across_steps_emits_one_overlap_advisory() {
            let mut step_a = named_step_with_criteria(
                "Create schema",
                "step-001",
                &["Clicking Save adds a new record to the list."],
            );
            step_a.expected_files = vec!["src/schema.ts".into()];

            let mut step_b = named_step_with_criteria(
                "Wire API",
                "step-002",
                &["Refreshing the page keeps the list visible."],
            );
            step_b.position = 2;
            step_b.expected_files = vec!["  SRC/Schema.ts  ".into()];

            let plan = plan_with_steps("Build a small utility", vec![step_a, step_b]);

            let advisories = step_expected_file_overlap_advisories(&plan);
            assert_eq!(advisories.len(), 1);
            assert_eq!(advisories[0].code, "step_expected_file_overlap");
            assert_eq!(advisories[0].step_ref.as_deref(), Some("Wire API"));
            assert_eq!(advisories[0].criterion_preview, "src/schema.ts");

            let report = validate_criterion_quality("Build a small utility", &plan)
                .expect("expected_files overlap must never block plan validation");
            assert!(report.advisories.iter().any(|advisory| {
                advisory.code == "step_expected_file_overlap"
                    && advisory.step_ref.as_deref() == Some("Wire API")
            }));
        }

        // (d) The same acceptance criterion text in two different steps
        // yields exactly one advisory naming the later step.
        #[test]
        fn duplicated_criterion_across_steps_emits_one_duplicate_advisory() {
            let mut step_a = named_step_with_criteria(
                "Create schema",
                "step-001",
                &["Clicking Save adds a new record to the list."],
            );
            step_a.expected_files = vec!["src/schema.ts".into()];

            let mut step_b = named_step_with_criteria(
                "Export artifacts",
                "step-002",
                &["Clicking Save adds a new record to the list."],
            );
            step_b.position = 2;
            step_b.expected_files = vec!["src/export.ts".into()];

            let plan = plan_with_steps("Build a small utility", vec![step_a, step_b]);

            let advisories = step_criterion_duplicate_advisories(&plan);
            assert_eq!(advisories.len(), 1);
            assert_eq!(advisories[0].code, "step_criterion_duplicate");
            assert_eq!(advisories[0].step_ref.as_deref(), Some("Export artifacts"));
            assert_eq!(
                advisories[0].criterion_preview,
                "Clicking Save adds a new record to the list."
            );
            assert!(step_expected_file_overlap_advisories(&plan).is_empty());

            let report = validate_criterion_quality("Build a small utility", &plan)
                .expect("duplicated criteria must never block plan validation");
            assert!(report.advisories.iter().any(|advisory| {
                advisory.code == "step_criterion_duplicate"
                    && advisory.step_ref.as_deref() == Some("Export artifacts")
            }));
        }

        // (e) A criterion repeated twice within the SAME step is ordinary
        // step authoring, not cross-step overlap — must not fire the code.
        #[test]
        fn duplicated_criterion_within_one_step_does_not_emit_cross_step_code() {
            let step = named_step_with_criteria(
                "Create schema",
                "step-001",
                &[
                    "Clicking Save writes 3 records to the schema file.",
                    "Clicking Save writes 3 records to the schema file.",
                ],
            );

            let plan = plan_with_steps("Build a small utility", vec![step]);

            assert!(step_criterion_duplicate_advisories(&plan).is_empty());
        }

        // (f) A plan overlapping on both files and criteria at once must
        // still validate Ok — overlap is advisory-only, per D-011-01.
        #[test]
        fn overlapping_files_and_criteria_never_block_plan_validation() {
            let mut step_a = named_step_with_criteria(
                "Create schema",
                "step-001",
                &["Clicking Save adds a new record to the list."],
            );
            step_a.expected_files = vec!["src/schema.ts".into()];

            let mut step_b = named_step_with_criteria(
                "Export artifacts",
                "step-002",
                &["Clicking Save adds a new record to the list."],
            );
            step_b.position = 2;
            step_b.expected_files = vec!["src/schema.ts".into()];

            let plan = plan_with_steps("Build a small utility", vec![step_a, step_b]);

            let report = validate_criterion_quality("Build a small utility", &plan)
                .expect("overlapping files and duplicated criteria must never turn Ok into Err");
            assert!(report
                .advisories
                .iter()
                .any(|advisory| advisory.code == "step_expected_file_overlap"));
            assert!(report
                .advisories
                .iter()
                .any(|advisory| advisory.code == "step_criterion_duplicate"));
        }
    }
}

#[cfg(test)]
mod envelope_tests {
    use super::*;

    fn focused_step() -> StepDraftInput {
        StepDraftInput {
            title: "Add quiz question state".into(),
            summary: "Store current question and selected answer.".into(),
            instruction_seed: "Implement the current-question state in src/App.tsx only.".into(),
            expected_files: vec!["src/App.tsx".into()],
            acceptance_criteria: vec![AcceptanceCriterionInput::Text(
                "Selecting an answer updates visible state.".into(),
            )],
            linked_criterion_ids: vec!["AC-001".into()],
            rationale: Some("This step isolates the visible state required by AC-001.".into()),
            step_kind: None,
            verification_command: Some("pnpm test".into()),
            verification_type: Some("run".into()),
            dependencies: Vec::new(),
            parallel_group: None,
            position: 1,
            step_id: "step-001".into(),
        }
    }

    #[test]
    fn envelope_allows_small_file_focused_step() {
        assert!(validate_step_envelope(&focused_step()).is_ok());
    }

    #[test]
    fn envelope_rejects_broad_desktop_crud_calendar_step() {
        let mut step = focused_step();
        step.step_id = "step-broad".into();
        step.title = "일정 관리 데스크톱 앱 완성".into();
        step.summary = "CRUD, 알림, 캘린더, 데이터베이스를 한 번에 구현한다.".into();
        step.instruction_seed =
            "Build the full desktop app with calendar CRUD, notification reminders, and database persistence."
                .into();
        step.expected_files = vec![
            "src/App.tsx".into(),
            "src/calendar.ts".into(),
            "src/database.ts".into(),
            "src/notifications.ts".into(),
        ];

        let err = validate_step_envelope(&step).unwrap_err();
        assert!(err.contains("too broad"));
    }

    #[test]
    fn envelope_accepts_step_with_shell_verification_command() {
        // A shell-y verification_command must no longer reject the whole step;
        // it is sanitized away at persist time (see sanitize tests below).
        let mut step = focused_step();
        step.verification_command = Some("bash -lc 'pnpm test'".into());
        assert!(validate_step_envelope(&step).is_ok());
    }

    #[test]
    fn sanitize_drops_shell_verification_and_downgrades_run_to_manual() {
        let mut step = focused_step();
        step.verification_command = Some("bash -lc 'pnpm test'".into());
        step.verification_type = Some("run".into());
        assert!(sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command, None);
        assert_eq!(step.verification_type.as_deref(), Some("manual"));
    }

    #[test]
    fn sanitize_drops_piped_test_command_and_downgrades_to_manual() {
        let mut step = focused_step();
        step.verification_command = Some("cat foo | grep bar".into());
        step.verification_type = Some("test".into());
        assert!(sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command, None);
        assert_eq!(step.verification_type.as_deref(), Some("manual"));
    }

    #[test]
    fn sanitize_keeps_envelope_safe_run_command() {
        let mut step = focused_step();
        step.verification_command = Some("npm run build".into());
        step.verification_type = Some("run".into());
        assert!(!sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command.as_deref(), Some("npm run build"));
        assert_eq!(step.verification_type.as_deref(), Some("run"));
    }

    #[test]
    fn sanitize_keeps_envelope_safe_test_command() {
        let mut step = focused_step();
        step.verification_command = Some("pnpm test".into());
        step.verification_type = Some("test".into());
        assert!(!sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command.as_deref(), Some("pnpm test"));
        assert_eq!(step.verification_type.as_deref(), Some("test"));
    }

    #[test]
    fn sanitize_preview_step_drops_any_command() {
        let mut step = focused_step();
        step.verification_type = Some("preview".into());
        step.verification_command = Some("open index.html".into());
        assert!(sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command, None);
        assert_eq!(step.verification_type.as_deref(), Some("preview"));
    }

    #[test]
    fn sanitize_manual_step_never_emits_empty_string_command() {
        let mut step = focused_step();
        step.verification_type = Some("manual".into());
        step.verification_command = Some("   ".into());
        assert!(sanitize_step_verification(&mut step));
        assert_eq!(step.verification_command, None);
        assert_eq!(step.verification_type.as_deref(), Some("manual"));
    }

    #[test]
    fn sanitize_run_or_test_without_command_downgrades_to_manual() {
        for verification_type in ["run", "test"] {
            let mut step = focused_step();
            step.verification_type = Some(verification_type.into());
            step.verification_command = None;
            assert!(sanitize_step_verification(&mut step));
            assert_eq!(step.verification_command, None);
            assert_eq!(step.verification_type.as_deref(), Some("manual"));
        }
    }

    #[test]
    fn sanitize_legacy_command_type_migrates_to_run_or_test() {
        let mut build_step = focused_step();
        build_step.verification_type = Some("command".into());
        build_step.verification_command = Some("npm run build".into());
        assert!(sanitize_step_verification(&mut build_step));
        assert_eq!(
            build_step.verification_command.as_deref(),
            Some("npm run build")
        );
        assert_eq!(build_step.verification_type.as_deref(), Some("run"));

        let mut test_step = focused_step();
        test_step.verification_type = Some("command".into());
        test_step.verification_command = Some("pnpm test".into());
        assert!(sanitize_step_verification(&mut test_step));
        assert_eq!(test_step.verification_command.as_deref(), Some("pnpm test"));
        assert_eq!(test_step.verification_type.as_deref(), Some("test"));
    }
}
