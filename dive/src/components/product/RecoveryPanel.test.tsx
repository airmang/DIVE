// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import { RecoveryPanel, type RecoveryPanelProps } from "./RecoveryPanel";

function renderPanel(overrides: Partial<RecoveryPanelProps> = {}) {
  const props: RecoveryPanelProps = {
    sessionAvailable: true,
    checkpoints: [],
    loading: false,
    error: null,
    restoringCheckpointId: null,
    failedStep: {
      stepTitle: "검증 단계",
      reason: "pnpm test failed",
      onExplainError: vi.fn(),
      onRetry: vi.fn(),
      onAdjustPlan: vi.fn(),
    },
    onRefresh: vi.fn(),
    onCreateCheckpoint: vi.fn(),
    onRestoreCheckpoint: vi.fn(),
    ...overrides,
  };
  render(<RecoveryPanel {...props} />);
  return props;
}

describe("RecoveryPanel failure actions", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => cleanup());

  it("shows recovery-first actions before AI retry and truthfully disables rollback without checkpoints", () => {
    renderPanel();

    const actions = within(screen.getByTestId("failed-step-actions")).getAllByRole("button");
    expect(actions.map((button) => button.textContent)).toEqual([
      "되돌리기 지점 없음",
      "에러 로그 요약 / 재현 단계",
      "범위 줄이기 / 계획 조정",
      "AI에게 다시 고쳐달라고 하기",
    ]);
    expect((actions[0] as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("failed-step-no-undo").textContent).toContain("체크포인트가 없어");
  });

  it("restores the latest checkpoint only after inline confirmation", () => {
    const props = renderPanel({
      checkpoints: [
        { id: 1, label: "older", kind: "manual", createdAt: 10, changedFiles: [] },
        { id: 2, label: "latest", kind: "manual", createdAt: 20, changedFiles: ["src/App.tsx"] },
      ],
    });

    const undo = screen.getByTestId("failed-step-undo") as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    expect(undo.textContent).toBe("마지막 변경 되돌리기");

    fireEvent.click(undo);
    fireEvent.click(screen.getByTestId("restore-confirm-inline-action"));

    expect(props.onRestoreCheckpoint).toHaveBeenCalledWith(2);
  });
});
