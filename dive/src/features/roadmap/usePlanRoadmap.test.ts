// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlanRoadmap } from "./usePlanRoadmap";
import type { WorkspacePlanStatus } from "../planning";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => path,
}));

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function planStatus(overrides: Partial<WorkspacePlanStatus>): WorkspacePlanStatus {
  return {
    status: "needs_prd",
    has_plan: false,
    has_approved_plan: false,
    plan_summary: null,
    plan_id: null,
    step_count: 0,
    ready_count: 0,
    blocked_count: 0,
    active_count: 0,
    done_count: 0,
    prd_status: null,
    ...overrides,
  };
}

describe("usePlanRoadmap refresh race", () => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
    mocks.invoke.mockReset();
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  it("ignores a stale refresh response after the project changes mid-flight (useplan-stale-project-race)", async () => {
    type Resolver = (value: unknown) => void;
    const planResolvers = new Map<number, Resolver>();

    mocks.invoke.mockImplementation((cmd: string, args?: { projectId?: number }) => {
      if (cmd === "workspace_plan_status") {
        const projectId = args?.projectId as number;
        return new Promise((resolve) => planResolvers.set(projectId, resolve));
      }
      // has_plan is false for every status this test resolves, so the hook
      // never reaches workspace_plan_list_steps / workspace_plan_step_mappings.
      throw new Error(`unexpected command ${cmd}`);
    });

    const { result, rerender } = renderHook(({ projectId }) => usePlanRoadmap(projectId), {
      initialProps: { projectId: 1 },
    });

    await waitFor(() => expect(planResolvers.has(1)).toBe(true));

    // Switch projects before project 1's in-flight refresh resolves.
    rerender({ projectId: 2 });
    await waitFor(() => expect(planResolvers.has(2)).toBe(true));

    // The current project's (2) response resolves first.
    await act(async () => {
      planResolvers.get(2)!(planStatus({ status: "ready_project_2" }));
    });
    await waitFor(() => expect(result.current.status?.status).toBe("ready_project_2"));

    // The superseded project's (1) response arrives late — it must not stomp
    // project 2's already-applied state.
    await act(async () => {
      planResolvers.get(1)!(planStatus({ status: "stale_project_1" }));
      // Give the (would-be) stale `.then` continuation a couple of
      // microtask/macrotask turns to run before asserting nothing changed.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.status?.status).toBe("ready_project_2");
  });
});
