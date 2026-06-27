import { useCallback, useEffect, useRef } from "react";
import type {
  LlmPlanDraftPayload,
  PlanDraftInput,
  StepKind,
  StepDraftInput,
  VerificationType,
} from "./types";
import { adaptAcceptanceCriteria } from "./projectSpec";

interface AssistantEndEvent {
  type: "assistant_end";
  content: string;
  finish_reason?: string;
}

type ObservedEvent = AssistantEndEvent | { type: string };

export type PlanDraftLlmErrorReason =
  | "length"
  | "invalid_json"
  | "invalid_plan_shape"
  | "vague_criteria"
  | "missing_state_criteria";

export interface PlanDraftLlmError {
  reason: PlanDraftLlmErrorReason;
  finishReason: string | null;
  content: string;
  unresolvedQuestions?: string[];
}

interface UsePlanInterviewLlmArgs {
  onPlanDraft: (payload: LlmPlanDraftPayload) => void;
  onPlanDraftError?: (error: PlanDraftLlmError) => void;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function legacyVerificationType(command: string | null): VerificationType | null {
  if (!command) return null;
  const tokens = command.trim().toLowerCase().split(/\s+/);
  const executable =
    tokens[0]
      ?.split(/[\\/]/)
      .pop()
      ?.replace(/\.exe$/, "") ?? "";
  const testLike =
    ["cargo-nextest", "jest", "pytest", "vitest"].includes(executable) ||
    tokens.some(
      (token) => token === "test" || token.startsWith("test:") || token.endsWith(":test"),
    );
  return testLike ? "test" : "run";
}

function optionalVerificationType(value: unknown, command: string | null): VerificationType | null {
  if (typeof value !== "string") return legacyVerificationType(command);
  switch (value.trim().toLowerCase()) {
    case "run":
    case "preview":
    case "manual":
    case "test":
      return value.trim().toLowerCase() as VerificationType;
    case "command":
      return legacyVerificationType(command) ?? "manual";
    default:
      return legacyVerificationType(command);
  }
}

function optionalStepKind(value: unknown): StepKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "feature" ||
    normalized === "refactor" ||
    normalized === "rename" ||
    normalized === "comment" ||
    normalized === "debug"
  ) {
    return normalized;
  }
  return null;
}

function includesAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(needle));
}

function classifyStepKind(input: {
  title: string;
  summary: string;
  instructionSeed: string;
  expectedFiles: string[];
  acceptanceCriteria: ReturnType<typeof criteriaArray>;
}): StepKind {
  const criteriaText = input.acceptanceCriteria.map((criterion) => criterion.text).join("\n");
  const text = [
    input.title,
    input.summary,
    input.instructionSeed,
    criteriaText,
    ...input.expectedFiles,
  ]
    .join("\n")
    .toLowerCase();
  if (
    includesAny(text, ["rename", "renaming", "renamed", "이름 변경", "이름을 변경", "명칭 변경"])
  ) {
    return "rename";
  }
  if (
    includesAny(text, [
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
    ])
  ) {
    return "refactor";
  }
  if (
    includesAny(text, [
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
    ])
  ) {
    return "debug";
  }
  if (
    includesAny(text, [
      "comment",
      "documentation",
      "docs",
      "readme",
      "copy update",
      "주석",
      "문서",
      "설명",
    ])
  ) {
    return "comment";
  }
  return "feature";
}

function criteriaArray(value: unknown) {
  return adaptAcceptanceCriteria(value);
}

function decodeStep(raw: unknown, index: number): StepDraftInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const title = optionalString(source.title);
  const summary = optionalString(source.summary);
  const instructionSeed = optionalString(source.instruction_seed ?? source.instructionSeed);
  if (!title || !summary || !instructionSeed) return null;
  const acceptanceCriteria = criteriaArray(source.acceptance_criteria ?? source.acceptanceCriteria);
  const linkedCriterionIds = stringArray(source.linked_criterion_ids ?? source.linkedCriterionIds);
  const derivedLinkedCriterionIds =
    linkedCriterionIds.length > 0
      ? linkedCriterionIds
      : acceptanceCriteria.map((criterion) => criterion.criterionId);
  const rationale = optionalString(source.rationale ?? source.decomposition_rationale);
  if (derivedLinkedCriterionIds.length === 0 || !rationale) return null;
  const verificationCommand = optionalString(
    source.verification_command ?? source.verificationCommand,
  );
  const expectedFiles = stringArray(source.expected_files ?? source.expectedFiles);
  const stepKind =
    optionalStepKind(source.step_kind ?? source.stepKind) ??
    classifyStepKind({ title, summary, instructionSeed, expectedFiles, acceptanceCriteria });
  return {
    stepId:
      optionalString(source.step_id ?? source.stepId) ??
      `step-${String(index + 1).padStart(3, "0")}`,
    title,
    summary,
    instructionSeed,
    expectedFiles,
    acceptanceCriteria,
    linkedCriterionIds: derivedLinkedCriterionIds,
    rationale,
    stepKind,
    verificationCommand,
    verificationType: optionalVerificationType(
      source.verification_type ?? source.verificationType,
      verificationCommand,
    ),
    dependencies: stringArray(source.dependencies),
    parallelGroup: optionalNumber(source.parallel_group ?? source.parallelGroup),
    position: index + 1,
  };
}

