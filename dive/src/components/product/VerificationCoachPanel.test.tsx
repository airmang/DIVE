// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLocaleStore } from "../../i18n";
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
