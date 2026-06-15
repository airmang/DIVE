// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveProjectSpecDraft } from "./projectSpec";
import { usePlan } from "./usePlan";
import type { ProjectSpec, PrdPatch, StepDraftInput } from "./types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function savedSpec(): ProjectSpec {
  return {
    projectSpecId: "prd-42",
    projectId: 42,
    currentVersion: 1,
    goal: "Build a PRD board",
    intentSummary: "Author the PRD before decomposition.",
    scope: ["PRD authoring"],
    nonGoals: ["Add-step mutation"],
    constraints: ["Local-first EventLog"],
    acceptanceCriteria: [
      {
        criterionId: "AC-001",
        text: "Saved PRD unlocks plan generation",
        source: "student_edit",
        status: "active",
        createdInVersion: 1,
        retiredInVersion: null,
      },
    ],
    status: "draft",
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("usePlan PRD IPC methods", () => {
  beforeEach(() => {
    window.__TAURI_INTERNALS__ = {};
    mocks.invoke.mockReset();
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "workspace_plan_status") {
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
          prd_status: {
            status: "draft",
            project_spec_id: null,
            current_version: null,
            draft_id: "draft-42",
          },
        };
      }
      if (cmd === "workspace_prd_status") {
        return {
          status: "draft",
          projectSpecId: null,
          currentVersion: null,
          draftId: "draft-42",
        };
      }
      if (cmd === "workspace_prd_get") {
        return savedSpec();
      }
      if (cmd === "workspace_prd_interview_turn") {
        const patch: PrdPatch = {
          patchId: "patch-1",
          sourceTurnId: "turn-1",
          rationale: "Student answer supplied a criterion.",
          operations: [{ op: "append_acceptance_criterion", text: "Canvas updates live" }],
        };
        return {
          turnId: "turn-1",
          assistantMessage: "PRD 초안에 반영했어요.",
          patch,
          validationOutcome: "applied",
          appliedFieldPaths: ["acceptanceCriteria"],
          rejectedReasons: [],
          liveDraft: createLiveProjectSpecDraft(42, {
            draftId: "draft-42",
            goal: "Build a PRD board",
            acceptanceCriteria: ["Canvas updates live"],
            dirtyFields: ["acceptanceCriteria"],
          }),
        };
      }
      if (cmd === "workspace_prd_save") {
        return savedSpec();
      }
      if (cmd === "workspace_plan_challenge_step_rationale") {
        return {
          objectionId: "obj-001",
          suggestionStatus: "offered",
          offerId: "offer-001",
          offerKind: "adjust_plan",
          message: "현재 계획 영역에서 이 단계를 다시 조정해볼 수 있어요.",
        };
      }
      if (cmd === "workspace_plan_append_step") {
        return {
          id: 12,
          plan_id: 7,
          step_id: "step-002",
          title: "Export mutation data",
          summary: "Verification found export reconstruction is missing",
          instruction_seed: "Add export reconstruction.",
          expected_files: ["src/workspace_plan/artifacts.rs"],
          acceptance_criteria: null,
          verification_kind: "manual",
          verification_command: null,
          verification_manual_check: null,
          dependencies: [],
          parallel_group: null,
          position: 2,
          created_at: 1,
          updated_at: 2,
        };
      }
      throw new Error(`unexpected command ${cmd}`);
    });
  });

  afterEach(() => {
    delete window.__TAURI_INTERNALS__;
  });

  it("normalizes PRD draft status alongside workspace plan status", async () => {
    const { result } = renderHook(() => usePlan(42));

    await waitFor(() => expect(result.current.status?.status).toBe("needs_prd"));
    await waitFor(() => expect(result.current.prdStatus?.status).toBe("draft"));
    expect(result.current.prdStatus?.draftId).toBe("draft-42");
  });

  it("invokes PRD get, interview-turn, and save methods with project context", async () => {
    const { result } = renderHook(() => usePlan(42));
    await waitFor(() => expect(result.current.prdStatus?.status).toBe("draft"));

    await expect(result.current.getProjectSpec()).resolves.toMatchObject({
      projectSpecId: "prd-42",
      currentVersion: 1,
    });

    await expect(
      result.current.submitPrdInterviewTurn({
        draftId: "draft-42",
        answer: "It should update the canvas.",
        provider: "openai",
        model: "gpt-5.4",
      }),
    ).resolves.toMatchObject({
      validationOutcome: "applied",
      appliedFieldPaths: ["acceptanceCriteria"],
    });

    await act(async () => {
      await result.current.saveProjectSpec(savedSpec(), "interview");
    });

    expect(mocks.invoke).toHaveBeenCalledWith("workspace_prd_get", { projectId: 42 });
    expect(mocks.invoke).toHaveBeenCalledWith("workspace_prd_interview_turn", {
      projectId: 42,
      draftId: "draft-42",
      answer: "It should update the canvas.",
      provider: "openai",
      model: "gpt-5.4",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("workspace_prd_save", {
      projectId: 42,
      spec: savedSpec(),
      reason: "interview",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("workspace_prd_status", { projectId: 42 });
  });

  it("returns rationale challenge offer fields and refreshes status", async () => {
    const { result } = renderHook(() => usePlan(42));
    await waitFor(() => expect(result.current.prdStatus?.status).toBe("draft"));
    const planStatusCallsBefore = mocks.invoke.mock.calls.filter(
      ([cmd]) => cmd === "workspace_plan_status",
    ).length;
    const prdStatusCallsBefore = mocks.invoke.mock.calls.filter(
      ([cmd]) => cmd === "workspace_prd_status",
    ).length;

    const challengeResult = await act(async () =>
      result.current.challengeStepRationale({
        planId: 7,
        stepDbId: 11,
        text: "이 단계가 AC-001과 직접 연결되는지 다시 보고 싶어요.",
        linkedCriterionIds: ["AC-001"],
      }),
    );
    expect(challengeResult.objectionId).toBe("obj-001");
    expect(challengeResult.suggestionStatus).toBe("offered");
    expect(challengeResult.offerId).toBe("offer-001");
    expect(challengeResult.offerKind).toBe("adjust_plan");
    expect(challengeResult.message).toBe("현재 계획 영역에서 이 단계를 다시 조정해볼 수 있어요.");

    expect(mocks.invoke).toHaveBeenCalledWith("workspace_plan_challenge_step_rationale", {
      input: {
        planId: 7,
        stepDbId: 11,
        text: "이 단계가 AC-001과 직접 연결되는지 다시 보고 싶어요.",
        linkedCriterionIds: ["AC-001"],
      },
    });
    expect(
      mocks.invoke.mock.calls.filter(([cmd]) => cmd === "workspace_plan_status").length,
    ).toBeGreaterThan(planStatusCallsBefore);
    expect(
      mocks.invoke.mock.calls.filter(([cmd]) => cmd === "workspace_prd_status").length,
    ).toBeGreaterThan(prdStatusCallsBefore);
  });

  it("invokes append-step with mutation metadata and refreshes PRD status", async () => {
    const { result } = renderHook(() => usePlan(42));
    await waitFor(() => expect(result.current.prdStatus?.status).toBe("draft"));

    const draft: StepDraftInput = {
      stepId: "ignored-by-append",
      title: "Export mutation data",
      summary: "Verification found export reconstruction is missing",
      instructionSeed: "Add export reconstruction.",
      expectedFiles: ["src/workspace_plan/artifacts.rs"],
      acceptanceCriteria: [],
      linkedCriterionIds: ["AC-001"],
      rationale: "The export step preserves AC-001 evidence after mutation.",
      verificationCommand: null,
      verificationType: "manual",
      dependencies: [],
      parallelGroup: null,
      position: 99,
    };

    await act(async () => {
      await result.current.appendStep({
        planId: 7,
        draft,
        mutationReason: "Verification found export reconstruction is missing",
        linkedCriterionIds: ["AC-001"],
        prdDelta: {
          fromVersion: 1,
          toVersion: 2,
          addedCriteria: [],
          retiredCriterionIds: [],
          scopeChanges: ["Export mutation data"],
          nonGoalChanges: [],
        },
      });
    });

    expect(mocks.invoke).toHaveBeenCalledWith("workspace_plan_append_step", {
      planId: 7,
      draft,
      mutationReason: "Verification found export reconstruction is missing",
      linkedCriterionIds: ["AC-001"],
      prdDelta: {
        fromVersion: 1,
        toVersion: 2,
        addedCriteria: [],
        retiredCriterionIds: [],
        scopeChanges: ["Export mutation data"],
        nonGoalChanges: [],
      },
    });
    expect(mocks.invoke).toHaveBeenCalledWith("workspace_prd_status", { projectId: 42 });
  });
});
