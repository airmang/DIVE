// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionCard, type PermissionCardData } from "../../components/permission-card";
import { useLocaleStore } from "../../i18n";
import { ProvocationCard } from "./ProvocationCard";
import { ProvocationCardHost } from "./ProvocationCardHost";
import { aiSelfReportOnlyRule, diffScopeDriftRule } from "./rules";
import type { ProvocationCard as ProvocationCardData, ProvocationContext } from "./types";

function reviewCard(overrides: Partial<ProvocationCardData> = {}): ProvocationCardData {
  return {
    id: "card-1",
    type: "missing_verification_step",
    stage: "instruct",
    severity: "caution",
    title: "검증 단계가 빠졌습니다",
    prompt: "이 계획이 틀렸는지 무엇으로 확인할 건가요?",
    message: "이 계획에는 만드는 단계는 있지만, 틀렸음을 확인하는 단계가 없습니다.",
    evidence: [{ source: "plan", label: "검증/실행/테스트 단계", value: "없음" }],
    actions: [{ id: "diff", label: "변경 보기", kind: "open_diff" }],
    modeCopy: {
      guided:
        "AI가 만든 뒤 무엇을 실행하거나 비교해야 하는지 계획에 있어야 승인 판단이 쉬워집니다.",
    },
    createdAt: "2026-06-13T00:00:00.000Z",
    ...overrides,
  };
}

function ruleContext(overrides: Partial<ProvocationContext> = {}): ProvocationContext {
  return {
    mode: "standard",
    stage: "execute",
    ...overrides,
  };
}

