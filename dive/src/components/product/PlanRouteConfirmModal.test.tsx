// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanRouteConfirmModal, type ConfirmableRouteDecision } from "./PlanRouteConfirmModal";
import type { StepDraftInput, StepRefPayload } from "../../features/planning";

function draft(title: string): StepDraftInput {
  return {
    stepId: "",
    title,
    summary: `${title} summary`,
    instructionSeed: `Implement ${title}`,
    expectedFiles: ["src/a.ts"],
    acceptanceCriteria: ["observable result"],
    linkedCriterionIds: [],
    rationale: "",
    verificationCommand: "pnpm test",
    verificationType: "command",
    dependencies: [],
    parallelGroup: null,
    position: 0,
  };
}

function ref(stepId: string, title: string): StepRefPayload {
  return { stepId, dbId: 11, title };
}

function renderModal(decision: ConfirmableRouteDecision) {
  const onApprove = vi.fn();
  const onReject = vi.fn();
  render(
    <PlanRouteConfirmModal
      open
      decision={decision}
      steps={[]}
      onApprove={onApprove}
      onReject={onReject}
    />,
  );
  return { onApprove, onReject };
}

afterEach(() => cleanup());

describe("PlanRouteConfirmModal — S-033 routing outcomes", () => {
  it("renders a remove proposal with an apply button and the target step", () => {
    const { onApprove } = renderModal({
      action: "remove_step",
      target: ref("step-003", "Obsolete step"),
      reason: "no longer needed",
    });
    expect(screen.getByTestId("plan-route-body-remove_step")).toBeTruthy();
    expect(screen.getByText(/Obsolete step/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("plan-route-approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
    // remove is an apply action, not the info-only dismiss footer.
    expect(screen.queryByTestId("plan-route-dismiss")).toBeNull();
  });

  it("renders a supersede proposal showing both the current step and the replacement", () => {
    const { onApprove } = renderModal({
      action: "supersede_step",
      target: ref("step-002", "Old auth"),
      replacement: draft("Rework auth"),
      reason: "rework",
    });
    expect(screen.getByTestId("plan-route-body-supersede_step")).toBeTruthy();
    expect(screen.getByText(/Old auth/)).toBeTruthy();
    expect(screen.getByText("Rework auth")).toBeTruthy();
    fireEvent.click(screen.getByTestId("plan-route-approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("renders a duplicate as informational only — dismiss, no apply button", () => {
    const { onReject } = renderModal({
      action: "duplicate",
      existing: ref("step-001", "Existing login work"),
      draft: draft("Repeat step"),
      reason: "already covered by step-001",
    });
    expect(screen.getByTestId("plan-route-body-duplicate")).toBeTruthy();
    expect(screen.getByText(/Existing login work/)).toBeTruthy();
    expect(screen.getByText("Repeat step")).toBeTruthy();
    // Info-only: a single dismiss button, no approve/apply.
    expect(screen.queryByTestId("plan-route-approve")).toBeNull();
    fireEvent.click(screen.getByTestId("plan-route-dismiss"));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("still renders the add_step proposal (unchanged baseline)", () => {
    renderModal({ action: "add_step", draft: draft("Add login"), reason: "new work" });
    expect(screen.getByTestId("plan-route-body-add_step")).toBeTruthy();
    expect(screen.getByText("Add login")).toBeTruthy();
    expect(screen.getByTestId("plan-route-approve")).toBeTruthy();
  });

  it("renders a clarify question as informational — dismiss only, no apply", () => {
    renderModal({
      action: "clarify",
      question: "Which page needs the nav?",
      candidateIntent: "add a nav bar",
      suggestedCriterionIds: ["AC-001"],
      reason: "ambiguous target",
    });
    expect(screen.getByTestId("plan-route-body-clarify")).toBeTruthy();
    expect(screen.getByText("Which page needs the nav?")).toBeTruthy();
    expect(screen.getByTestId("plan-route-dismiss")).toBeTruthy();
    expect(screen.queryByTestId("plan-route-approve")).toBeNull();
  });

  it("renders a multi_step fan-out with each draft and an apply button", () => {
    const { onApprove } = renderModal({
      action: "multi_step",
      drafts: [
        { draft: draft("Scaffold module"), dependsOnDraft: [] },
        { draft: draft("Wire handler"), dependsOnDraft: [0] },
      ],
      reason: "scaffold then wire",
    });
    expect(screen.getByTestId("plan-route-body-multi_step")).toBeTruthy();
    expect(screen.getByText("Scaffold module")).toBeTruthy();
    expect(screen.getByText("Wire handler")).toBeTruthy();
    fireEvent.click(screen.getByTestId("plan-route-approve"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
