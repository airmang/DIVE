// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProductRecovery } from "./useProductRecovery";

type RecoveryInput = Parameters<typeof useProductRecovery>[0];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function baseInput(overrides: Partial<RecoveryInput> = {}): RecoveryInput {
  return {
    chat: {
      messages: [],
      listCheckpoints: vi.fn().mockResolvedValue([]),
      createCheckpoint: vi.fn().mockResolvedValue(null),
      restoreCheckpoint: vi.fn().mockResolvedValue({ restored_session_state: false }),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
    },
    currentSessionId: 1,
    currentCard: null,
    currentVerifyLog: null,
    currentVerifyState: "idle",
    currentVerifyError: null,
    planAccepted: false,
    activePlanStepIdForChat: undefined,
    onRefreshRoadmap: vi.fn().mockResolvedValue(undefined),
    onVerifyCurrentStep: vi.fn(),
    onRetryError: vi.fn(),
    onOpenPlanInterview: vi.fn(),
    toast: vi.fn().mockReturnValue("toast-id"),
    t: (key: string) => key,
    ...overrides,
  };
}

describe("useProductRecovery checkpoint restore concurrency guard", () => {
  it("exposes a busy restoringCheckpointId and rejects a concurrent restore or save-point until the in-flight restore resolves", async () => {
    const gate = deferred<{ restored_session_state: boolean }>();
    const restoreCheckpoint = vi.fn().mockReturnValue(gate.promise);
    const createCheckpoint = vi.fn().mockResolvedValue(null);
    const listCheckpoints = vi.fn().mockResolvedValue([]);

    const input = baseInput({
      chat: {
        messages: [],
        listCheckpoints,
        createCheckpoint,
        restoreCheckpoint,
        sendUserMessage: vi.fn().mockResolvedValue(undefined),
      },
    });

    const { result } = renderHook(() => useProductRecovery(input));

    await waitFor(() => expect(listCheckpoints).toHaveBeenCalled());
    expect(result.current.restoringCheckpointId).toBeNull();

    let firstRestore: Promise<void> = Promise.resolve();
    act(() => {
      firstRestore = result.current.handleRestoreCheckpoint(1);
    });

    // Busy state is exposed the moment the restore starts.
    expect(result.current.restoringCheckpointId).toBe(1);
    expect(restoreCheckpoint).toHaveBeenCalledTimes(1);
    expect(restoreCheckpoint).toHaveBeenCalledWith(1);

    // A second restore fired while the first is pending must not start a
    // second worktree mutation — it is rejected (no-op), not queued behind it.
    act(() => {
      void result.current.handleRestoreCheckpoint(2);
    });
    expect(restoreCheckpoint).toHaveBeenCalledTimes(1);
    expect(result.current.restoringCheckpointId).toBe(1);

    // A manual checkpoint (save point) mid-restore is blocked too — it would
    // otherwise commit the half-cleared tree the in-flight restore is writing.
    act(() => {
      result.current.handleManualCheckpoint();
    });
    expect(createCheckpoint).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve({ restored_session_state: false });
      await firstRestore;
    });

    // Once the in-flight restore resolves, the guard releases.
    expect(result.current.restoringCheckpointId).toBeNull();

    act(() => {
      void result.current.handleRestoreCheckpoint(2);
    });
    expect(restoreCheckpoint).toHaveBeenCalledWith(2);
  });

  it("releases the guard even when the in-flight restore rejects, so a later restore is not permanently blocked", async () => {
    const gate = deferred<{ restored_session_state: boolean }>();
    const restoreCheckpoint = vi.fn().mockReturnValue(gate.promise);
    const toast = vi.fn().mockReturnValue("toast-id");

    const input = baseInput({
      chat: {
        messages: [],
        listCheckpoints: vi.fn().mockResolvedValue([]),
        createCheckpoint: vi.fn().mockResolvedValue(null),
        restoreCheckpoint,
        sendUserMessage: vi.fn().mockResolvedValue(undefined),
      },
      toast,
    });

    const { result } = renderHook(() => useProductRecovery(input));
    await waitFor(() => expect(input.chat.listCheckpoints).toHaveBeenCalled());

    let firstRestore: Promise<void> = Promise.resolve();
    act(() => {
      firstRestore = result.current.handleRestoreCheckpoint(1);
    });
    expect(result.current.restoringCheckpointId).toBe(1);

    await act(async () => {
      gate.reject(new Error("worktree write failed"));
      await firstRestore;
    });

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(result.current.restoringCheckpointId).toBeNull();

    // The guard was released in `finally`, so a subsequent restore is allowed.
    act(() => {
      void result.current.handleRestoreCheckpoint(2);
    });
    expect(restoreCheckpoint).toHaveBeenCalledWith(2);
  });
});
