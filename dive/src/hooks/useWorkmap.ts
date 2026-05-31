import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkmapStore } from "../stores/workmap";
import type { CardState, CardTileData } from "../components/workmap/types";
import type { ApprovalDecisionWithTime } from "../components/workmap/ApprovalJudgment";
import type { CardTransitionKind } from "../stores/workmap";
import type { VerifyLogView } from "../components/workmap/types";
import type { ChangedFile } from "../components/slide-in/types";

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

interface CardRow {
  id: number;
  session_id: number;
  title: string;
  instruction: string | null;
  assist_summary?: string | null;
  acceptance_criteria?: string | null;
  retrospective?: string | null;
  change_summary?: string | null;
  state: CardState;
  verify_log: string | null;
  changed_files: unknown | null;
  test_command: string | null;
  approval_judgment?: string | null;
  position: number;
  created_at: number;
  updated_at: number;
}

interface WorkmapSnapshot {
  cards: CardRow[];
  current_card_id: number | null;
}

interface CardToolCallStats {
  count: number;
}

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return { invoke: core.invoke as TauriApi["invoke"] };
}

function toTile(row: CardRow): CardTileData {
  return {
    id: row.id,
    title: row.title,
    summary: row.instruction,
    assistSummary: row.assist_summary ?? null,
    acceptanceCriteria: row.acceptance_criteria ?? null,
    retrospective: row.retrospective ?? null,
    changeSummary: row.change_summary ?? null,
    testCommand: row.test_command,
    state: row.state,
    position: row.position,
  };
}

function parseVerifyLog(row: CardRow | undefined): VerifyLogView | null {
  if (!row?.verify_log) return null;
  try {
    return JSON.parse(row.verify_log) as VerifyLogView;
  } catch {
    return null;
  }
}

function parseChangedFiles(row: CardRow | undefined): ChangedFile[] {
  if (!row || !Array.isArray(row.changed_files)) return [];
  return row.changed_files.flatMap((item): ChangedFile[] => {
    if (typeof item === "string") {
      return [
        {
          path: item,
          diff: {
            path: item,
            before: "",
            after: "",
          },
        },
      ];
    }
    if (!item || typeof item !== "object") return [];
    const candidate = item as {
      path?: unknown;
      diff?: {
        path?: unknown;
        before?: unknown;
        after?: unknown;
      };
    };
    if (typeof candidate.path !== "string") return [];
    const diff = candidate.diff;
    return [
      {
        path: candidate.path,
        diff: {
          path: typeof diff?.path === "string" ? diff.path : candidate.path,
          before: typeof diff?.before === "string" ? diff.before : "",
          after: typeof diff?.after === "string" ? diff.after : "",
        },
      },
    ];
  });
}

