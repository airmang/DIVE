// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocaleStore } from "../../i18n";
import { recordVerificationObservation } from "../../features/verification-coach/api";
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
