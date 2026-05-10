export interface InterviewAnswer {
  question: string;
  answer: string;
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
  acceptanceCriteria: string[];
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
  acceptanceCriteria: string[];
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
