// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocaleStore } from "../../i18n";
import {
  generateVerificationCoachGuide,
  recordVerificationObservation,
} from "../../features/verification-coach/api";
import type { VerificationCoachGenerateRequest } from "../../features/verification-coach/types";
import { VerificationCoachPanel } from "./VerificationCoachPanel";

vi.mock("../../features/verification-coach/api", () => ({
  generateVerificationCoachGuide: vi.fn().mockResolvedValue({
    status: "unavailable",
    eventId: "e1",
    guideVersion: 1,
    dropReason: "missing_criterion",
    message: "n/a",
  }),
  recordVerificationObservation: vi.fn(),
}));

const recordMock = vi.mocked(recordVerificationObservation);
const coachMock = vi.mocked(generateVerificationCoachGuide);

function makeRequest(
  acceptanceCriteria: VerificationCoachGenerateRequest["step"]["acceptanceCriteria"],
): VerificationCoachGenerateRequest {
  return {
    sessionId: 1,
    cardId: 1,
    sourceUiMode: "work",
    step: { title: "Step", acceptanceCriteria },
    evidence: {
      changedFiles: [],
      previewAvailable: false,
      appRunAvailable: false,
      diffAvailable: false,
      priorObservations: [],
    },
  };
}

describe("VerificationCoachPanel no-criteria dead-end (P2-32)", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => cleanup());

  it("suppresses the observation form and shows an honest hint when the step has no criteria", () => {
    render(
      <VerificationCoachPanel
        request={makeRequest([])}
        observation={null}
        observationActionBacked={false}
        onObservationRecorded={vi.fn()}
      />,
    );

    expect(screen.getByTestId("coach-no-criteria")).toBeTruthy();
    // The dead textarea + Record button (which could never fire) are gone.
    expect(screen.queryByTestId("verification-observation-text")).toBeNull();
    expect(screen.queryByTestId("verification-observation-record")).toBeNull();
  });

  it("still renders the observation form when the step has a criterion", () => {
    render(
      <VerificationCoachPanel
        request={makeRequest([{ criterionId: "AC-001", text: "The page renders" }])}
        observation={null}
        observationActionBacked={false}
        onObservationRecorded={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("coach-no-criteria")).toBeNull();
    expect(screen.getByTestId("verification-observation-text")).toBeTruthy();
    expect(screen.getByTestId("verification-observation-record")).toBeTruthy();
  });
});

describe("VerificationCoachPanel multi-criterion observation linking (S-056 D3)", () => {
  const twoCriteria: VerificationCoachGenerateRequest["step"]["acceptanceCriteria"] = [
    { criterionId: "AC-001", text: "The page renders" },
    { criterionId: "AC-002", text: "The list updates after save" },
  ];

  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    recordMock.mockReset();
    recordMock.mockImplementation(async (input) => ({
      ...input,
      observationId: "obs-test",
      recordedAt: 1,
    }));
  });

  afterEach(() => cleanup());

  it("does not show a criteria checklist for a single-criterion step and still records that one id (S-029 default preserved)", async () => {
    render(
      <VerificationCoachPanel
        request={makeRequest([{ criterionId: "AC-001", text: "The page renders" }])}
        observation={null}
        observationActionBacked={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("verification-observation-criteria")).toBeNull();
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "Opened the app and confirmed the page renders correctly" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));

    await waitFor(() =>
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({ criterionIds: ["AC-001"] }),
      ),
    );
  });

  it("defaults to only the first criterion checked for a multi-criterion step (S-029 default preserved)", () => {
    render(
      <VerificationCoachPanel
        request={makeRequest(twoCriteria)}
        observation={null}
        observationActionBacked={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    expect(
      (screen.getByTestId("verification-observation-criterion-AC-001") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId("verification-observation-criterion-AC-002") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("records every explicitly checked criterion for one observation", async () => {
    const onObservationRecorded = vi.fn();
    render(
      <VerificationCoachPanel
        request={makeRequest(twoCriteria)}
        observation={null}
        observationActionBacked={true}
        onObservationRecorded={onObservationRecorded}
      />,
    );

    fireEvent.click(screen.getByTestId("verification-observation-criterion-AC-002"));
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "Ran the app, saved, and confirmed the list refreshed with the new item" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));

    await waitFor(() =>
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({ criterionIds: ["AC-001", "AC-002"] }),
      ),
    );
    await waitFor(() => expect(onObservationRecorded).toHaveBeenCalledTimes(1));
  });

  it("checking a second criterion does not clear already-typed observation text", () => {
    render(
      <VerificationCoachPanel
        request={makeRequest(twoCriteria)}
        observation={null}
        observationActionBacked={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "Ran the app, saved, and confirmed the list refreshed with the new item" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-criterion-AC-002"));

    expect((screen.getByTestId("verification-observation-text") as HTMLTextAreaElement).value).toBe(
      "Ran the app, saved, and confirmed the list refreshed with the new item",
    );
  });

  it("'apply to all' checks every criterion and records all of their ids", async () => {
    render(
      <VerificationCoachPanel
        request={makeRequest(twoCriteria)}
        observation={null}
        observationActionBacked={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("verification-observation-select-all"));
    expect(
      (screen.getByTestId("verification-observation-criterion-AC-001") as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId("verification-observation-criterion-AC-002") as HTMLInputElement).checked,
    ).toBe(true);

    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "Ran the app, saved, and confirmed both behaviors together" },
    });
    fireEvent.click(screen.getByTestId("verification-observation-record"));

    await waitFor(() =>
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({ criterionIds: ["AC-001", "AC-002"] }),
      ),
    );
  });

  it("disables recording and shows a localized hint when every criterion is unchecked", () => {
    render(
      <VerificationCoachPanel
        request={makeRequest(twoCriteria)}
        observation={null}
        observationActionBacked={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    // Default-checked first criterion is explicitly unchecked, leaving an
    // empty selection — this must never silently fall back to a default.
    fireEvent.click(screen.getByTestId("verification-observation-criterion-AC-001"));
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "Some observation text that is long enough" },
    });

    expect(screen.getByTestId("verification-observation-criteria-empty-hint")).toBeTruthy();
    expect(
      (screen.getByTestId("verification-observation-record") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps the action-backed and minimum-length gates in the multi-select flow (S-029 regression)", () => {
    render(
      <VerificationCoachPanel
        request={makeRequest(twoCriteria)}
        observation={null}
        observationActionBacked={false}
        onObservationRecorded={vi.fn()}
      />,
    );

    // Too short: disabled regardless of action-backing.
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "short" },
    });
    expect(
      (screen.getByTestId("verification-observation-record") as HTMLButtonElement).disabled,
    ).toBe(true);

    // Long enough, but not action-backed: still disabled, with the honest hint.
    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "Long enough text but no action backs it yet" },
    });
    expect(
      (screen.getByTestId("verification-observation-record") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("verification-observation-needs-action")).toBeTruthy();
  });
});

