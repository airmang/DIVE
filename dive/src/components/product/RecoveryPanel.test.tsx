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

  it("warns that restore reverts files only before confirming (S-032)", () => {
    renderPanel({
      checkpoints: [{ id: 2, label: "latest", kind: "manual", createdAt: 20, changedFiles: [] }],
    });

    fireEvent.click(screen.getByTestId("failed-step-undo"));

    const note = screen.getByTestId("restore-files-only-note");
    expect(note.textContent).toContain("채팅·플랜·로드맵");
  });

  it("suppresses the file-only warning when a checkpoint has a session-state snapshot (S-032)", () => {
    renderPanel({
      checkpoints: [
        {
          id: 2,
          label: "latest",
          kind: "manual",
          createdAt: 20,
          changedFiles: [],
          hasSessionStateSnapshot: true,
        },
      ],
    });

    fireEvent.click(screen.getByTestId("failed-step-undo"));

    expect(screen.queryByTestId("restore-files-only-note")).toBeNull();
    expect(screen.getByTestId("restore-consistent-note").textContent).toContain("채팅·플랜·로드맵");
  });

  it("reconciles the checkpoint count with the badge and notes the truncated list (S-032)", () => {
    renderPanel({
      failedStep: null,
      checkpoints: Array.from({ length: 5 }, (_, index) => ({
        id: index + 1,
        label: `cp-${index + 1}`,
        kind: "manual",
        createdAt: (index + 1) * 10,
        changedFiles: [],
      })),
    });

    const count = screen.getByTestId("recovery-checkpoint-count");
    expect(count.textContent).toContain("복원 지점 5개");
    expect(count.textContent).toContain("최근 3개");
    // The panel only renders the latest 3 even though the badge counts all 5.
    expect(
      within(screen.getByTestId("recovery-checkpoint-list")).getAllByTestId("recovery-restore"),
    ).toHaveLength(3);
  });

  it("localizes a label-less pre-restore checkpoint title (S-032)", () => {
    renderPanel({
      failedStep: null,
      checkpoints: [
        { id: 7, label: null, kind: "auto-pre-restore", createdAt: 30, changedFiles: [] },
      ],
    });

    // No raw Korean backend label and no raw kind string — the kind is localized.
    expect(screen.getByTestId("last-change-card").textContent).toContain("복원 직전 체크포인트");
  });

  it("localizes a label-less pre-edit anchor title (S-032)", () => {
    renderPanel({
      failedStep: null,
      checkpoints: [{ id: 9, label: null, kind: "auto-pre-edit", createdAt: 40, changedFiles: [] }],
    });

    expect(screen.getByTestId("last-change-card").textContent).toContain("편집 직전 체크포인트");
  });

  it("localizes a label-less pre-pivot anchor title (S-032)", () => {
    renderPanel({
      failedStep: null,
      checkpoints: [
        { id: 10, label: null, kind: "auto-pre-pivot", createdAt: 40, changedFiles: [] },
      ],
    });

    expect(screen.getByTestId("last-change-card").textContent).toContain(
      "계획 조정 직전 체크포인트",
    );
  });

  it("marks only the most recent pre-edit anchor as the before-your-last-edit point (S-032)", () => {
    renderPanel({
      failedStep: null,
      checkpoints: [
        { id: 1, label: "older edit", kind: "auto-pre-edit", createdAt: 10, changedFiles: [] },
        {
          id: 2,
          label: "newest edit",
          kind: "auto-pre-edit",
          createdAt: 30,
          changedFiles: ["a.ts"],
        },
        { id: 3, label: "card move", kind: "auto", createdAt: 20, changedFiles: [] },
      ],
    });

    const markers = screen.getAllByTestId("pre-edit-anchor-marker");
    expect(markers).toHaveLength(1);
    expect(markers[0].textContent).toBe("마지막 편집 직전");

    // The marker sits on the newest pre-edit anchor (id 2), not the older one.
    const newestItem = within(screen.getByTestId("recovery-checkpoint-list"))
      .getByText("newest edit")
      .closest("li");
    expect(newestItem).not.toBeNull();
    expect(
      within(newestItem as HTMLElement).queryByTestId("pre-edit-anchor-marker"),
    ).not.toBeNull();
  });
});