export function useWorkmap(sessionId: number | null) {
  const hydrateFromRemote = useWorkmapStore((s) => s.hydrateFromRemote);
  const clearLocal = useWorkmapStore((s) => s.clearLocal);
  const cards = useWorkmapStore((s) => s.cards);
  const currentCardId = useWorkmapStore((s) => s.currentCardId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [api, setApi] = useState<TauriApi | null>(null);
  const [rowsById, setRowsById] = useState<Map<number, CardRow>>(new Map());
  const [toolCallCounts, setToolCallCounts] = useState<Map<number, number>>(new Map());
  const [verifyRunningCardId, setVerifyRunningCardId] = useState<number | null>(null);
  const [verifyErrorByCard, setVerifyErrorByCard] = useState<Map<number, string>>(new Map());
  const generation = useRef(0);

  useEffect(() => {
    void loadTauri().then(setApi);
  }, []);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (sessionId === null) {
      clearLocal();
      setRowsById(new Map());
      setToolCallCounts(new Map());
      setError(null);
      return;
    }
    if (!api) {
      clearLocal();
      setRowsById(new Map());
      setToolCallCounts(new Map());
      setError("Tauri runtime unavailable");
      return;
    }
    setLoading(true);
    try {
      const snapshot = await api.invoke<WorkmapSnapshot>("workmap_get", { sessionId });
      if (generation.current !== requestGeneration) return;
      hydrateFromRemote(snapshot.cards.map(toTile), snapshot.current_card_id);
      setRowsById(new Map(snapshot.cards.map((row) => [row.id, row])));
      const counts = await Promise.all(
        snapshot.cards.map(async (row) => {
          const stats = await api.invoke<CardToolCallStats>("card_tool_call_stats", {
            cardId: row.id,
          });
          return [row.id, stats.count] as const;
        }),
      );
      if (generation.current !== requestGeneration) return;
      setToolCallCounts(new Map(counts));
      setError(null);
    } catch (err) {
      if (generation.current !== requestGeneration) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, [api, clearLocal, hydrateFromRemote, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requireApi = useCallback(() => {
    if (!api) throw new Error("Tauri runtime unavailable");
    if (sessionId === null) throw new Error("No active session");
    return api;
  }, [api, sessionId]);

  const createCard = useCallback(
    async (
      title: string,
      position?: number | null,
      metadata?: {
        summary?: string | null;
        acceptanceCriteria?: string | null;
        instructionSeed?: string | null;
      },
    ) => {
      const activeApi = requireApi();
      const row = await activeApi.invoke<CardRow>("card_create", {
        sessionId,
        title,
        position: position ?? null,
        summary: metadata?.summary ?? null,
        acceptanceCriteria: metadata?.acceptanceCriteria ?? null,
        instructionSeed: metadata?.instructionSeed ?? null,
      });
      await refresh();
      return row;
    },
    [refresh, requireApi, sessionId],
  );

  const setCurrentCardRemote = useCallback(
    async (cardId: number | null) => {
      const activeApi = requireApi();
      await activeApi.invoke<void>("workmap_set_current_card", { sessionId, cardId });
      await refresh();
    },
    [refresh, requireApi, sessionId],
  );

  const updateInstructionRemote = useCallback(
    async (cardId: number, instruction: string) => {
      const activeApi = requireApi();
      await activeApi.invoke<CardState>("card_update_instruction", { cardId, instruction });
      await refresh();
    },
    [refresh, requireApi],
  );

  const updateTestCommandRemote = useCallback(
    async (cardId: number, testCommand: string) => {
      const activeApi = requireApi();
      await activeApi.invoke<void>("card_update_test_command", {
        cardId,
        testCommand: testCommand.trim().length > 0 ? testCommand : null,
      });
      await refresh();
    },
    [refresh, requireApi],
  );

  const saveRetrospectiveRemote = useCallback(
    async (cardId: number, retrospective: string) => {
      const activeApi = requireApi();
      await activeApi.invoke<void>("card_save_retrospective", { cardId, retrospective });
      await refresh();
    },
    [refresh, requireApi],
  );

  const transitionCardRemote = useCallback(
    async (
      cardId: number,
      transition: CardTransitionKind,
      options?: { approveForce?: boolean; judgment?: ApprovalDecisionWithTime },
    ) => {
      const activeApi = requireApi();
      await activeApi.invoke<CardState>("card_transition", {
        cardId,
        transition,
        approveForce: options?.approveForce ?? false,
        judgment: options?.judgment ?? null,
      });
      await refresh();
    },
    [refresh, requireApi],
  );

  const verifyRemote = useCallback(
    async (cardId: number) => {
      const activeApi = requireApi();
      setVerifyRunningCardId(cardId);
      setVerifyErrorByCard((prev) => {
        const next = new Map(prev);
        next.delete(cardId);
        return next;
      });
      try {
        await activeApi.invoke<VerifyLogView>("card_verify", { sessionId, cardId });
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setVerifyErrorByCard((prev) => new Map(prev).set(cardId, message));
        throw err;
      } finally {
        setVerifyRunningCardId(null);
      }
    },
    [refresh, requireApi, sessionId],
  );

  const deleteCard = useCallback(
    async (cardId: number) => {
      const activeApi = requireApi();
      await activeApi.invoke<void>("card_delete", { cardId });
      await refresh();
    },
    [refresh, requireApi],
  );

  const reorderCards = useCallback(
    async (orderedIds: number[]) => {
      const activeApi = requireApi();
      await activeApi.invoke<void>("card_reorder", { sessionId, orderedIds });
      await refresh();
    },
    [refresh, requireApi, sessionId],
  );

  return {
    cards,
    currentCardId,
    loading,
    error,
    refresh,
    createCard,
    setCurrentCardRemote,
    updateInstructionRemote,
    updateTestCommandRemote,
    saveRetrospectiveRemote,
    transitionCardRemote,
    verifyRemote,
    deleteCard,
    reorderCards,
    verifyLogFor: (cardId: number) => parseVerifyLog(rowsById.get(cardId)),
    changedFilesFor: (cardId: number) => parseChangedFiles(rowsById.get(cardId)),
    toolCallCountFor: (cardId: number) => toolCallCounts.get(cardId) ?? 0,
    verifyStateFor: (cardId: number): "idle" | "running" | "error" => {
      if (verifyRunningCardId === cardId) return "running";
      if (verifyErrorByCard.has(cardId)) return "error";
      return "idle";
    },
    verifyErrorFor: (cardId: number) => verifyErrorByCard.get(cardId) ?? null,
  };
}