describe("VerificationCoachPanel enabled gating (S-064 regression fixes)", () => {
  const singleCriterion: VerificationCoachGenerateRequest["step"]["acceptanceCriteria"] = [
    { criterionId: "AC-001", text: "The page renders" },
  ];

  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    coachMock.mockClear();
    coachMock.mockResolvedValue({
      status: "unavailable",
      eventId: "e1",
      guideVersion: 1,
      dropReason: "missing_criterion",
      message: "n/a",
    });
  });

  afterEach(() => cleanup());

  it("does not start a generation while enabled=false, and fires once it becomes enabled", async () => {
    const view = render(
      <VerificationCoachPanel
        request={makeRequest(singleCriterion)}
        observation={null}
        observationActionBacked={false}
        enabled={false}
        onObservationRecorded={vi.fn()}
      />,
    );

    await Promise.resolve();
    expect(coachMock).not.toHaveBeenCalled();

    view.rerender(
      <VerificationCoachPanel
        request={makeRequest(singleCriterion)}
        observation={null}
        observationActionBacked={false}
        enabled={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    await waitFor(() => expect(coachMock).toHaveBeenCalledTimes(1));
  });

  it("does not refire generation when disabled then re-enabled with an unchanged request (stage revisit / panel reopen)", async () => {
    const view = render(
      <VerificationCoachPanel
        request={makeRequest(singleCriterion)}
        observation={null}
        observationActionBacked={false}
        enabled={true}
        onObservationRecorded={vi.fn()}
      />,
    );
    await waitFor(() => expect(coachMock).toHaveBeenCalledTimes(1));

    // Disable (panel closed / stage navigated away), then re-enable with the
    // exact same request — must not start a second generation.
    view.rerender(
      <VerificationCoachPanel
        request={makeRequest(singleCriterion)}
        observation={null}
        observationActionBacked={false}
        enabled={false}
        onObservationRecorded={vi.fn()}
      />,
    );
    view.rerender(
      <VerificationCoachPanel
        request={makeRequest(singleCriterion)}
        observation={null}
        observationActionBacked={false}
        enabled={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    await Promise.resolve();
    expect(coachMock).toHaveBeenCalledTimes(1);
  });

  it("resets the typed observation draft and evidence kind when the request changes to a different step", () => {
    const stepA = makeRequest(singleCriterion);
    const stepB: VerificationCoachGenerateRequest = {
      ...makeRequest([{ criterionId: "AC-900", text: "A different step's criterion" }]),
      cardId: 2,
      planStepId: 2,
      step: { title: "A different step", acceptanceCriteria: singleCriterion },
    };

    const view = render(
      <VerificationCoachPanel
        request={stepA}
        observation={null}
        observationActionBacked={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("verification-observation-text"), {
      target: { value: "Step A's observation text, long enough to be substantive" },
    });
    fireEvent.change(screen.getByTestId("verification-observation-kind"), {
      target: { value: "terminal_observation" },
    });
    expect(
      (screen.getByTestId("verification-observation-text") as HTMLTextAreaElement).value,
    ).toContain("Step A");

    // Switching to a different step must not carry step A's draft along —
    // otherwise it is one click away from being recorded as step B's S-029
    // evidence (S-064 regression).
    view.rerender(
      <VerificationCoachPanel
        request={stepB}
        observation={null}
        observationActionBacked={true}
        onObservationRecorded={vi.fn()}
      />,
    );

    expect((screen.getByTestId("verification-observation-text") as HTMLTextAreaElement).value).toBe(
      "",
    );
    expect((screen.getByTestId("verification-observation-kind") as HTMLSelectElement).value).toBe(
      "manual_observation",
    );
  });
});
