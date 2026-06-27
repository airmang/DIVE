// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import {
  shouldRenderPlanDraftPending,
  usePlanDraftPendingController,
} from "./useProductShellController";
import { PlanDraftPendingScreen } from "./PlanDraftPendingScreen";

function PendingSlot({
  planDraftPending,
  hasGeneratedPlanDraft = false,
  hasPlanDraftFailure = false,
}: {
  planDraftPending: boolean;
  hasGeneratedPlanDraft?: boolean;
  hasPlanDraftFailure?: boolean;
}) {
  return shouldRenderPlanDraftPending({
    planDraftPending,
    hasGeneratedPlanDraft,
    hasPlanDraftFailure,
  }) ? (
    <PlanDraftPendingScreen />
  ) : (
    <div data-testid="pending-cleared" />
  );
}

describe("PlanDraftPendingScreen", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "en" });
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("mounts only while a plan draft is pending", () => {
    const { rerender } = render(<PendingSlot planDraftPending />);

    expect(screen.getByTestId("plan-draft-pending")).toBeTruthy();
    expect(screen.getByText("Generating your plan...")).toBeTruthy();

    rerender(<PendingSlot planDraftPending hasGeneratedPlanDraft />);
    expect(screen.queryByTestId("plan-draft-pending")).toBeNull();
    expect(screen.getByTestId("pending-cleared")).toBeTruthy();

    rerender(<PendingSlot planDraftPending hasPlanDraftFailure />);
    expect(screen.queryByTestId("plan-draft-pending")).toBeNull();
    expect(screen.getByTestId("pending-cleared")).toBeTruthy();
  });

  it("clears a stuck pending plan draft after the fallback timeout", () => {
    const { result } = renderHook(() => usePlanDraftPendingController(1_000));

    act(() => {
      result.current.setPlanDraftExpectation(true);
    });

    expect(result.current.planDraftPending).toBe(true);
    expect(result.current.expectingPlanDraftRef.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current.planDraftPending).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.planDraftPending).toBe(false);
    expect(result.current.expectingPlanDraftRef.current).toBe(false);
  });
});
