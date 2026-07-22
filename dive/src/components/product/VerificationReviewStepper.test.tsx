// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      content: () => <p>Code content</p>,
    },
    {
      id: "observe",
      marker: "2",
      title: "Observe",
      summary: "Record observation",
      evidenced: evidenced.observe,
      content: () => <p>Observe content</p>,
    },
    {
      id: "decision",
      marker: "3",
      title: "Decision",
      summary: "Approve or request changes",
      evidenced: evidenced.decision,
      content: () => <p>Decision content</p>,
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

const mountCounts: Record<string, number> = {};

function ProbeContent({ trackerKey, isActive }: { trackerKey: string; isActive?: boolean }) {
  const [text, setText] = useState("");
  useEffect(() => {
    mountCounts[trackerKey] = (mountCounts[trackerKey] ?? 0) + 1;
  }, [trackerKey]);
  return (
    <div>
      <span data-testid={`probe-active-${trackerKey}`}>{String(isActive)}</span>
      <input
        data-testid={`probe-input-${trackerKey}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </div>
  );
}

function makeStagesWithProbes(): VerificationReviewStage[] {
  return [
    {
      id: "code",
      marker: "1",
      title: "Code",
      summary: "Review changed files",
      content: () => <ProbeContent trackerKey="code" />,
    },
    {
      id: "observe",
      marker: "2",
      title: "Observe",
      summary: "Record observation",
      content: (isActive) => <ProbeContent trackerKey="observe" isActive={isActive} />,
      keepMounted: true,
    },
    {
      id: "decision",
      marker: "3",
      title: "Decision",
      summary: "Approve or request changes",
      content: () => <p>Decision content</p>,
    },
  ];
}

describe("VerificationReviewStepper keepMounted (S-064 P2 regression fix)", () => {
  beforeEach(() => {
    delete mountCounts.code;
    delete mountCounts.observe;
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts a keepMounted stage from the start (hidden while inactive) and never remounts it across navigation", () => {
    renderStepper(makeStagesWithProbes());

    // Mounted immediately even though "code" is the active stage — hidden,
    // not absent — so its state can survive the very first navigation away.
    expect(mountCounts.observe).toBe(1);
    expect(screen.getByTestId("probe-active-observe").textContent).toBe("false");

    fireEvent.click(screen.getByTestId("verification-stepper-next")); // code -> observe
    expect(mountCounts.observe).toBe(1);
    expect(screen.getByTestId("probe-active-observe").textContent).toBe("true");

    fireEvent.change(screen.getByTestId("probe-input-observe"), {
      target: { value: "draft in progress" },
    });

    fireEvent.click(screen.getByTestId("verification-stepper-next")); // observe -> decision
    expect(mountCounts.observe).toBe(1);
    expect(screen.getByTestId("probe-active-observe").textContent).toBe("false");
    expect((screen.getByTestId("probe-input-observe") as HTMLInputElement).value).toBe(
      "draft in progress",
    );

    fireEvent.click(screen.getByTestId("verification-stepper-previous")); // back to observe
    expect(mountCounts.observe).toBe(1);
    expect(screen.getByTestId("probe-active-observe").textContent).toBe("true");
    expect((screen.getByTestId("probe-input-observe") as HTMLInputElement).value).toBe(
      "draft in progress",
    );
  });

  it("still mounts/unmounts a non-keepMounted stage's content only while active (baseline preserved)", () => {
    renderStepper(makeStagesWithProbes());
    expect(mountCounts.code).toBe(1);

    fireEvent.click(screen.getByTestId("verification-stepper-next")); // code -> observe
    fireEvent.click(screen.getByTestId("verification-stepper-previous")); // observe -> code
    expect(mountCounts.code).toBe(2);
  });
});