describe("ProvocationCard scaffold modes", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => cleanup());

  it("renders Guided with a focal question, evidence, explanation, and actions", () => {
    render(<ProvocationCard card={reviewCard()} mode="guided" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("guided");
    expect(screen.getByText("검증 단계가 빠졌습니다")).toBeTruthy();
    expect(screen.getByTestId("provocation-focal-question").textContent).toContain(
      "무엇으로 확인할 건가요",
    );
    expect(screen.queryByTestId("provocation-prompt")).toBeNull();
    expect((screen.getByTestId("provocation-secondary-details") as HTMLDetailsElement).open).toBe(
      false,
    );
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText(/승인 판단이 쉬워집니다/)).toBeTruthy();
    expect(screen.getByText("변경 보기")).toBeTruthy();
  });

  it("renders Work without secondary message or Guided explanation", () => {
    render(<ProvocationCard card={reviewCard()} mode="standard" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("work");
    expect(screen.getByTestId("provocation-focal-question").textContent).toContain(
      "무엇으로 확인할 건가요",
    );
    expect(screen.queryByTestId("provocation-prompt")).toBeNull();
    expect(screen.queryByText(/승인 판단이 쉬워집니다/)).toBeNull();
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText("변경 보기")).toBeTruthy();
  });

  it("normalizes Expert migration input to Work while keeping evidence and actions", () => {
    render(<ProvocationCard card={reviewCard({ severity: "risk" })} mode="expert" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("work");
    expect(screen.getByText("검증 단계가 빠졌습니다")).toBeTruthy();
    expect(screen.getByTestId("provocation-focal-question").textContent).toContain(
      "무엇으로 확인할 건가요",
    );
    expect(screen.queryByTestId("provocation-prompt")).toBeNull();
    expect(screen.queryByText(/승인 판단이 쉬워집니다/)).toBeNull();
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText("변경 보기")).toBeTruthy();
  });

  it("accepts canonical Work mode directly", () => {
    render(<ProvocationCard card={reviewCard()} mode="work" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("work");
    expect(screen.getByTestId("provocation-focal-question").textContent).toContain(
      "무엇으로 확인할 건가요",
    );
    expect(screen.queryByTestId("provocation-prompt")).toBeNull();
    expect(screen.queryByText(/승인 판단이 쉬워집니다/)).toBeNull();
  });

  it("renders disabled actions with an explicit reason and does not call the handler", () => {
    const onAction = vi.fn();
    render(
      <ProvocationCard
        card={reviewCard({
          actions: [
            {
              id: "rollback",
              label: "마지막 변경 되돌리기",
              kind: "rollback_last_change",
              disabledReason: "복구 경로 없음",
              todoId: "S-009-terminal-rollback",
            },
          ],
        })}
        mode="standard"
        onAction={onAction}
      />,
    );

    const action = screen.getByTestId("provocation-primary-action") as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(action.getAttribute("title")).toBe("복구 경로 없음");
    expect(action.dataset.disabledReason).toBe("복구 경로 없음");
    expect(screen.getByText("복구 경로 없음")).toBeTruthy();

    fireEvent.click(action);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("renders only feasibility-filtered supervisor verify actions", () => {
    render(
      <ProvocationCard
        card={reviewCard({
          id: "provocation:step-1:ai_self_report_only:sha256:test",
          type: "ai_self_report_only",
          stage: "verify",
          severity: "caution",
          title: "확인 필요 카드",
          prompt: "AI 완료 주장만 있으니 변경 파일을 확인할 수 있나요?",
          message: "확인 가능한 증거를 먼저 살펴보세요.",
          evidence: [{ refId: "agent.assistant_claim", source: "agent", label: "AI 완료 주장" }],
          actions: [{ id: "open_diff", label: "변경 보기", kind: "open_diff" }],
          primaryActionId: "open_diff",
          metadata: { supervisorEvaluationId: "eval-1" },
        })}
        mode="work"
      />,
    );

    expect(screen.getByTestId("provocation-primary-action").dataset.actionKind).toBe("open_diff");
    expect(screen.queryByText("미리보기 열기")).toBeNull();
    expect(screen.queryByText("앱 실행")).toBeNull();
    expect(screen.queryByText("테스트 실행")).toBeNull();
  });

  it("hides revise/nudge actions but keeps artifact-opening helpers (pure provocation)", () => {
    render(
      <ProvocationCard
        card={reviewCard({
          actions: [
            { id: "split", label: "단계 더 나누기", kind: "split_scope" },
            { id: "editprd", label: "PRD 수정", kind: "edit_prd" },
            { id: "diff", label: "변경 보기", kind: "open_diff" },
          ],
          primaryActionId: "diff",
        })}
        mode="work"
      />,
    );

    // "Revise the plan/PRD" nudges only seed a prompt or focus a field, so we do
    // not show them as buttons — the card just provokes, the user drives follow-up.
    expect(screen.queryByText("단계 더 나누기")).toBeNull();
    expect(screen.queryByText("PRD 수정")).toBeNull();
    // Helpers that actually open the artifact remain.
    expect(screen.getByText("변경 보기")).toBeTruthy();
  });

  it("renders no action buttons when a review card only suggests revise/nudge actions", () => {
    render(
      <ProvocationCard
        card={reviewCard({
          actions: [
            { id: "split", label: "단계 더 나누기", kind: "split_scope" },
            { id: "addverify", label: "검증 단계 추가", kind: "add_verification_step" },
          ],
        })}
        mode="work"
      />,
    );

    expect(screen.getByTestId("provocation-focal-question")).toBeTruthy();
    expect(screen.queryByTestId("provocation-actions")).toBeNull();
    expect(screen.queryByTestId("provocation-primary-action")).toBeNull();
  });

  it("renders one dominant focal question with capped evidence and capped non-risk actions", () => {
    render(
      <ProvocationCard
        card={reviewCard({
          type: "ai_self_report_only",
          stage: "verify",
          title: "확인 필요 카드",
          prompt: "AI 완료 주장만 있으니 변경 파일을 기준에 맞게 확인할 수 있나요?",
          message: "확인 가능한 증거를 먼저 살펴보세요.",
          evidence: [
            { source: "agent", label: "AI 완료 주장" },
            { source: "diff", label: "변경 파일", value: "src/App.tsx" },
            { source: "verification", label: "외부 테스트", value: "없음" },
            { source: "workmap", label: "추가 로그", value: "기록됨" },
          ],
          actions: [
            { id: "open_diff", label: "변경 코드 보기", kind: "open_diff" },
            { id: "open_preview", label: "미리보기 열기", kind: "open_preview" },
            { id: "run_tests", label: "테스트 실행", kind: "run_tests" },
            { id: "run_app", label: "앱 실행", kind: "run_app" },
            { id: "risk", label: "위험 감수 승인", kind: "continue_with_risk" },
          ],
          primaryActionId: "open_diff",
          modeCopy: { guided: "AI의 말과 직접 본 증거를 구분합니다." },
        })}
        mode="guided"
      />,
    );

    expect(screen.getAllByTestId("provocation-focal-question")).toHaveLength(1);
    expect(screen.getByTestId("provocation-focal-question").className).toContain("text-base");
    expect(screen.getAllByTestId("provocation-evidence-chip")).toHaveLength(3);
    expect(screen.getByTestId("provocation-actions").dataset.actionCount).toBe("3");
    expect(
      Array.from(document.querySelectorAll('[data-provocation-action="visible"]')),
    ).toHaveLength(3);
    expect(screen.queryByText("위험 감수 승인")).toBeNull();
  });

  it("keeps review cards visually distinguishable from permission cards", () => {
    const permissionCard: PermissionCardData = {
      toolCallId: "tool-1",
      toolName: "read_file",
      paramsPreview: "src/App.tsx",
      risk: "safe",
      diffPreview: null,
      args: { path: "src/App.tsx" },
      actionContext: { readFiles: ["src/App.tsx"] },
    };

    render(
      <>
        <ProvocationCard
          card={reviewCard({
            prompt: "변경 코드에서 완료 기준을 직접 확인할 수 있나요?",
            actions: [{ id: "open_diff", label: "변경 코드 보기", kind: "open_diff" }],
            primaryActionId: "open_diff",
          })}
          mode="work"
        />
        <PermissionCard card={permissionCard} onApprove={vi.fn()} onDeny={vi.fn()} />
      </>,
    );

    expect(screen.getByTestId("provocation-card").dataset.cardFamily).toBe("review-card");
    expect(screen.getByTestId("permission-card").dataset.cardFamily).toBe("permission-card");
    expect(screen.getByTestId("provocation-primary-action").dataset.actionKind).toBe("open_diff");
    expect(screen.getByTestId("card-approve")).toBeTruthy();
    expect(screen.getByTestId("card-deny")).toBeTruthy();
  });

  it("does not render dismiss controls when risk card lifecycle props are omitted", () => {
    const card = diffScopeDriftRule(
      ruleContext({
        goalText: "버튼 문구만 바꿔줘",
        targetFiles: ["src/App.tsx"],
        changedFiles: [
          { path: "src/App.tsx", category: "ui" },
          { path: "package.json", category: "dependency" },
        ],
      }),
    );
    expect(card?.severity).toBe("risk");

    render(<ProvocationCard card={card!} mode="standard" />);

    expect(screen.queryByTestId("provocation-dismiss")).toBeNull();
    expect(screen.queryByTestId("provocation-mark-irrelevant")).toBeNull();
  });

  it("renders the primary action first with its dedicated test id", () => {
    const card = diffScopeDriftRule(
      ruleContext({
        goalText: "버튼 문구만 바꿔줘",
        targetFiles: ["src/App.tsx"],
        changedFiles: [
          { path: "src/App.tsx", category: "ui" },
          { path: "package.json", category: "dependency" },
        ],
      }),
    );

    render(<ProvocationCard card={card!} mode="standard" />);

    expect(screen.getByTestId("provocation-primary-action").textContent).toContain(
      "파일별 Diff 보기",
    );
  });

  it("keeps proceed/risk approval out of the review-card action row", () => {
    const card = aiSelfReportOnlyRule(
      ruleContext({
        stage: "finalApproval",
        verification: { aiClaimedDone: true, externalTestRun: false },
      }),
    );

    render(<ProvocationCard card={card!} mode="standard" />);

    expect(screen.queryByText("미검증 상태로 승인")).toBeNull();
    expect(screen.getByTestId("provocation-primary-action").dataset.actionKind).not.toBe(
      "continue_with_risk",
    );
  });

  it("exposes accessible names and focusable controls", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const onMarkIrrelevant = vi.fn();
    render(
      <ProvocationCard
        card={reviewCard({
          prompt: "변경 코드에서 완료 기준을 직접 확인할 수 있나요?",
          actions: [{ id: "open_diff", label: "변경 코드 보기", kind: "open_diff" }],
          primaryActionId: "open_diff",
        })}
        mode="work"
        onAction={onAction}
        onDismiss={onDismiss}
        onMarkIrrelevant={onMarkIrrelevant}
      />,
    );

    const action = screen.getByRole("button", { name: "변경 코드 보기" });
    action.focus();
    expect(document.activeElement).toBe(action);
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "open_diff" }));

    fireEvent.click(screen.getByRole("button", { name: "검토 카드를 관련 없음으로 표시" }));
    fireEvent.click(screen.getByRole("button", { name: "검토 카드 닫기" }));

    expect(onMarkIrrelevant).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("ProvocationCardHost canonical mode visibility", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => cleanup());

  it("keeps caution cards visible for Expert migration input", () => {
    render(
      <ProvocationCardHost
        cards={[reviewCard({ id: "low-risk", severity: "caution" })]}
        mode="expert"
      />,
    );

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("work");
    expect(screen.getByText("검증 단계가 빠졌습니다")).toBeTruthy();
  });

  it("keeps risk cards visible in Work mode", () => {
    render(
      <ProvocationCardHost
        cards={[
          reviewCard({
            id: "risk",
            severity: "risk",
            type: "ai_self_report_only",
            title: "AI의 완료 보고만 있습니다",
          }),
        ]}
        mode="work"
      />,
    );

    expect(screen.getByTestId("provocation-card").dataset.severity).toBe("risk");
    expect(screen.getByText("AI의 완료 보고만 있습니다")).toBeTruthy();
  });

  it("keeps ranking behavior without mode suppression", () => {
    render(
      <ProvocationCardHost
        cards={[
          reviewCard({ id: "low-risk", severity: "caution" }),
          reviewCard({
            id: "risk-diff",
            severity: "risk",
            type: "diff_scope_drift",
            title: "목표 밖 변경이 섞였을 수 있습니다",
            metadata: { highRisk: true },
          }),
        ]}
        mode="expert"
      />,
    );

    expect(screen.getByTestId("provocation-card").dataset.cardType).toBe("diff_scope_drift");
    expect(screen.queryByText("검증 단계가 빠졌습니다")).toBeNull();
    expect(screen.getByText("목표 밖 변경이 섞였을 수 있습니다")).toBeTruthy();
  });
});
