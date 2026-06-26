export interface InterviewAnswer {
  question: string;
  answer: string;
}

export type ProjectSpecStatus = "draft" | "approved";
export type AcceptanceCriterionSource =
  | "interview"
  | "student_edit"
  | "plan_mutation"
  | "migration";
export type AcceptanceCriterionStatus = "active" | "retired";

export interface AcceptanceCriterion {
  criterionId: string;
  text: string;
  source: AcceptanceCriterionSource;
  status: AcceptanceCriterionStatus;
  createdInVersion: number;
  retiredInVersion: number | null;
}

export type AcceptanceCriterionInput = string | AcceptanceCriterion;

export interface ProjectSpec {
  projectSpecId: string;
  projectId: number;
  currentVersion: number;
  goal: string;
  intentSummary: string | null;
  scope: string[];
  nonGoals: string[];
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  status: ProjectSpecStatus;
  createdAt: number;
  updatedAt: number;
}

export type ProjectSpecDraft = Omit<
  ProjectSpec,
  "projectSpecId" | "currentVersion" | "createdAt" | "updatedAt"
> & {
  projectSpecId?: string;
  currentVersion?: number;
};

export interface LiveProjectSpecDraft {
  draftId: string;
  projectId: number;
  baseVersion: number | null;
  spec: ProjectSpecDraft;
  dirtyFields: string[];
  studentEditedFields: string[];
  lastPatchId: string | null;
  updatedAt: number;
}

export type PrdPatchValidationOutcome = "none" | "applied" | "rejected" | "held_for_student";

export interface InterviewTurn {
  turnId: string;
  draftId: string;
  studentAnswerSummary: string;
  assistantResponseSummary: string;
  patchId: string | null;
  validationOutcome: PrdPatchValidationOutcome;
  createdAt: number;
}

export interface PrdInterviewConversationTurn {
  role: "assistant" | "student";
  text: string;
}

export type PrdPatchOperation =
  | { op: "set_goal"; value?: string; text?: string }
  | { op: "set_intent_summary"; value?: string; text?: string }
  | { op: "append_scope"; value?: string; text?: string }
  | { op: "append_non_goal"; value?: string; text?: string }
  | { op: "append_constraint"; value?: string; text?: string }
  | { op: "append_acceptance_criterion"; text?: string; value?: string }
  | {
      op: "revise_acceptance_criterion_text";
      criterionId: string;
      text?: string;
      value?: string;
    };

export interface PrdPatch {
  patchId: string;
  operations: PrdPatchOperation[];
  rationale: string | null;
  sourceTurnId: string;
}

export interface DecompositionRationale {
  stepId: string;
  linkedCriterionIds: string[];
  rationale: string;
  riskNotes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSpecDelta {
  fromVersion: number;
  toVersion: number;
  addedCriteria: AcceptanceCriterion[];
  retiredCriterionIds: string[];
  scopeChanges: string[];
  nonGoalChanges: string[];
}

export interface ScopeExpansionAssessment {
  expanded: boolean;
  reasonCodes: string[];
  evidenceRefs: string[];
}

export type PlanMutationType = "add_step" | "change_step" | "retire_step";

export interface PlanMutation {
  mutationId: string;
  projectId: number;
  planId: number;
  type: PlanMutationType;
  stepDbId: number | null;
  stableStepId: string | null;
  reason: string | null;
  criterionIds: string[];
  prdDelta: ProjectSpecDelta;
  scopeExpansion: ScopeExpansionAssessment;
  createdAt: number;
}

export interface AppendPlanStepInput {
  planId: number;
  draft: StepDraftInput;
  mutationReason?: string | null;
  linkedCriterionIds?: string[];
  prdDelta?: ProjectSpecDelta | null;
}

export type ObjectionSuggestionStatus = "none" | "offered" | "accepted" | "dismissed";
export type RationaleChallengeOfferKind = "redecompose_step" | "adjust_plan";

export interface ChallengeStepRationaleInput {
  planId: number;
  stepDbId: number;
  text: string;
  linkedCriterionIds?: string[];
}

export interface ChallengeStepRationaleResult {
  objectionId: string;
  suggestionStatus: ObjectionSuggestionStatus;
  offerId: string;
  offerKind: RationaleChallengeOfferKind;
  message: string;
  suggestedSeed?: string | null;
}

export interface RationaleChallengeOffer {
  objectionId: string;
  offerId: string;
  offerKind: RationaleChallengeOfferKind;
  message: string | null;
  suggestedSeed: string | null;
}

export interface RationaleChallengeOfferActionInput {
  planId: number;
  stepDbId: number;
  objectionId: string;
  offerId: string;
}

export interface RationaleChallengeOfferActionResult {
  objectionId: string;
  offerId: string;
  suggestionStatus: Extract<ObjectionSuggestionStatus, "accepted" | "dismissed">;
}

export interface PlanAdjustmentReviewRequestDetail {
  projectId: number;
  planId: number;
  stepDbId: number;
  objectionId: string;
  offerId: string;
  offerKind: RationaleChallengeOfferKind;
  message: string;
  suggestedSeed?: string | null;
}

export interface Objection {
  objectionId: string;
  projectId: number;
  planId: number;
  stepDbId: number;
  stableStepId: string;
  text: string;
  linkedCriterionIds: string[];
  suggestionStatus: ObjectionSuggestionStatus;
  createdAt: number;
}

export interface InterviewRow {
  id: number;
  project_id: number;
  goal: string;
  questions: unknown | null;
  unresolved_questions: unknown | null;
  intent_summary: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface StepDraftInput {
  stepId: string;
  title: string;
  summary: string;
  instructionSeed: string;
  expectedFiles: string[];
  acceptanceCriteria: AcceptanceCriterionInput[];
  linkedCriterionIds: string[];
  // S-033 P8b-2: matches the Rust `Option<String>` wire shape, which serializes
  // `None` as `null` (the `#[serde(default)]` field rides on add_step /
  // supersede / multi_step drafts). Consumers must treat it as nullable.
  rationale: string | null;
  verificationCommand: string | null;
  verificationType: string | null;
  dependencies: string[];
  parallelGroup: number | null;
  position: number;
}

export interface PlanDraftInput {
  goal: string;
  intentSummary: string;
  scope: string[];
  nonGoals: string[];
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterionInput[];
  steps: StepDraftInput[];
}

export interface PlanRow {
  id: number;
  project_id: number;
  interview_id: number | null;
  goal: string;
  intent_summary: string | null;
  scope: unknown | null;
  non_goals: unknown | null;
  constraints: unknown | null;
  acceptance_criteria: unknown | null;
  status: string;
  created_at: number;
  approved_at: number | null;
  updated_at: number;
}

export interface PlanGenerationResult {
  plan: PlanRow;
  steps: import("../roadmap").PlanStepRow[];
}

export interface LlmPlanDraftPayload {
  intentSummary: string;
  unresolvedQuestions: string[];
  planInput: PlanDraftInput;
}
