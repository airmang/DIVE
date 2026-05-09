import { useCallback, useEffect, useRef } from "react";
import type { PlanDraft } from "./types";

interface LlmPlanDraftPayload {
  goal?: unknown;
  mvp?: unknown;
  non_goals?: unknown;
  steps?: unknown;
  success_criteria?: unknown;
  risks?: unknown;
}

interface LlmStep {
  name?: unknown;
  intent?: unknown;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function toLlmSteps(value: unknown): LlmStep[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is LlmStep => typeof v === "object" && v !== null) as LlmStep[];
}

export function decodePlanDraftFromLlm(raw: unknown): PlanDraft | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as LlmPlanDraftPayload;
  const goal = typeof source.goal === "string" ? source.goal.trim() : "";
  const mvp = typeof source.mvp === "string" ? source.mvp.trim() : "";
  if (!goal || !mvp) return null;
  const rawSteps = toLlmSteps(source.steps);
  const steps = rawSteps
    .map((step) => {
      const title = typeof step.name === "string" ? step.name.trim() : "";
      const intent = typeof step.intent === "string" ? step.intent.trim() : "";
      if (!title || !intent) return null;
      return {
        title,
        summary: intent,
        acceptanceCriteria: [] as string[],
        instructionSeed: intent,
      };
    })
    .filter((step): step is NonNullable<typeof step> => step !== null);
  if (steps.length === 0) return null;
  return {
    goal,
    mvp,
    nonGoals: toStringArray(source.non_goals),
    steps,
    successCriteria: toStringArray(source.success_criteria),
    brief: {
      goal,
      answers: [],
      createdAt: Date.now(),
    },
  };
}

interface ToolCallStartEvent {
  type: "tool_call_start";
  id: string;
  tool: string;
}

interface ToolResultEvent {
  type: "tool_result";
  call_id: string;
  success: boolean;
  full: unknown;
}

type ObservedEvent = ToolCallStartEvent | ToolResultEvent | { type: string };

interface UsePlanInterviewLlmArgs {
  onPlanDraft: (draft: PlanDraft) => void;
}

export function usePlanInterviewLLM({ onPlanDraft }: UsePlanInterviewLlmArgs) {
  const pendingCallsRef = useRef<Set<string>>(new Set());
  const lastHandlerRef = useRef(onPlanDraft);

  useEffect(() => {
    lastHandlerRef.current = onPlanDraft;
  }, [onPlanDraft]);

  return useCallback((event: ObservedEvent) => {
    if (event.type === "tool_call_start") {
      const start = event as ToolCallStartEvent;
      if (start.tool === "emit_plan_draft") {
        pendingCallsRef.current.add(start.id);
      }
      return;
    }
    if (event.type === "tool_result") {
      const result = event as ToolResultEvent;
      if (!pendingCallsRef.current.delete(result.call_id)) return;
      if (!result.success) return;
      const full = result.full;
      if (typeof full !== "object" || full === null) return;
      const draftPayload = (full as { plan_draft?: unknown }).plan_draft;
      const draft = decodePlanDraftFromLlm(draftPayload);
      if (draft) {
        lastHandlerRef.current(draft);
      }
    }
  }, []);
}
