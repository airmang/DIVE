import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanStepRow } from "../roadmap";
import type { ProjectSpecDelta, StepDraftInput } from "./types";

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return { invoke: core.invoke as TauriApi["invoke"] };
}

export interface StepRefPayload {
  stepId: string;
  dbId: number;
  title: string;
}

export type RouteDecision =
  | {
      action: "add_step";
      draft: StepDraftInput;
      reason: string;
    }
  | {
      action: "chat";
      reason: string;
    }
  | {
      action: "skip";
      reason: string;
    }
  // S-033 plan-mutation routing. The backend does not emit these until the
  // per-outcome phases land their apply path + consumer; until then the chat
  // route handler treats any non-add_step action as normal chat.
  | {
      action: "clarify";
      question: string;
      candidateIntent: string;
      suggestedCriterionIds: string[];
      reason: string;
    }
  | {
      action: "remove_step";
      target: StepRefPayload;
      reason: string;
    }
  | {
      action: "supersede_step";
      target: StepRefPayload;
      replacement: StepDraftInput;
      reason: string;
    };

export function usePlanRouter(projectId: number | null) {
  const [api, setApi] = useState<TauriApi | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [appendBusy, setAppendBusy] = useState(false);
  const [routeStartedAt, setRouteStartedAt] = useState<number | null>(null);
  const [routeCancelRequested, setRouteCancelRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const route = useCallback(
    async (prompt: string): Promise<RouteDecision> => {
      if (!api || projectId === null) {
        return { action: "skip", reason: "routing unavailable" };
      }
      const routeRequestId = `route-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      requestIdRef.current = routeRequestId;
      setRouteBusy(true);
      setRouteStartedAt(Date.now());
      setRouteCancelRequested(false);
      setError(null);
      try {
        return await api.invoke<RouteDecision>("workspace_plan_route_chat", {
          projectId,
          prompt,
          routeRequestId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        if (requestIdRef.current === routeRequestId) {
          requestIdRef.current = null;
          setRouteBusy(false);
          setRouteStartedAt(null);
          setRouteCancelRequested(false);
        }
      }
    },
    [api, projectId, requestIdRef],
  );

  const cancelRoute = useCallback(async () => {
    if (!api || !requestIdRef.current) return;
    setRouteCancelRequested(true);
    try {
      await api.invoke<void>("workspace_plan_route_cancel", {
        routeRequestId: requestIdRef.current,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api, requestIdRef]);

  const appendStep = useCallback(
    async (
      planId: number,
      draft: StepDraftInput,
      options: {
        mutationReason?: string | null;
        linkedCriterionIds?: string[];
        prdDelta?: ProjectSpecDelta | null;
      } = {},
    ): Promise<PlanStepRow> => {
      if (!api) throw new Error("Tauri IPC unavailable");
      const linkedCriterionIds = options.linkedCriterionIds ?? draft.linkedCriterionIds;
      setAppendBusy(true);
      setError(null);
      try {
        return await api.invoke<PlanStepRow>("workspace_plan_append_step", {
          planId,
          draft: {
            ...draft,
            linkedCriterionIds,
          },
          mutationReason: options.mutationReason ?? null,
          linkedCriterionIds,
          prdDelta: options.prdDelta ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setAppendBusy(false);
      }
    },
    [api],
  );

  return {
    route,
    appendStep,
    cancelRoute,
    busy: routeBusy || appendBusy,
    routeBusy,
    appendBusy,
    routeStartedAt,
    routeCancelRequested,
    error,
  };
}