export function decodeWorkspacePlanDraftFromLlm(raw: unknown): LlmPlanDraftPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const payload = (source.plan_draft ?? source.planDraft ?? source) as Record<string, unknown>;
  const planInputRaw = payload.plan_input ?? payload.planInput;
  if (typeof planInputRaw !== "object" || planInputRaw === null) return null;
  const planSource = planInputRaw as Record<string, unknown>;
  const goal = optionalString(planSource.goal);
  const intentSummary =
    optionalString(payload.intent_summary ?? payload.intentSummary) ??
    optionalString(planSource.intent_summary ?? planSource.intentSummary);
  if (!goal || !intentSummary) return null;
  const steps = Array.isArray(planSource.steps)
    ? planSource.steps
        .map((step, index) => decodeStep(step, index))
        .filter((step): step is StepDraftInput => step !== null)
    : [];
  if (steps.length === 0) return null;
  const planInput: PlanDraftInput = {
    goal,
    intentSummary,
    scope: stringArray(planSource.scope),
    nonGoals: stringArray(planSource.non_goals ?? planSource.nonGoals),
    constraints: stringArray(planSource.constraints),
    acceptanceCriteria: criteriaArray(
      planSource.acceptance_criteria ?? planSource.acceptanceCriteria,
    ),
    steps,
  };
  return {
    intentSummary,
    unresolvedQuestions: stringArray(payload.unresolved_questions ?? payload.unresolvedQuestions),
    planInput,
  };
}

interface ParseAssistantJsonResult {
  ok: boolean;
  value: unknown | null;
}

function parseAssistantJson(content: string): ParseAssistantJsonResult {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, value: null };
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fence ? fence[1].trim() : trimmed;
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch {
    const first = source.indexOf("{");
    const last = source.lastIndexOf("}");
    if (first === -1 || last <= first) return { ok: false, value: null };
    try {
      return { ok: true, value: JSON.parse(source.slice(first, last + 1)) };
    } catch {
      return { ok: false, value: null };
    }
  }
}

const PLAN_DRAFT_QUALITY_ERROR_PREFIX = "PLAN_DRAFT_QUALITY_ERROR:";

function isPlanDraftLlmErrorReason(value: unknown): value is PlanDraftLlmErrorReason {
  return (
    value === "length" ||
    value === "invalid_json" ||
    value === "invalid_plan_shape" ||
    value === "vague_criteria" ||
    value === "missing_state_criteria"
  );
}

export function decodePlanDraftQualityError(error: unknown): PlanDraftLlmError | null {
  const content = error instanceof Error ? error.message : String(error);
  const prefixIndex = content.indexOf(PLAN_DRAFT_QUALITY_ERROR_PREFIX);
  if (prefixIndex === -1) return null;
  const encoded = content.slice(prefixIndex + PLAN_DRAFT_QUALITY_ERROR_PREFIX.length).trim();
  try {
    const payload = JSON.parse(encoded) as Record<string, unknown>;
    const reason = payload.reason;
    if (!isPlanDraftLlmErrorReason(reason)) return null;
    const unresolvedQuestions = stringArray(
      payload.unresolved_questions ?? payload.unresolvedQuestions,
    );
    return {
      reason,
      finishReason: null,
      content,
      unresolvedQuestions,
    };
  } catch {
    return null;
  }
}

export function usePlanInterviewLLM({ onPlanDraft, onPlanDraftError }: UsePlanInterviewLlmArgs) {
  const lastHandlerRef = useRef(onPlanDraft);
  const lastErrorHandlerRef = useRef(onPlanDraftError);

  useEffect(() => {
    lastHandlerRef.current = onPlanDraft;
  }, [onPlanDraft]);

  useEffect(() => {
    lastErrorHandlerRef.current = onPlanDraftError;
  }, [onPlanDraftError]);

  return useCallback((event: ObservedEvent) => {
    if (event.type === "assistant_end") {
      const assistantEnd = event as AssistantEndEvent;
      const finishReason = assistantEnd.finish_reason ?? null;
      const parsed = parseAssistantJson(assistantEnd.content);
      const draft = parsed.ok ? decodeWorkspacePlanDraftFromLlm(parsed.value) : null;
      if (draft) {
        lastHandlerRef.current(draft);
        return;
      }
      const reason: PlanDraftLlmErrorReason =
        finishReason === "length" ? "length" : parsed.ok ? "invalid_plan_shape" : "invalid_json";
      lastErrorHandlerRef.current?.({
        reason,
        finishReason,
        content: assistantEnd.content,
      });
    }
  }, []);
}
