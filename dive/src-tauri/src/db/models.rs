use std::collections::BTreeMap;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, ValueRef};
use rusqlite::ToSql;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CardState {
    Decomposed,
    Instructed,
    Verifying,
    Verified,
    Rejected,
    Extended,
}

impl CardState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Decomposed => "decomposed",
            Self::Instructed => "instructed",
            Self::Verifying => "verifying",
            Self::Verified => "verified",
            Self::Rejected => "rejected",
            Self::Extended => "extended",
        }
    }

    pub fn parse(value: &str) -> Result<Self, crate::db::DbError> {
        match value {
            "decomposed" => Ok(Self::Decomposed),
            "instructed" => Ok(Self::Instructed),
            "verifying" => Ok(Self::Verifying),
            "verified" => Ok(Self::Verified),
            "rejected" => Ok(Self::Rejected),
            "extended" => Ok(Self::Extended),
            other => Err(crate::db::DbError::InvalidCardState(other.to_owned())),
        }
    }
}

impl ToSql for CardState {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for CardState {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let raw = value.as_str()?;
        Self::parse(raw).map_err(|err| FromSqlError::Other(Box::new(err)))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewProject {
    pub name: String,
    pub path: String,
    pub provider_default: Option<String>,
    pub model_default: Option<String>,
}

fn default_project_status() -> String {
    "active".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRow {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub provider_default: Option<String>,
    pub model_default: Option<String>,
    // S-056 D4: 'active' | 'archived'. Old payloads predating this column
    // (mirrors StepRow.status, migration_v13/v18) deserialize as active.
    #[serde(default = "default_project_status")]
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewSession {
    pub project_id: i64,
    pub title: String,
    pub ended_at: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionRow {
    pub id: i64,
    pub project_id: i64,
    pub title: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewWorkmap {
    pub session_id: i64,
    pub current_stage: String,
    pub collapsed: bool,
    pub current_card_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkmapRow {
    pub session_id: i64,
    pub current_stage: String,
    pub collapsed: bool,
    pub current_card_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewCard {
    pub session_id: i64,
    pub title: String,
    pub instruction: Option<String>,
    pub assist_summary: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub retrospective: Option<String>,
    pub change_summary: Option<String>,
    pub state: CardState,
    pub verify_log: Option<String>,
    pub changed_files: Option<Value>,
    pub test_command: Option<String>,
    pub approval_judgment: Option<String>,
    pub approval_provenance: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CardRow {
    pub id: i64,
    pub session_id: i64,
    pub title: String,
    pub instruction: Option<String>,
    pub assist_summary: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub retrospective: Option<String>,
    pub change_summary: Option<String>,
    pub state: CardState,
    pub verify_log: Option<String>,
    pub changed_files: Option<Value>,
    pub test_command: Option<String>,
    pub approval_judgment: Option<String>,
    pub approval_provenance: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewMessage {
    pub session_id: i64,
    pub card_id: Option<i64>,
    pub role: String,
    pub content: String,
    pub reasoning_content: Option<String>,
    pub tool_calls: Option<Value>,
    pub usage: Option<Value>,
    pub provider: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageRow {
    pub id: i64,
    pub session_id: i64,
    pub card_id: Option<i64>,
    pub role: String,
    pub content: String,
    pub reasoning_content: Option<String>,
    pub tool_calls: Option<Value>,
    pub usage: Option<Value>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewToolCall {
    pub message_id: i64,
    pub name: String,
    pub input: Value,
    pub output: Option<Value>,
    pub approved: Option<bool>,
    pub risk_level: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolCallRow {
    pub id: i64,
    pub message_id: i64,
    pub name: String,
    pub input: Value,
    pub output: Option<Value>,
    pub approved: Option<bool>,
    pub risk_level: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckpointStats {
    pub added: u32,
    pub removed: u32,
    pub modified: u32,
}

impl CheckpointStats {
    pub fn zero() -> Self {
        Self {
            added: 0,
            removed: 0,
            modified: 0,
        }
    }
}

impl Default for CheckpointStats {
    fn default() -> Self {
        Self::zero()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewCheckpoint {
    pub session_id: i64,
    pub card_id: Option<i64>,
    pub git_sha: String,
    pub kind: String,
    pub label: Option<String>,
    pub changed_files: Vec<String>,
    pub stats: CheckpointStats,
    pub session_state_snapshot: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckpointRow {
    pub id: i64,
    pub session_id: i64,
    pub card_id: Option<i64>,
    pub git_sha: String,
    pub kind: String,
    pub label: Option<String>,
    pub created_at: i64,
    pub changed_files: Vec<String>,
    pub stats: CheckpointStats,
    pub session_state_snapshot: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewProviderConfig {
    pub kind: String,
    pub auth_type: String,
    pub base_url: Option<String>,
    pub config: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderConfigRow {
    pub id: i64,
    pub kind: String,
    pub auth_type: String,
    pub base_url: Option<String>,
    pub config: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewEventLog {
    pub session_id: Option<i64>,
    pub r#type: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventLogRow {
    pub id: i64,
    pub session_id: Option<i64>,
    pub r#type: String,
    pub payload: Value,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceCriterionSource {
    Interview,
    StudentEdit,
    PlanMutation,
    Migration,
}

// S-053 D3: per-field provenance for the five scalar/list PRD fields (goal,
// intentSummary, scope, nonGoals, constraints) that previously carried no
// authorship record at all — the gap that let a fully hand-typed PRD still
// show the "AI가 대화를 정리한 요약" intent-check framing. `AcceptanceCriterion`
// already has its own `source` (per-criterion) and `ArchitectureDecision` its
// own `decision_source` (StudentConfirmed/StudentChanged) — both richer than a
// single enum value, so this map intentionally does NOT duplicate provenance
// for `acceptanceCriteria` or `architecture`; the intent-check card reuses
// those existing enums for those two fields instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProvenanceSource {
    /// The student typed or edited this field directly.
    Student,
    /// An AI-proposed patch applied this field during an interview turn.
    AiPatch,
    /// The student accepted an AI-recommended option card for this field
    /// (currently unused by any scalar-field write path — architecture's
    /// recommend-then-confirm cards write `architecture`, which is out of
    /// this map's scope — kept for parity with the design's provenance
    /// vocabulary and to leave room for a future scalar-field proposal UI).
    AiSuggestionAccepted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceCriterionStatus {
    Active,
    Retired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectSpecStatus {
    Draft,
    Approved,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrdPatchValidationOutcome {
    None,
    Applied,
    Rejected,
    HeldForStudent,
    /// S-053 D1: the model turn produced no JSON at all, or JSON that decodes
    /// as neither the patch-envelope nor the bare-patch shape. Distinct from
    /// `None`, which is a genuine net-zero (the model answered but proposed no
    /// change, or a well-formed patch whose operations applied to nothing).
    NotStructured,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanMutationType {
    AddStep,
    ChangeStep,
    RetireStep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectionSuggestionStatus {
    None,
    Offered,
    Accepted,
    Dismissed,
}

impl ObjectionSuggestionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Offered => "offered",
            Self::Accepted => "accepted",
            Self::Dismissed => "dismissed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeCapabilityStatus {
    Ready,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeUnavailableReason {
    ProviderNotConfigured,
    ProviderNotPiCapable,
    LegacyRequested,
    MissingCredentials,
    MissingProjectRoot,
    RuntimeUnavailable,
    /// The configured provider+model pair is not in the pinned pi-ai
    /// registry the bundled sidecar resolves against (S-051 D1/D2).
    ModelNotExecutable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSetupAction {
    ConfigureProvider,
    ChooseSupportedProvider,
    AddCredentials,
    OpenProject,
    RetryRuntime,
    /// Switch to a Pi-executable model for the current provider (S-051 D2
    /// point 2). Navigates to provider/model settings; never auto-mutates
    /// the saved model — the student picks and confirms.
    SwitchModel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilityState {
    pub state: RuntimeCapabilityStatus,
    pub provider_kind: String,
    pub model: Option<String>,
    pub reason_code: Option<RuntimeUnavailableReason>,
    pub message: String,
    pub setup_action: Option<RuntimeSetupAction>,
    pub recorded_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanAdjustmentOfferKind {
    RedecomposeStep,
    AdjustPlan,
}

impl PlanAdjustmentOfferKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RedecomposeStep => "redecompose_step",
            Self::AdjustPlan => "adjust_plan",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanAdjustmentOfferStatus {
    Offered,
    Accepted,
    Dismissed,
}

impl PlanAdjustmentOfferStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Offered => "offered",
            Self::Accepted => "accepted",
            Self::Dismissed => "dismissed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAdjustmentOffer {
    pub offer_id: String,
    pub objection_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub step_db_id: i64,
    pub stable_step_id: String,
    pub kind: PlanAdjustmentOfferKind,
    pub status: PlanAdjustmentOfferStatus,
    pub suggested_seed: Option<String>,
    pub created_at: i64,
    pub responded_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPlanAdjustmentOffer {
    pub offer_id: String,
    pub objection_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub step_db_id: i64,
    pub stable_step_id: String,
    pub kind: PlanAdjustmentOfferKind,
    pub status: PlanAdjustmentOfferStatus,
    pub suggested_seed: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAdjustmentOfferRow {
    pub offer_id: String,
    pub objection_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub step_db_id: i64,
    pub stable_step_id: String,
    pub kind: PlanAdjustmentOfferKind,
    pub status: PlanAdjustmentOfferStatus,
    pub suggested_seed: Option<String>,
    pub created_at: i64,
    pub responded_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceCriterion {
    pub criterion_id: String,
    pub text: String,
    pub source: AcceptanceCriterionSource,
    pub status: AcceptanceCriterionStatus,
    pub created_in_version: i64,
    pub retired_in_version: Option<i64>,
}

// S-047 (010 theme 7): a first-class, versioned architecture decision on the PRD.
// The application form is a bounded enum (so "a stack consistent with the form" is
// checkable and the UI shows a small fixed set, not an open jargon prompt); the
// stack is free text (AI-proposed, student-editable). LLM proposes, DIVE records,
// the student decides (Constitution VI).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchitectureForm {
    WebApp,
    StaticPage,
    CliTool,
    DesktopApp,
    ApiService,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchitectureDecisionSource {
    StudentConfirmed,
    StudentChanged,
    Migration,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchitectureDecision {
    // `form` is always set once an architecture exists; `stack` stays `None` in the
    // intermediate two-stage state (form picked, stack not decided yet).
    pub form: ArchitectureForm,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form_other_label: Option<String>,
    #[serde(default)]
    pub stack: Option<String>,
    #[serde(default)]
    pub rationale: Option<String>,
    pub decision_source: ArchitectureDecisionSource,
    pub decided_in_version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSpec {
    pub project_spec_id: String,
    pub project_id: i64,
    pub current_version: i64,
    pub goal: String,
    pub intent_summary: Option<String>,
    pub scope: Vec<String>,
    pub non_goals: Vec<String>,
    pub constraints: Vec<String>,
    pub acceptance_criteria: Vec<AcceptanceCriterion>,
    // Nullable + serde-default so pre-S-047 PRDs deserialize as `None` and stay
    // openable; they decide an architecture at their next confirm/edit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub architecture: Option<ArchitectureDecision>,
    // S-053 D3: carried over from the live draft at confirm time. serde-default
    // (pattern: `architecture` above) so pre-S-053 snapshot JSON blobs — frozen
    // in ProjectSpecVersion.snapshot before this field existed — still
    // deserialize as an empty map instead of failing to load.
    #[serde(default)]
    pub field_provenance: BTreeMap<String, ProvenanceSource>,
    pub status: ProjectSpecStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSpecDraft {
    pub project_spec_id: Option<String>,
    pub project_id: i64,
    pub current_version: Option<i64>,
    pub goal: String,
    pub intent_summary: Option<String>,
    pub scope: Vec<String>,
    pub non_goals: Vec<String>,
    pub constraints: Vec<String>,
    pub acceptance_criteria: Vec<AcceptanceCriterion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub architecture: Option<ArchitectureDecision>,
    pub status: ProjectSpecStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveProjectSpecDraft {
    pub draft_id: String,
    pub project_id: i64,
    pub base_version: Option<i64>,
    pub spec: ProjectSpecDraft,
    pub dirty_fields: Vec<String>,
    pub student_edited_fields: Vec<String>,
    pub last_patch_id: Option<String>,
    #[serde(default)]
    pub field_provenance: BTreeMap<String, ProvenanceSource>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdPatchOperation {
    pub op: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub criterion_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrdPatch {
    pub patch_id: String,
    pub operations: Vec<PrdPatchOperation>,
    pub rationale: Option<String>,
    pub source_turn_id: String,
}

// S-053 D1: durable per-turn PRD interview record. Written for EVERY interview
// turn — applied, rejected, held, benign none, and (new) not_structured alike
// — so a structuring failure keeps the student's answer instead of dropping it
// server-side, and the turn is reproducible for a "다시 구조화" retry. Local-DB
// only; not part of any export path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInterviewTurn {
    pub draft_id: String,
    pub turn_id: String,
    pub student_answer: String,
    pub outcome: PrdPatchValidationOutcome,
    pub parse_failure_kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewTurnRow {
    pub id: i64,
    pub draft_id: String,
    pub turn_id: String,
    pub student_answer: String,
    pub outcome: PrdPatchValidationOutcome,
    pub parse_failure_kind: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecompositionRationale {
    pub step_id: String,
    pub linked_criterion_ids: Vec<String>,
    pub rationale: String,
    pub risk_notes: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSpecDelta {
    pub from_version: i64,
    pub to_version: i64,
    pub added_criteria: Vec<AcceptanceCriterion>,
    pub retired_criterion_ids: Vec<String>,
    pub scope_changes: Vec<String>,
    pub non_goal_changes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeExpansionAssessment {
    pub expanded: bool,
    pub reason_codes: Vec<String>,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMutation {
    pub mutation_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub r#type: PlanMutationType,
    pub step_db_id: Option<i64>,
    pub stable_step_id: Option<String>,
    pub reason: Option<String>,
    pub criterion_ids: Vec<String>,
    pub prd_delta: ProjectSpecDelta,
    pub scope_expansion: ScopeExpansionAssessment,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Objection {
    pub objection_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub step_db_id: i64,
    pub stable_step_id: String,
    pub text: String,
    pub linked_criterion_ids: Vec<String>,
    pub suggestion_status: ObjectionSuggestionStatus,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectSpecVersion {
    pub project_spec_id: String,
    pub project_id: i64,
    pub version: i64,
    pub previous_version: Option<i64>,
    pub snapshot: ProjectSpec,
    pub reason: String,
    pub delta_summary: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSpecVersionRow {
    pub id: i64,
    pub project_spec_id: String,
    pub project_id: i64,
    pub version: i64,
    pub previous_version: Option<i64>,
    pub snapshot: ProjectSpec,
    pub reason: String,
    pub delta_summary: Value,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLiveProjectSpecDraft {
    pub draft_id: String,
    pub project_id: i64,
    pub base_version: Option<i64>,
    pub spec: ProjectSpecDraft,
    pub dirty_fields: Vec<String>,
    pub student_edited_fields: Vec<String>,
    pub last_patch_id: Option<String>,
    // S-053 D3: serde-default so an older client's cached/serialized draft JSON
    // (predating this field) still deserializes over IPC.
    #[serde(default)]
    pub field_provenance: BTreeMap<String, ProvenanceSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveProjectSpecDraftRow {
    pub draft_id: String,
    pub project_id: i64,
    pub base_version: Option<i64>,
    pub spec: ProjectSpecDraft,
    pub dirty_fields: Vec<String>,
    pub student_edited_fields: Vec<String>,
    pub last_patch_id: Option<String>,
    #[serde(default)]
    pub field_provenance: BTreeMap<String, ProvenanceSource>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPlanMutation {
    pub mutation_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub r#type: PlanMutationType,
    pub step_db_id: Option<i64>,
    pub stable_step_id: Option<String>,
    pub reason: Option<String>,
    pub criterion_ids: Vec<String>,
    pub prd_delta: ProjectSpecDelta,
    pub scope_expansion: ScopeExpansionAssessment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMutationRow {
    pub mutation_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub r#type: PlanMutationType,
    pub step_db_id: Option<i64>,
    pub stable_step_id: Option<String>,
    pub reason: Option<String>,
    pub criterion_ids: Vec<String>,
    pub prd_delta: ProjectSpecDelta,
    pub scope_expansion: ScopeExpansionAssessment,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewObjection {
    pub objection_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub step_db_id: i64,
    pub stable_step_id: String,
    pub text: String,
    pub linked_criterion_ids: Vec<String>,
    pub suggestion_status: ObjectionSuggestionStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectionRow {
    pub objection_id: String,
    pub project_id: i64,
    pub plan_id: i64,
    pub step_db_id: i64,
    pub stable_step_id: String,
    pub text: String,
    pub linked_criterion_ids: Vec<String>,
    pub suggestion_status: ObjectionSuggestionStatus,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewInterview {
    pub project_id: i64,
    pub goal: String,
    pub questions: Option<Value>,
    pub unresolved_questions: Option<Value>,
    pub intent_summary: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InterviewRow {
    pub id: i64,
    pub project_id: i64,
    pub goal: String,
    pub questions: Option<Value>,
    pub unresolved_questions: Option<Value>,
    pub intent_summary: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewPlan {
    pub project_id: i64,
    pub interview_id: Option<i64>,
    pub goal: String,
    pub intent_summary: Option<String>,
    pub scope: Option<Value>,
    pub non_goals: Option<Value>,
    pub constraints: Option<Value>,
    pub acceptance_criteria: Option<Value>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanRow {
    pub id: i64,
    pub project_id: i64,
    pub interview_id: Option<i64>,
    pub goal: String,
    pub intent_summary: Option<String>,
    pub scope: Option<Value>,
    pub non_goals: Option<Value>,
    pub constraints: Option<Value>,
    pub acceptance_criteria: Option<Value>,
    pub status: String,
    pub created_at: i64,
    pub approved_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    #[default]
    Feature,
    Refactor,
    Rename,
    Comment,
    Debug,
}

impl StepKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Feature => "feature",
            Self::Refactor => "refactor",
            Self::Rename => "rename",
            Self::Comment => "comment",
            Self::Debug => "debug",
        }
    }

    pub fn from_marker(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "refactor" => Self::Refactor,
            "rename" => Self::Rename,
            "comment" => Self::Comment,
            "debug" => Self::Debug,
            _ => Self::Feature,
        }
    }

    pub fn behavior_preserving(self) -> bool {
        matches!(self, Self::Refactor | Self::Rename)
    }
}

fn default_step_kind() -> StepKind {
    StepKind::Feature
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewStep {
    pub plan_id: i64,
    pub step_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub instruction_seed: Option<String>,
    pub expected_files: Option<Value>,
    pub acceptance_criteria: Option<Value>,
    #[serde(default = "default_step_kind")]
    pub step_kind: StepKind,
    pub verification_kind: Option<String>,
    pub verification_command: Option<String>,
    pub verification_manual_check: Option<String>,
    pub dependencies: Option<Value>,
    pub parallel_group: Option<String>,
    pub position: i64,
}

fn default_step_status() -> String {
    "active".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepRow {
    pub id: i64,
    pub plan_id: i64,
    pub step_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub instruction_seed: Option<String>,
    pub expected_files: Option<Value>,
    pub acceptance_criteria: Option<Value>,
    #[serde(default = "default_step_kind")]
    pub step_kind: StepKind,
    pub verification_kind: Option<String>,
    pub verification_command: Option<String>,
    pub verification_manual_check: Option<String>,
    pub dependencies: Option<Value>,
    pub parallel_group: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    // S-033 plan-mutation lifecycle: 'active' | 'removed' | 'superseded'. Old
    // payloads predating these columns deserialize to an active step.
    #[serde(default = "default_step_status")]
    pub status: String,
    #[serde(default)]
    pub superseded_by_step_id: Option<String>,
    #[serde(default)]
    pub suppression_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewStepSessionMapping {
    pub step_id: i64,
    pub session_id: Option<i64>,
    pub card_id: Option<i64>,
    pub state_path: Option<String>,
    pub status: String,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub checkpoint_ids: Option<Value>,
    pub verification_status: Option<String>,
    pub verification_evidence: Option<String>,
    pub user_decision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepSessionMappingRow {
    pub id: i64,
    pub step_id: i64,
    pub session_id: Option<i64>,
    pub card_id: Option<i64>,
    pub state_path: Option<String>,
    pub status: String,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub checkpoint_ids: Option<Value>,
    pub verification_status: Option<String>,
    pub verification_evidence: Option<String>,
    pub user_decision: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[cfg(test)]
mod tests {
    use super::{
        LiveProjectSpecDraftRow, PrdPatchValidationOutcome, ProjectSpec, ProjectSpecStatus,
        ProvenanceSource,
    };

    // S-053 D1: `not_structured` is additive to the wire representation — the
    // new variant serializes to the expected snake_case string, and every
    // pre-existing outcome string still deserializes (old EventLog rows and
    // exports must stay readable).
    #[test]
    fn prd_patch_validation_outcome_not_structured_serializes_to_snake_case() {
        let value = serde_json::to_value(PrdPatchValidationOutcome::NotStructured).unwrap();
        assert_eq!(value, serde_json::json!("not_structured"));
    }

    #[test]
    fn prd_patch_validation_outcome_round_trips_all_variants() {
        let cases = [
            (PrdPatchValidationOutcome::None, "none"),
            (PrdPatchValidationOutcome::Applied, "applied"),
            (PrdPatchValidationOutcome::Rejected, "rejected"),
            (
                PrdPatchValidationOutcome::HeldForStudent,
                "held_for_student",
            ),
            (PrdPatchValidationOutcome::NotStructured, "not_structured"),
        ];
        for (variant, wire) in cases {
            assert_eq!(
                serde_json::to_value(variant).unwrap(),
                serde_json::json!(wire)
            );
            let parsed: PrdPatchValidationOutcome =
                serde_json::from_value(serde_json::json!(wire)).unwrap();
            assert_eq!(parsed, variant);
        }
    }

    #[test]
    fn prd_patch_validation_outcome_deserializes_pre_s053_strings() {
        // Old rows/snapshots never wrote `not_structured` — confirm they still
        // deserialize now that the enum has a fifth variant.
        for wire in ["none", "applied", "rejected", "held_for_student"] {
            assert!(
                serde_json::from_value::<PrdPatchValidationOutcome>(serde_json::json!(wire))
                    .is_ok(),
                "expected {wire:?} to still deserialize"
            );
        }
    }

    // S-053 D3: field_provenance is additive to two wire representations — a
    // ProjectSpecVersion.snapshot JSON blob frozen before this field existed,
    // and a LiveProjectSpecDraft row/IPC payload from before this field
    // existed. Both must still deserialize (as an empty map) rather than fail.
    fn pre_s053_project_spec_json() -> serde_json::Value {
        serde_json::json!({
            "projectSpecId": "prd-1",
            "projectId": 1,
            "currentVersion": 1,
            "goal": "Build a focus timer",
            "intentSummary": "Students track Pomodoro sessions",
            "scope": ["Countdown timer"],
            "nonGoals": ["Account system"],
            "constraints": [],
            "acceptanceCriteria": [],
            "status": "draft",
            "createdAt": 100,
            "updatedAt": 200
        })
    }

    #[test]
    fn project_spec_deserializes_pre_s053_snapshot_without_field_provenance() {
        let spec: ProjectSpec = serde_json::from_value(pre_s053_project_spec_json())
            .expect("pre-S-053 ProjectSpec snapshot JSON must still deserialize");
        assert!(spec.field_provenance.is_empty());
        assert_eq!(spec.status, ProjectSpecStatus::Draft);
    }

    #[test]
    fn project_spec_field_provenance_round_trips_through_json() {
        let mut spec_json = pre_s053_project_spec_json();
        spec_json["fieldProvenance"] = serde_json::json!({
            "goal": "student",
            "scope": "ai_patch",
        });
        let spec: ProjectSpec = serde_json::from_value(spec_json).unwrap();
        assert_eq!(
            spec.field_provenance.get("goal"),
            Some(&ProvenanceSource::Student)
        );
        assert_eq!(
            spec.field_provenance.get("scope"),
            Some(&ProvenanceSource::AiPatch)
        );

        let round_tripped = serde_json::to_value(&spec).unwrap();
        assert_eq!(round_tripped["fieldProvenance"]["goal"], "student");
        assert_eq!(round_tripped["fieldProvenance"]["scope"], "ai_patch");
    }

    #[test]
    fn provenance_source_serializes_to_snake_case() {
        for (variant, wire) in [
            (ProvenanceSource::Student, "student"),
            (ProvenanceSource::AiPatch, "ai_patch"),
            (
                ProvenanceSource::AiSuggestionAccepted,
                "ai_suggestion_accepted",
            ),
        ] {
            assert_eq!(
                serde_json::to_value(variant).unwrap(),
                serde_json::json!(wire)
            );
            let parsed: ProvenanceSource = serde_json::from_value(serde_json::json!(wire)).unwrap();
            assert_eq!(parsed, variant);
        }
    }

    #[test]
    fn live_project_spec_draft_row_deserializes_pre_s053_payload_without_field_provenance() {
        let draft_json = serde_json::json!({
            "draftId": "prd-draft-1",
            "projectId": 1,
            "baseVersion": null,
            "spec": {
                "projectSpecId": "prd-1",
                "projectId": 1,
                "currentVersion": null,
                "goal": "Build a focus timer",
                "intentSummary": null,
                "scope": [],
                "nonGoals": [],
                "constraints": [],
                "acceptanceCriteria": [],
                "status": "draft"
            },
            "dirtyFields": ["goal"],
            "studentEditedFields": ["goal"],
            "lastPatchId": null,
            "updatedAt": 100
        });

        let draft: LiveProjectSpecDraftRow = serde_json::from_value(draft_json)
            .expect("pre-S-053 draft payload (no fieldProvenance key) must still deserialize");
        assert!(draft.field_provenance.is_empty());
    }
}
