// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { PlanDraftQualityIssue } from "../../features/planning/usePlanInterviewLLM";
import { PlanDraftRecoveryScreen } from "./PlanDraftRecoveryScreen";

describe("PlanDraftRecoveryScreen", () => {
  afterEach(() => cleanup());

  it("renders vague criteria recovery copy and missing items in English", () => {
    useLocaleStore.setState({ locale: "en" });

    render(
      <PlanDraftRecoveryScreen
        reason="vague_criteria"
        unresolvedQuestions={["Rewrite acceptance criterion with an observable result"]}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Acceptance criteria need more concrete checks")).toBeTruthy();
    expect(screen.getByText("Ask for these missing details:")).toBeTruthy();
    expect(screen.getByText("Rewrite acceptance criterion with an observable result")).toBeTruthy();
  });

  it("renders missing state criteria recovery copy and missing items in Korean", () => {
    useLocaleStore.setState({ locale: "ko" });

    render(
      <PlanDraftRecoveryScreen
        reason="missing_state_criteria"
        unresolvedQuestions={["빈 상태", "오류 상태"]}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("완료 기준에 필요한 상태가 빠졌습니다")).toBeTruthy();
    expect(screen.getByText("다음 항목을 더 물어봐야 합니다:")).toBeTruthy();
    expect(screen.getByText("빈 상태")).toBeTruthy();
    expect(screen.getByText("오류 상태")).toBeTruthy();
  });

  it("offers a back-to-PRD escape that routes to PRD authoring", () => {
    useLocaleStore.setState({ locale: "ko" });
    const onEditPrd = vi.fn();

    render(
      <PlanDraftRecoveryScreen
        reason="missing_state_criteria"
        unresolvedQuestions={["반응형 동작"]}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
        onEditPrd={onEditPrd}
      />,
    );

    fireEvent.click(screen.getByTestId("plan-draft-recovery-edit-prd"));
    expect(onEditPrd).toHaveBeenCalledTimes(1);
  });

  it("retry keeps persisted interview answers outside the recovery surface", () => {
    useLocaleStore.setState({ locale: "en" });
    const persistedAnswers = [{ question: "Who is this for?", answer: "Students" }];
    const originalAnswers = [...persistedAnswers];
    const onRetry = vi.fn(() => {
      expect(persistedAnswers).toEqual(originalAnswers);
    });

    render(
      <PlanDraftRecoveryScreen
        reason="missing_state_criteria"
        unresolvedQuestions={["responsive behavior"]}
        onRetry={onRetry}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("plan-draft-recovery-retry"));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("interview-input")).toBeNull();
    expect(persistedAnswers).toEqual(originalAnswers);
  });

  // S-050 D4: when the backend attaches machine-coded issues, the screen
  // renders localized issue lines + a self-passing examples block instead of
  // the raw English unresolvedQuestions prose.
  it("renders localized issue lines and self-passing examples when issues are present", () => {
    useLocaleStore.setState({ locale: "en" });
    const issues: PlanDraftQualityIssue[] = [
      { code: "missing_state_class", missingClass: "responsive" },
    ];

    render(
      <PlanDraftRecoveryScreen
        reason="missing_state_criteria"
        unresolvedQuestions={["responsive behavior"]}
        issues={issues}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("Missing acceptance criteria for responsive behavior.")).toBeTruthy();
    expect(screen.getByText("Examples that pass")).toBeTruthy();
    expect(
      screen.getByText("The 3-column grid collapses to 1 column at 390px width."),
    ).toBeTruthy();
    // The raw unresolvedQuestions prose is not rendered once issues take over.
    expect(screen.queryByText("responsive behavior")).toBeNull();
  });

  it("falls back to raw unresolvedQuestions and no examples block when issues is absent", () => {
    useLocaleStore.setState({ locale: "en" });

    render(
      <PlanDraftRecoveryScreen
        reason="missing_state_criteria"
        unresolvedQuestions={["responsive behavior"]}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("responsive behavior")).toBeTruthy();
    expect(screen.queryByTestId("plan-draft-recovery-examples")).toBeNull();
  });

  it("falls back to raw unresolvedQuestions when issues is an empty array", () => {
    useLocaleStore.setState({ locale: "en" });

    render(
      <PlanDraftRecoveryScreen
        reason="missing_state_criteria"
        unresolvedQuestions={["responsive behavior"]}
        issues={[]}
        onRetry={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText("responsive behavior")).toBeTruthy();
    expect(screen.queryByTestId("plan-draft-recovery-examples")).toBeNull();
  });
});
