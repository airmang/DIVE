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

/** S-050 D4: machine-coded issue codes the Rust gate can emit. Kept as a
 *  union for the known set the recovery UI has copy for; `decodeIssues`
 *  still accepts and passes through unrecognized codes so a future backend
 *  addition degrades gracefully instead of being dropped. */
export type PlanDraftQualityIssueCode =
  | "criteria_empty"
  | "criterion_too_short"
  | "criterion_vague_filler"
  | "plan_no_marker"
  | "step_unverifiable"
  | "missing_state_class";

export interface PlanDraftQualityIssue {
  code: PlanDraftQualityIssueCode | (string & {});
  preview?: string;
  stepRef?: string;
  missingClass?: string;
}

export interface PlanDraftLlmError {
  reason: PlanDraftLlmErrorReason;
  finishReason: string | null;
  content: string;
  unresolvedQuestions?: string[];
  issues?: PlanDraftQualityIssue[];
}

/** Signature-compatible with `useT()`'s return value, without importing it
 *  here (this module has no React dependency otherwise). */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

const MARKER_ISSUE_CODES = new Set([
  "criteria_empty",
  "criterion_too_short",
  "criterion_vague_filler",
  "plan_no_marker",
  "step_unverifiable",
]);

/** S-050 D4: renders each backend issue code into a localized line via
 *  `planning.interview.recovery.issue.<code>`. Unknown codes fall back to
 *  whatever text the backend attached (preview/stepRef/missingClass, else
 *  the raw code) instead of throwing or being silently dropped. */
export function buildIssueLines(issues: PlanDraftQualityIssue[], t: Translate): string[] {
  return issues.map((issue) => {
    switch (issue.code) {
      case "criteria_empty":
      case "plan_no_marker":
        return t(`planning.interview.recovery.issue.${issue.code}`);
      case "criterion_too_short":
      case "criterion_vague_filler":
        return t(`planning.interview.recovery.issue.${issue.code}`, {
          preview: issue.preview ?? "",
        });
      case "step_unverifiable":
        return t("planning.interview.recovery.issue.step_unverifiable", {
          step: issue.stepRef ?? "",
        });
      case "missing_state_class": {
        const classKey = issue.missingClass ?? "";
        const className = t(`planning.interview.recovery.class.${classKey}`);
        return t("planning.interview.recovery.issue.missing_state_class", {
          class: className,
        });
      }
      default:
        return issue.preview ?? issue.stepRef ?? issue.missingClass ?? issue.code;
    }
  });
}

/** S-050 D4: the self-passing example strings relevant to the issue codes
 *  present on this error, deduped and in a stable order (marker examples
 *  first, then one class example per distinct missing class). Feeds both
 *  the recovery screen's examples block and the retry-prompt feedback. */
export function collectRecoveryExamples(issues: PlanDraftQualityIssue[], t: Translate): string[] {
  const examples: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const value = t(`planning.interview.recovery.examples.${key}`);
    if (value) examples.push(value);
  };

  if (issues.some((issue) => MARKER_ISSUE_CODES.has(issue.code))) {
    push("marker_click");
    push("marker_count");
  }
  for (const issue of issues) {
    if (issue.code === "missing_state_class" && issue.missingClass) {
      push(`class_${issue.missingClass}`);
    }
  }
  return examples;
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

/** S-050 D4: the `issues` array is additive on top of the pre-existing
 *  `unresolved_questions` payload — a malformed or missing entry is dropped
 *  rather than failing the whole decode, so an older backend build (no
 *  `issues` field at all) still decodes exactly as before. */
function decodeIssues(raw: unknown): PlanDraftQualityIssue[] {
  if (!Array.isArray(raw)) return [];
  const issues: PlanDraftQualityIssue[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const source = entry as Record<string, unknown>;
    const code = optionalString(source.code);
    if (!code) continue;
    issues.push({
      code: code as PlanDraftQualityIssue["code"],
      preview: optionalString(source.preview) ?? undefined,
      stepRef: optionalString(source.step_ref ?? source.stepRef) ?? undefined,
      missingClass: optionalString(source.missing_class ?? source.missingClass) ?? undefined,
    });
  }
  return issues;
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
    const issues = decodeIssues(payload.issues);
    return {
      reason,
      finishReason: null,
      content,
      unresolvedQuestions,
      ...(issues.length > 0 ? { issues } : {}),
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
