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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRow {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub provider_default: Option<String>,
    pub model_default: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterviewTurn {
    pub turn_id: String,
    pub draft_id: String,
    pub student_answer_summary: String,
    pub assistant_response_summary: String,
    pub patch_id: Option<String>,
    pub validation_outcome: PrdPatchValidationOutcome,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewStep {
    pub plan_id: i64,
    pub step_id: String,
    pub title: String,
    pub summary: Option<String>,
    pub instruction_seed: Option<String>,
    pub expected_files: Option<Value>,
    pub acceptance_criteria: Option<Value>,
    pub verification_kind: Option<String>,
    pub verification_command: Option<String>,
    pub verification_manual_check: Option<String>,
    pub dependencies: Option<Value>,
    pub parallel_group: Option<String>,
    pub position: i64,
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
    pub verification_kind: Option<String>,
    pub verification_command: Option<String>,
    pub verification_manual_check: Option<String>,
    pub dependencies: Option<Value>,
    pub parallel_group: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
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
