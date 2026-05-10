import { useCallback, useEffect, useRef } from "react";
import type { LlmPlanDraftPayload, PlanDraftInput, StepDraftInput } from "./types";

interface AssistantEndEvent {
  type: "assistant_end";
  content: string;
}

type ObservedEvent = AssistantEndEvent | { type: string };

interface UsePlanInterviewLlmArgs {
  onPlanDraft: (payload: LlmPlanDraftPayload) => void;
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

function decodeStep(raw: unknown, index: number): StepDraftInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const title = optionalString(source.title);
  const summary = optionalString(source.summary);
  const instructionSeed = optionalString(source.instruction_seed ?? source.instructionSeed);
  if (!title || !summary || !instructionSeed) return null;
  return {
    stepId: optionalString(source.step_id ?? source.stepId) ?? `step-${String(index + 1).padStart(3, "0")}`,
    title,
    summary,
    instructionSeed,
    expectedFiles: stringArray(source.expected_files ?? source.expectedFiles),
    acceptanceCriteria: stringArray(source.acceptance_criteria ?? source.acceptanceCriteria),
    verificationCommand: optionalString(source.verification_command ?? source.verificationCommand),
    verificationType: optionalString(source.verification_type ?? source.verificationType),
    dependencies: stringArray(source.dependencies),
    parallelGroup: optionalNumber(source.parallel_group ?? source.parallelGroup),
    position: index + 1,
  };
}

export function decodeWorkspacePlanDraftFromLlm(raw: unknown): LlmPlanDraftPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const payload = (source.plan_draft ?? source) as Record<string, unknown>;
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
    acceptanceCriteria: stringArray(
      planSource.acceptance_criteria ?? planSource.acceptanceCriteria,
    ),
    steps,
  };
  return {
    intentSummary,
    unresolvedQuestions: stringArray(
      payload.unresolved_questions ?? payload.unresolvedQuestions,
    ),
    planInput,
  };
}

function parseAssistantJson(content: string): unknown | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(source);
  } catch {
    const first = source.indexOf("{");
    const last = source.lastIndexOf("}");
    if (first === -1 || last <= first) return null;
    try {
      return JSON.parse(source.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

export function usePlanInterviewLLM({ onPlanDraft }: UsePlanInterviewLlmArgs) {
  const lastHandlerRef = useRef(onPlanDraft);

  useEffect(() => {
    lastHandlerRef.current = onPlanDraft;
  }, [onPlanDraft]);

  return useCallback((event: ObservedEvent) => {
    if (event.type === "assistant_end") {
      const draft = decodeWorkspacePlanDraftFromLlm(parseAssistantJson((event as AssistantEndEvent).content));
      if (draft) {
        lastHandlerRef.current(draft);
      }
    }
  }, []);
}
