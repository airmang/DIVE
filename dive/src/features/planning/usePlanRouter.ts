import { useCallback, useEffect, useState } from "react";
import type { PlanStepRow } from "../roadmap";
import type { StepDraftInput } from "./types";

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
    };

export function usePlanRouter(projectId: number | null) {
  const [api, setApi] = useState<TauriApi | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const route = useCallback(
    async (prompt: string): Promise<RouteDecision> => {
      if (!api || projectId === null) {
        return { action: "skip", reason: "routing unavailable" };
      }
      setBusy(true);
      setError(null);
      try {
        return await api.invoke<RouteDecision>("workspace_plan_route_chat", {
          projectId,
          prompt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [api, projectId],
  );

  const appendStep = useCallback(
    async (planId: number, draft: StepDraftInput): Promise<PlanStepRow> => {
      if (!api) throw new Error("Tauri IPC unavailable");
      setBusy(true);
      setError(null);
      try {
        return await api.invoke<PlanStepRow>("workspace_plan_append_step", {
          planId,
          draft,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  return {
    route,
    appendStep,
    busy,
    error,
  };
}
