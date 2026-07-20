import { describe, expect, it } from "vitest";
import type { RoadmapStep } from "../../features/roadmap";
import type { SupervisorEvaluationUiState } from "../../features/provocation";
import type { ChangedFile } from "../slide-in/types";
import {
  buildDiffReadySupervisorRequest,
  buildRetryLoopSupervisorRequest,
  buildSupervisorEvaluationRequest,
  type RetryLoopFailureSnapshot,
  type StepDetailProvocation,
} from "./stepDetailSupervisorRequests";

// The builders only read a few fields off the step / pass uiState through, so a
// cast keeps the fixtures focused on the guard + shaping logic under test.
const step = {
  id: 7,
  title: "Render the list",
  description: "Show schedules and todos",
  assistSummary: "Build the list view",
  position: 2,
} as RoadmapStep;

const uiState = { verification: {}, feasibility: {} } as unknown as SupervisorEvaluationUiState;

const provocation: StepDetailProvocation = {
  enabled: true,
  mode: "guided",
  projectId: 3,
  sessionId: 11,
};

const changedFiles: ChangedFile[] = [{ path: "src/List.tsx" } as ChangedFile];

const retryLoopSnapshot: RetryLoopFailureSnapshot = {
  failureFingerprint: "fp",
  failureSummary: "type error in List.tsx",
  failureCount: 2,
  lastFailureAt: 123,
  lastOccurrenceKey: "fp:123",
};

describe("buildSupervisorEvaluationRequest", () => {
  it("returns null when the guards are not met", () => {
    const base = { supervisorUiState: uiState, provocation, previewOpened: false, locale: "en" };
    expect(buildSupervisorEvaluationRequest({ ...base, step: null })).toBeNull();
    expect(buildSupervisorEvaluationRequest({ ...base, step, supervisorUiState: null })).toBeNull();
    expect(buildSupervisorEvaluationRequest({ ...base, step, provocation: undefined })).toBeNull();
    expect(
      buildSupervisorEvaluationRequest({
        ...base,
        step,
        provocation: { ...provocation, enabled: false },
      }),
    ).toBeNull();
    expect(
      buildSupervisorEvaluationRequest({
        ...base,
        step,
        provocation: { ...provocation, sessionId: null },
      }),
    ).toBeNull();
  });

  it("builds a verify_entered request with the step artifact and passed-in locale", () => {
    const request = buildSupervisorEvaluationRequest({
      step,
      supervisorUiState: uiState,
      provocation,
      previewOpened: true,
      locale: "ko",
    });
    expect(request).toEqual({
      sessionId: 11,
      event: "verify_entered",
      artifactRef: { kind: "step", id: "7", label: "Render the list" },
      sourceUiMode: "guided",
      locale: "ko",
      uiState,
    });
  });
});

describe("buildDiffReadySupervisorRequest", () => {
  const base = {
    step,
    supervisorUiState: uiState,
    provocation,
    changedFiles,
    verifyState: "idle" as const,
    verifyTestResult: "skipped" as const,
    planContextPurpose: null,
    verificationPlanText: null,
    expectedFiles: ["src/List.tsx"],
    diffViewed: false,
    stepKind: null,
    locale: "en",
  };

  it("returns null when there are no changed files, the run errored, or tests failed", () => {
    expect(buildDiffReadySupervisorRequest({ ...base, changedFiles: [] })).toBeNull();
    expect(buildDiffReadySupervisorRequest({ ...base, verifyState: "error" })).toBeNull();
    expect(buildDiffReadySupervisorRequest({ ...base, verifyTestResult: "fail" })).toBeNull();
    expect(
      buildDiffReadySupervisorRequest({
        ...base,
        provocation: { ...provocation, sessionId: null },
      }),
    ).toBeNull();
  });

  it("delegates to the diff-ready request builder when the guards pass", () => {
    expect(buildDiffReadySupervisorRequest(base)).not.toBeNull();
  });
});

describe("buildRetryLoopSupervisorRequest", () => {
  const base = {
    step,
    supervisorUiState: uiState,
    retryLoopSnapshot,
    provocation,
    planContextPurpose: null,
    verificationPlanText: null,
    rollbackAvailable: true,
    locale: "en",
  };

  it("returns null without a snapshot or below the repeat-failure threshold", () => {
    expect(buildRetryLoopSupervisorRequest({ ...base, retryLoopSnapshot: null })).toBeNull();
    expect(
      buildRetryLoopSupervisorRequest({
        ...base,
        retryLoopSnapshot: { ...retryLoopSnapshot, failureCount: 1 },
      }),
    ).toBeNull();
  });

  it("delegates to the retry-loop request builder on a repeated failure", () => {
    expect(buildRetryLoopSupervisorRequest(base)).not.toBeNull();
  });
});
