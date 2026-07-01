// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { ProjectSpec } from "../../features/planning";
import { FinalPrdReadView } from "./FinalPrdReadView";

function spec(): ProjectSpec {
  return {
    projectSpecId: "prd-42",
    projectId: 42,
    currentVersion: 2,
    goal: "Build a PRD-first plan handoff",
    intentSummary: "Students review the saved PRD before creating a plan.",
    scope: ["PRD authoring board", "Final read view"],
    nonGoals: ["Criterion-linked decomposition", "Add-step mutation"],
    constraints: ["Local-first EventLog", "No wizard"],
    acceptanceCriteria: [
      {
        criterionId: "AC-001",
        text: "Saved PRD shows a concise read view",
        source: "interview",
        status: "active",
        createdInVersion: 1,
        retiredInVersion: null,
      },
      {
        criterionId: "AC-002",
        text: "Create Plan starts from the saved PRD",
        source: "student_edit",
        status: "active",
        createdInVersion: 2,
        retiredInVersion: null,
      },
    ],
    architecture: {
      form: "web_app",
      formOtherLabel: null,
      stack: "React + Vite",
      rationale: "Runs in the browser with no install.",
      decisionSource: "student_confirmed",
      decidedInVersion: 2,
    },
    status: "draft",
    createdAt: 1,
    updatedAt: 2,
  };
}

function renderView(overrides: Partial<Parameters<typeof FinalPrdReadView>[0]> = {}) {
  const props: Parameters<typeof FinalPrdReadView>[0] = {
    projectName: "DIVE",
    projectSpec: spec(),
    planActionLabel: "Create Plan",
    onEdit: vi.fn(),
    onCreatePlan: vi.fn(),
    onOpenHistory: vi.fn(),
    ...overrides,
  };
  render(<FinalPrdReadView {...props} />);
  return props;
}

describe("FinalPrdReadView", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
  });

  afterEach(() => cleanup());

  it("shows concise saved PRD content and version metadata", () => {
    renderView();

    expect(screen.getByTestId("final-prd-read-view")).toBeTruthy();
    expect(screen.getByText("Build a PRD-first plan handoff")).toBeTruthy();
    expect(screen.getByText("AC-001")).toBeTruthy();
    expect(screen.getByText("Saved PRD shows a concise read view")).toBeTruthy();
    expect(screen.getByText("PRD v2")).toBeTruthy();
    expect(screen.getByText("Final read view")).toBeTruthy();
    expect(screen.getByText("No wizard")).toBeTruthy();
  });

  it("shows the decided architecture form and stack", () => {
    renderView();

    expect(screen.getByTestId("final-prd-architecture")).toBeTruthy();
    expect(screen.getByTestId("final-prd-architecture-form").textContent).toBe("Web app");
    expect(screen.getByTestId("final-prd-architecture-stack").textContent).toBe("React + Vite");
    expect(screen.getByText("Runs in the browser with no install.")).toBeTruthy();
  });

  it("omits the architecture block when none is decided", () => {
    renderView({ projectSpec: { ...spec(), architecture: null } });

    expect(screen.queryByTestId("final-prd-architecture")).toBeNull();
  });

  it("does not render authoring-only rail, patch status, validation, or inline controls", () => {
    renderView();

    expect(screen.queryByTestId("prd-interview-rail")).toBeNull();
    expect(screen.queryByTestId("prd-patch-feedback")).toBeNull();
    expect(screen.queryByTestId("prd-validation-hint")).toBeNull();
    expect(screen.queryByTestId("prd-goal-input")).toBeNull();
    expect(screen.queryByTestId("prd-criterion-input-0")).toBeNull();
  });

  it("routes edit and create-plan actions intentionally", () => {
    const props = renderView();

    fireEvent.click(screen.getByTestId("final-prd-edit"));
    fireEvent.click(screen.getByTestId("final-prd-create-plan"));

    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(props.onCreatePlan).toHaveBeenCalledTimes(1);
  });

  it("shows a plan-created state instead of create-plan when a plan already exists", () => {
    const props = renderView({
      canCreatePlan: false,
      planStatusLabel: "Plan created",
    });

    expect(screen.queryByTestId("final-prd-create-plan")).toBeNull();
    expect(screen.getByTestId("final-prd-plan-created").textContent).toContain("Plan created");

    fireEvent.click(screen.getByTestId("final-prd-edit"));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(props.onCreatePlan).not.toHaveBeenCalled();
  });
});
