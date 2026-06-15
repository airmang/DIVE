// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { useProjectSessionStore } from "../../stores/project-session";
import { PlanDashboardPanel } from "./PlanDashboardPanel";
import type { PlanDashboardProject } from "../../features/roadmap";

const mocks = vi.hoisted(() => ({
  refreshDashboard: vi.fn(),
  openStep: vi.fn(),
  appendStep: vi.fn(),
}));

function project(): PlanDashboardProject {
  return {
    project_id: 42,
    project_name: "DIVE",
    project_path: "/tmp/dive",
    project_updated_at: 10,
    plan_id: 7,
    plan_goal: "Build a PRD-backed roadmap",
    plan_status: "approved",
    step_count: 1,
    ready_count: 1,
    blocked_count: 0,
    active_count: 0,
    done_count: 0,
    shipped_count: 0,
    next_ready_steps: [
      {
        step_db_id: 11,
        stable_step_id: "step-001",
        title: "Persist PRD",
        position: 1,
        status: "ready",
        session_id: null,
        card_id: null,
      },
    ],
    active_steps: [],
    last_activity: null,
    project_spec: {
      projectSpecId: "prd-42",
      projectId: 42,
      currentVersion: 1,
      goal: "Build a PRD-backed roadmap",
      intentSummary: null,
      scope: ["PRD persistence"],
      nonGoals: ["auth"],
      constraints: [],
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
    },
  } as PlanDashboardProject;
}

vi.mock("../../features/roadmap", () => ({
  PLAN_ROADMAP_REFRESH_EVENT: "dive:plan-roadmap-refresh",
  activityEventLabel: (_t: unknown, activity: { message: string }) => activity.message,
  makeRoadmapActionFailure: vi.fn((input) => ({
    action: input.action,
    message: String(input.error),
    projectName: input.projectName,
    stepLabel: input.stepLabel,
  })),
  usePlanDashboard: () => ({
    projects: [project()],
    totals: {
      projects: 1,
      plannedProjects: 1,
      ready: 1,
      active: 0,
      blocked: 0,
    },
    loading: false,
    error: null,
    refresh: mocks.refreshDashboard,
    openStep: mocks.openStep,
  }),
}));

vi.mock("../../features/planning", async () => {
  const actual =
    await vi.importActual<typeof import("../../features/planning")>("../../features/planning");
  return {
    ...actual,
    requestPlanDraftReview: vi.fn(),
    usePlan: () => ({
      appendStep: mocks.appendStep,
      refresh: vi.fn(),
    }),
  };
});

describe("PlanDashboardPanel add-step area", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    useProjectSessionStore.setState({
      currentProjectId: 42,
      selectProject: vi.fn(),
      selectSession: vi.fn(),
      loadAll: vi.fn(),
    });
    mocks.appendStep.mockReset();
    mocks.appendStep.mockResolvedValue({
      id: 12,
      plan_id: 7,
      step_id: "step-002",
      title: "Export mutation data",
      position: 2,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts a dedicated add-step form inside the plan area", () => {
    render(<PlanDashboardPanel />);

    expect(screen.getByTestId("plan-add-step-panel")).toBeTruthy();
    expect(screen.getByTestId("plan-add-step-title")).toBeTruthy();
    expect(screen.getByTestId("plan-add-step-reason")).toBeTruthy();
    expect(screen.getByTestId("plan-add-step-expected-files")).toBeTruthy();
    expect(screen.getByTestId("plan-add-step-prd-delta")).toBeTruthy();
    expect(screen.queryByTestId("chat-input")).toBeNull();
  });

  it("saves with mutation reason, optional criteria link, expected files, and PRD delta preview", async () => {
    render(<PlanDashboardPanel />);

    const panel = screen.getByTestId("plan-add-step-panel");
    fireEvent.change(within(panel).getByTestId("plan-add-step-title"), {
      target: { value: "Export mutation data" },
    });
    fireEvent.change(within(panel).getByTestId("plan-add-step-reason"), {
      target: { value: "Verification found export reconstruction is missing" },
    });
    fireEvent.change(within(panel).getByTestId("plan-add-step-expected-files"), {
      target: { value: "src/workspace_plan/artifacts.rs" },
    });
    fireEvent.click(within(panel).getByTestId("plan-add-step-criterion-AC-001"));
    fireEvent.click(within(panel).getByTestId("plan-add-step-save"));

    await waitFor(() => expect(mocks.appendStep).toHaveBeenCalledTimes(1));
    expect(mocks.appendStep).toHaveBeenCalledWith({
      planId: 7,
      mutationReason: "Verification found export reconstruction is missing",
      linkedCriterionIds: ["AC-001"],
      prdDelta: expect.objectContaining({
        fromVersion: 1,
        toVersion: 2,
        scopeChanges: ["Export mutation data"],
      }),
      draft: expect.objectContaining({
        title: "Export mutation data",
        summary: "Verification found export reconstruction is missing",
        expectedFiles: ["src/workspace_plan/artifacts.rs"],
        linkedCriterionIds: ["AC-001"],
      }),
    });
  });

  it("keeps criterion linking optional without showing a static scope fallback card", () => {
    render(<PlanDashboardPanel />);

    const panel = screen.getByTestId("plan-add-step-panel");
    fireEvent.change(within(panel).getByTestId("plan-add-step-title"), {
      target: { value: "Add auth check" },
    });
    fireEvent.change(within(panel).getByTestId("plan-add-step-reason"), {
      target: { value: "Verification found sign-in behavior is missing" },
    });
    fireEvent.change(within(panel).getByTestId("plan-add-step-expected-files"), {
      target: { value: "src/auth/session.ts" },
    });

    expect(within(panel).getByTestId("plan-add-step-save")).not.toHaveProperty("disabled", true);
    expect(within(panel).getByTestId("plan-add-step-prd-delta").textContent).toContain(
      "Add auth check",
    );
    expect(within(panel).queryByTestId("plan-add-step-scope-card")).toBeNull();
  });
});
