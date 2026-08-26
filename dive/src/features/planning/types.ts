export interface InterviewAnswer {
  question: string;
  answer: string;
}

/**
 * The student's resolution of the plan-critique gate at approval time. Logged as
 * supervision evidence so an engaged approval can be told apart from a blind one.
 * The note is the student's own one-line reason on the "none" path (P1-14/P1-15).
 */
export interface PlanCritiqueResolution {
  response: "none" | "found";
  note?: string;
}

export type ProjectSpecStatus = "draft" | "approved";
export type AcceptanceCriterionSource =
  | "interview"
  | "student_edit"
  | "plan_mutation"
  | "migration";
export type AcceptanceCriterionStatus = "active" | "retired";

// S-053 D3: per-field authorship for the five scalar/list PRD fields (goal,
// intentSummary, scope, nonGoals, constraints). `AcceptanceCriterion.source`
// and `ArchitectureDecision.decisionSource` already carry their own (richer)
// provenance, so those two fields are deliberately never keyed into this map
// — see the field_provenance doc comment in db/models.rs for the same
// boundary on the Rust side.
export type ProvenanceSource = "student" | "ai_patch" | "ai_suggestion_accepted";

export interface AcceptanceCriterion {
  criterionId: string;
  text: string;
  source: AcceptanceCriterionSource;
  status: AcceptanceCriterionStatus;
  createdInVersion: number;
  retiredInVersion: number | null;
}

export type AcceptanceCriterionInput = string | AcceptanceCriterion;

export type VerificationType = "run" | "preview" | "manual" | "test";

// S-047 (010 theme 7) → S-075 (014 theme 4, D-014-16): a first-class, versioned
// architecture decision on the PRD — one tech-stack confirmation. The AI
// proposes a stack from the goal, DIVE records it, and the student confirms or
// rewrites it (Constitution VI). There is no project-kind taxonomy (VII); legacy
// `form` / `forms` / `formOtherLabel` keys are stripped by
// normalizeArchitectureDecision. `stack` is null until a stack is accepted or
// typed. `decisionSource`: `student_confirmed` on the first accepted/typed
// stack, `student_changed` when it is edited afterwards.
export type ArchitectureDecisionSource = "student_confirmed" | "student_changed" | "migration";

export interface ArchitectureDecision {
  stack: string | null;
  rationale?: string | null;
  decisionSource: ArchitectureDecisionSource;
  decidedInVersion: number;
}

// S-047 (010 theme 7): the AI's recommend-then-confirm tech-stack options for
// the stack focus. `value` is free-text stack wording; `rationale` is one plain
// line saying what the finished thing is and why this stack. Surfaced as
// selectable cards; the student's click (or typing) is what authors the
// decision (never an AI patch).
export interface ArchitectureProposalOption {
  value: string;
  rationale: string;
}

export interface ArchitectureProposals {
  // Always "stack" since S-075 (Rust drops any other kind at the sanitizer).
  kind: "stack";
  options: ArchitectureProposalOption[];
}

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
  // Null until decided; pre-S-047 PRDs deserialize as null and stay openable.
  architecture: ArchitectureDecision | null;
  // S-053 D3: carried from the live draft at confirm time; empty on pre-S-053
  // snapshots.
  fieldProvenance: Record<string, ProvenanceSource>;
  status: ProjectSpecStatus;
  createdAt: number;
  updatedAt: number;
}

// fieldProvenance is omitted here too: it lives on the outer LiveProjectSpecDraft
// (sibling to dirtyFields/studentEditedFields), never on `spec` — matches the
// Rust ProjectSpecDraft, which has no field_provenance of its own.
export type ProjectSpecDraft = Omit<
  ProjectSpec,
  "projectSpecId" | "currentVersion" | "createdAt" | "updatedAt" | "fieldProvenance"
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
  fieldProvenance: Record<string, ProvenanceSource>;
  updatedAt: number;
}

// "not_structured" (S-053 D1): the model turn produced no JSON at all, or
// JSON that decodes as neither the patch-envelope nor the bare-patch shape.
// Distinct from "none", which is a turn that structured fine but genuinely
// proposed no change. Rendering (retry affordance, honest copy) is P2 scope.
export type PrdPatchValidationOutcome =
  | "none"
  | "applied"
  | "rejected"
  | "held_for_student"
  | "not_structured";

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
    }
  // S-072 (014 theme 2): in-place edits. `target` is the CURRENT item text
  // (normalized exact match on the backend, D-014-05); criteria are retired,
  // never deleted (D-014-06).
  | { op: "revise_scope"; target: string; value?: string; text?: string }
  | { op: "revise_non_goal"; target: string; value?: string; text?: string }
  | { op: "revise_constraint"; target: string; value?: string; text?: string }
  | { op: "remove_scope"; target: string }
  | { op: "remove_non_goal"; target: string }
  | { op: "remove_constraint"; target: string }
  | { op: "retire_acceptance_criterion"; criterionId: string };

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

export type StepKind = "feature" | "refactor" | "rename" | "comment" | "debug";

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
  stepKind?: StepKind;
  verificationCommand: string | null;
  verificationType: VerificationType | null;
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
