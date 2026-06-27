import { allocateCriterionId, markDraftStudentEdited } from "./projectSpec";
import type { AcceptanceCriterion, InterviewAnswer, LiveProjectSpecDraft } from "./types";

export interface QuickIntakeInput {
  audience: string;
  doneSignal: string;
  inScope: string;
  outOfScope: string;
  acceptanceCriterion1: string;
  acceptanceCriterion2: string;
}

export const EMPTY_QUICK_INTAKE_INPUT: QuickIntakeInput = {
  audience: "",
  doneSignal: "",
  inScope: "",
  outOfScope: "",
  acceptanceCriterion1: "",
  acceptanceCriterion2: "",
};

export const QUICK_INTAKE_INTERVIEW_QUESTIONS: Record<keyof QuickIntakeInput, string> = {
  audience: "Who is this for?",
  doneSignal: "What observable result means done?",
  inScope: "What is in scope for the first version?",
  outOfScope: "What is out of scope?",
  acceptanceCriterion1: "Acceptance criterion 1",
  acceptanceCriterion2: "Acceptance criterion 2",
};

export function normalizeQuickIntakeInput(input: QuickIntakeInput): QuickIntakeInput {
  return {
    audience: input.audience.trim(),
    doneSignal: input.doneSignal.trim(),
    inScope: input.inScope.trim(),
    outOfScope: input.outOfScope.trim(),
    acceptanceCriterion1: input.acceptanceCriterion1.trim(),
    acceptanceCriterion2: input.acceptanceCriterion2.trim(),
  };
}

function splitList(value: string): string[] {
  return value
    .split(/\r?\n|;+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function activeCriterion(
  existing: AcceptanceCriterion | undefined,
  text: string,
  criteria: AcceptanceCriterion[],
  version: number | undefined,
): AcceptanceCriterion {
  if (existing) {
    return {
      ...existing,
      text,
      status: "active",
    };
  }
  return {
    criterionId: allocateCriterionId(criteria),
    text,
    source: "student_edit",
    status: "active",
    createdInVersion: version ?? 1,
    retiredInVersion: null,
  };
}

export function quickIntakeInterviewAnswers(input: QuickIntakeInput): InterviewAnswer[] {
  const normalized = normalizeQuickIntakeInput(input);
  return (Object.keys(QUICK_INTAKE_INTERVIEW_QUESTIONS) as Array<keyof QuickIntakeInput>)
    .map((key) => ({
      question: QUICK_INTAKE_INTERVIEW_QUESTIONS[key],
      answer: normalized[key],
    }))
    .filter((answer) => answer.answer.length > 0);
}

export function applyQuickIntakeToDraft(
  draft: LiveProjectSpecDraft,
  input: QuickIntakeInput,
): LiveProjectSpecDraft {
  const normalized = normalizeQuickIntakeInput(input);
  const criteria = draft.spec.acceptanceCriteria.map((criterion) => ({ ...criterion }));
  criteria[0] = activeCriterion(
    criteria[0],
    normalized.acceptanceCriterion1,
    criteria,
    draft.spec.currentVersion,
  );
  criteria[1] = activeCriterion(
    criteria[1],
    normalized.acceptanceCriterion2,
    criteria,
    draft.spec.currentVersion,
  );

  return markDraftStudentEdited(
    {
      ...draft,
      spec: {
        ...draft.spec,
        goal: normalized.doneSignal,
        intentSummary: `${normalized.audience} - ${normalized.doneSignal}`,
        scope: splitList(normalized.inScope),
        nonGoals: splitList(normalized.outOfScope),
        acceptanceCriteria: criteria,
      },
    },
    ["goal", "intentSummary", "scope", "nonGoals", "acceptanceCriteria"],
  );
}
