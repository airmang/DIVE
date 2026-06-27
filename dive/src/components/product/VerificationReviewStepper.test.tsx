// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  VerificationReviewStepper,
  type VerificationReviewStage,
} from "./VerificationReviewStepper";

function makeStages(evidenced: Partial<Record<string, boolean>> = {}): VerificationReviewStage[] {
  return [
    {
      id: "code",
      marker: "1",
      title: "Code",
      summary: "Review changed files",
      evidenced: evidenced.code,
      content: <p>Code content</p>,
    },
    {
      id: "observe",
      marker: "2",
      title: "Observe",
      summary: "Record observation",
      evidenced: evidenced.observe,
      content: <p>Observe content</p>,
    },
    {
      id: "decision",
      marker: "3",
      title: "Decision",
      summary: "Approve or request changes",
      evidenced: evidenced.decision,
      content: <p>Decision content</p>,
    },
  ];
}

function renderStepper(stages = makeStages()) {
  return render(
    <VerificationReviewStepper
      ariaLabel="Review stages"
      progressLabel={(current, total) => `${current} / ${total}`}
      previousLabel="Previous"
      nextLabel="Next"
      revisitLabel="Revisit"
      openStageLabel="Open stage"
      stages={stages}
    />,
  );
}

describe("VerificationReviewStepper", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a visited state without a success check when navigation has no evidence", () => {
    renderStepper(makeStages({ code: false, observe: false, decision: false }));

    fireEvent.click(screen.getByTestId("verification-stepper-next"));

    expect(screen.getByTestId("verification-stepper-stage-code").dataset.stageState).toBe(
      "visited",
    );
    expect(screen.queryByTestId("verification-stepper-success-code")).toBeNull();
    expect(screen.getByTestId("verification-stepper-revisit-code")).toBeTruthy();
  });

  it("renders the success check when a non-active stage has evidence", () => {
    renderStepper(makeStages({ code: true, observe: false, decision: false }));

    fireEvent.click(screen.getByTestId("verification-stepper-next"));

    expect(screen.getByTestId("verification-stepper-stage-code").dataset.stageState).toBe(
      "completed",
    );
    expect(screen.getByTestId("verification-stepper-success-code")).toBeTruthy();
  });

  it("keeps next and previous navigation free when stages are not evidenced", () => {
    renderStepper(makeStages({ code: false, observe: false, decision: false }));

    fireEvent.click(screen.getByTestId("verification-stepper-next"));
    expect(screen.getByTestId("verification-stepper-stage-observe").dataset.stageState).toBe(
      "current",
    );

    fireEvent.click(screen.getByTestId("verification-stepper-next"));
    expect(screen.getByTestId("verification-stepper-stage-decision").dataset.stageState).toBe(
      "current",
    );
    expect((screen.getByTestId("verification-stepper-next") as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.click(screen.getByTestId("verification-stepper-previous"));
    expect(screen.getByTestId("verification-stepper-stage-observe").dataset.stageState).toBe(
      "current",
    );

    fireEvent.click(screen.getByTestId("verification-stepper-previous"));
    expect(screen.getByTestId("verification-stepper-stage-code").dataset.stageState).toBe(
      "current",
    );
  });
});
