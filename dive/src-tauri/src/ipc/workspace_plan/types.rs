//! Shared workspace-plan DTOs (IPC input/output payloads).
//!
//! Moved verbatim from the former `workspace_plan.rs` monolith (Wily S-066).

use serde::{Deserialize, Serialize};

use crate::db::models::{
    AcceptanceCriterion, LiveProjectSpecDraftRow, ObjectionSuggestionStatus, PrdPatch, ProjectSpec,
    ProjectSpecDelta, ProjectSpecDraft, StepKind,
};
use crate::dive::event_log as dive_event_log;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspacePlanStatus {
    pub status: String,
    pub has_plan: bool,
    pub has_approved_plan: bool,
    pub plan_summary: Option<String>,
    pub plan_id: Option<i64>,
    pub step_count: i64,
    pub ready_count: i64,
    pub blocked_count: i64,
    pub active_count: i64,
    pub done_count: i64,
    pub prd_status: WorkspacePrdStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePrdStatus {
    pub status: String,
    pub project_spec_id: Option<String>,
    pub current_version: Option<i64>,
    pub draft_id: Option<String>,
    pub base_version: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdInterviewTurnInput {
    pub project_id: i64,
    pub draft_id: String,
    pub answer: String,
    #[serde(default)]
    pub conversation: Vec<PrdInterviewConversationTurnInput>,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdInterviewConversationTurnInput {
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrdInterviewTurnOutput {
    pub turn_id: String,
    pub assistant_message: String,
    pub patch: Option<PrdPatch>,
    pub validation_outcome: String,
    pub applied_field_paths: Vec<String>,
    pub rejected_reasons: Vec<String>,
    pub live_draft: LiveProjectSpecDraftRow,
    // S-047 (010 theme 7): the AI's architecture recommendation for the current
    // two-stage focus (form, then stack), surfaced to the board as selectable
    // option cards. This is NOT an applied patch — the architecture is authored
    // only by the student's click (recommend-then-confirm), preserving agency.
    // `None` when the interview is not on an architecture focus or the AI made no
    // usable proposal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture_proposals: Option<ArchitectureProposals>,
}

/// A single AI-recommended architecture option (one form or one stack) with a
/// one-line beginner rationale. Rendered as a selectable card in the board.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectureProposalOption {
    /// For `kind == "form"`, a valid `ArchitectureForm` value (e.g. `web_app`).
    /// For `kind == "stack"`, free-text stack wording (e.g. `React + Vite`).
    pub value: String,
    pub rationale: String,
}

/// The AI's ≤2 architecture recommendations for the current two-stage focus.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectureProposals {
    /// `"form"` or `"stack"` — the two-stage focus these options answer.
    pub kind: String,
    pub options: Vec<ArchitectureProposalOption>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdDraftSaveInput {
    pub project_id: i64,
    pub draft: LiveProjectSpecDraftRow,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdSaveInput {
    pub project_id: i64,
    pub spec: ProjectSpecDraft,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspacePlanDashboardStep {
    pub step_db_id: i64,
    pub stable_step_id: String,
    pub title: String,
    pub position: i64,
    pub status: String,
    pub session_id: Option<i64>,
    pub card_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PlanActivityLogRow {
    pub id: i64,
    pub plan_id: i64,
    pub event_type: String,
    pub message: String,
    pub step_id: Option<i64>,
    pub stable_step_id: Option<String>,
    pub step_title: Option<String>,
    pub reason: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WorkspacePlanDashboardProject {
    pub project_id: i64,
    pub project_name: String,
    pub project_path: String,
    pub project_updated_at: i64,
    pub plan_id: Option<i64>,
    pub plan_goal: Option<String>,
    pub plan_status: Option<String>,
    pub step_count: i64,
    pub ready_count: i64,
    pub blocked_count: i64,
    pub active_count: i64,
    pub done_count: i64,
    pub shipped_count: i64,
    pub next_ready_steps: Vec<WorkspacePlanDashboardStep>,
    pub active_steps: Vec<WorkspacePlanDashboardStep>,
    pub last_activity: Option<PlanActivityLogRow>,
    pub project_spec: Option<ProjectSpec>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepStateUpdateInput {
    pub step_id: i64,
    pub status: String,
    pub evidence: Option<String>,
    pub verification_status: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum AcceptanceCriterionInput {
    Text(String),
    Object(AcceptanceCriterion),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepDraftInput {
    pub title: String,
    pub summary: String,
    pub instruction_seed: String,
    pub expected_files: Vec<String>,
    pub acceptance_criteria: Vec<AcceptanceCriterionInput>,
    #[serde(default)]
    pub linked_criterion_ids: Vec<String>,
    #[serde(default)]
    pub rationale: Option<String>,
    #[serde(default)]
    pub step_kind: Option<StepKind>,
    pub verification_command: Option<String>,
    pub verification_type: Option<String>,
    pub dependencies: Vec<String>,
    pub parallel_group: Option<i64>,
    pub position: i64,
    pub step_id: String,
}

/// S-033: one step in a multi-step fan-out. `depends_on_draft` holds indices of
/// sibling drafts (within the same batch) this step depends on; the batch IPC
/// inserts in dependency order and rewrites these to the siblings' assigned
/// stable step_ids before insert.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MultiStepDraftInput {
    pub draft: StepDraftInput,
    #[serde(default)]
    pub depends_on_draft: Vec<usize>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppendStepOptions {
    #[serde(default)]
    pub mutation_reason: Option<String>,
    #[serde(default)]
    pub linked_criterion_ids: Vec<String>,
    #[serde(default)]
    pub prd_delta: Option<ProjectSpecDelta>,
}

/// S-033: a stable reference to an existing plan step, resolved at the IPC
/// layer so the frontend can render/confirm a remove or supersede proposal.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepRefPayload {
    pub step_id: String,
    pub db_id: i64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum RouteDecision {
    AddStep {
        draft: Box<StepDraftInput>,
        reason: String,
    },
    Chat {
        reason: String,
    },
    Skip {
        reason: String,
    },
    /// S-033: ask one criterion-linked question before drafting. Non-mutating;
    /// the answer feeds a subsequent draft.
    Clarify {
        question: String,
        candidate_intent: String,
        suggested_criterion_ids: Vec<String>,
        reason: String,
    },
    /// S-033: a reviewable proposal to retire an existing active step.
    RemoveStep {
        target: StepRefPayload,
        reason: String,
    },
    /// S-033: a reviewable proposal to replace an existing active step.
    SupersedeStep {
        target: StepRefPayload,
        replacement: Box<StepDraftInput>,
        reason: String,
    },
    /// S-033: the router proposed an add that `find_duplicate_step` matched
    /// against an existing active step. Detected server-side (NOT a model verb —
    /// duplicates are plan truth, never self-reported by the LLM); surfaced as a
    /// typed outcome carrying the matched step + the rejected draft so the P8 UI
    /// can show the collision instead of silently dropping it to chat.
    /// Non-mutating.
    Duplicate {
        existing: StepRefPayload,
        draft: Box<StepDraftInput>,
        reason: String,
    },
    /// S-033: a reviewable multi-step fan-out proposal. Each draft carries its
    /// `depends_on_draft` sibling indices; the P8b apply path
    /// (`workspace_plan_append_steps`) topo-sorts and allocates step_ids, so the
    /// `step_id`/`position` here are placeholders. Non-mutating (propose-only).
    MultiStep {
        drafts: Vec<MultiStepDraftInput>,
        reason: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDraftInput {
    pub goal: String,
    pub intent_summary: String,
    pub scope: Vec<String>,
    pub non_goals: Vec<String>,
    pub constraints: Vec<String>,
    pub acceptance_criteria: Vec<AcceptanceCriterionInput>,
    pub steps: Vec<StepDraftInput>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRationaleChallengeInput {
    pub plan_id: i64,
    pub step_db_id: i64,
    pub text: String,
    #[serde(default)]
    pub linked_criterion_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StepRationaleChallengeOutput {
    pub objection_id: String,
    pub suggestion_status: String,
    pub offer_id: String,
    pub offer_kind: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_seed: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanAdjustmentOfferResponse {
    Accepted,
    Dismissed,
}

impl PlanAdjustmentOfferResponse {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Dismissed => "dismissed",
        }
    }

    pub(super) fn suggestion_status(self) -> ObjectionSuggestionStatus {
        match self {
            Self::Accepted => ObjectionSuggestionStatus::Accepted,
            Self::Dismissed => ObjectionSuggestionStatus::Dismissed,
        }
    }

    pub(super) fn event_type(self) -> &'static str {
        match self {
            Self::Accepted => dive_event_log::PLAN_ADJUSTMENT_ACCEPTED_EVENT,
            Self::Dismissed => dive_event_log::PLAN_ADJUSTMENT_DISMISSED_EVENT,
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanAdjustmentOfferResponseInput {
    pub plan_id: i64,
    pub step_db_id: i64,
    pub objection_id: String,
    pub offer_id: String,
    pub response: PlanAdjustmentOfferResponse,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlanAdjustmentOfferResponseOutput {
    pub objection_id: String,
    pub offer_id: String,
    pub suggestion_status: String,
}

/// Student's resolution of the plan-critique gate, threaded from the approval UI
/// so the approval can be logged as engaged vs blind (Constitution IV). The note
/// is the student's own one-line reason (the "none" path authored artifact,
/// P1-14) — supervision evidence, not AI self-report.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanCritiqueResolution {
    /// "none" (nothing missing — can approve) or "found" (requested changes).
    pub response: String,
    #[serde(default)]
    pub note: Option<String>,
}
