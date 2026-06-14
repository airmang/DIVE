// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    actions: [{ id: "add", label: "검증 단계 추가", kind: "add_verification_step" }],
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
  afterEach(() => cleanup());

  it("renders Guided with a focal question, evidence, explanation, and actions", () => {
    render(<ProvocationCard card={reviewCard()} mode="guided" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("guided");
    expect(screen.getByText("검증 단계가 빠졌습니다")).toBeTruthy();
    expect(screen.getByTestId("provocation-prompt").textContent).toContain(
      "무엇으로 확인할 건가요",
    );
    expect(screen.queryByText(/틀렸음을 확인하는 단계/)).toBeNull();
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText(/승인 판단이 쉬워집니다/)).toBeTruthy();
    expect(screen.getByText("검증 단계 추가")).toBeTruthy();
  });

  it("renders Work without secondary message or Guided explanation", () => {
    render(<ProvocationCard card={reviewCard()} mode="standard" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("work");
    expect(screen.getByTestId("provocation-prompt").textContent).toContain(
      "무엇으로 확인할 건가요",
    );
    expect(screen.queryByText(/틀렸음을 확인하는 단계/)).toBeNull();
    expect(screen.queryByText(/승인 판단이 쉬워집니다/)).toBeNull();
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText("검증 단계 추가")).toBeTruthy();
  });

  it("normalizes Expert migration input to Work while keeping evidence and actions", () => {
    render(<ProvocationCard card={reviewCard({ severity: "risk" })} mode="expert" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("work");
    expect(screen.getByText("검증 단계가 빠졌습니다")).toBeTruthy();
    expect(screen.getByTestId("provocation-prompt").textContent).toContain(
      "무엇으로 확인할 건가요",
    );
    expect(screen.queryByText(/틀렸음을 확인하는 단계/)).toBeNull();
    expect(screen.queryByText(/승인 판단이 쉬워집니다/)).toBeNull();
    expect(screen.getByTestId("provocation-evidence").textContent).toContain("없음");
    expect(screen.getByText("검증 단계 추가")).toBeTruthy();
  });

  it("accepts canonical Work mode directly", () => {
    render(<ProvocationCard card={reviewCard()} mode="work" />);

    expect(screen.getByTestId("provocation-card").dataset.mode).toBe("work");
    expect(screen.getByTestId("provocation-prompt").textContent).toContain(
      "무엇으로 확인할 건가요",
    );
    expect(screen.queryByText(/틀렸음을 확인하는 단계/)).toBeNull();
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

    const action = screen.getByTestId("provocation-action") as HTMLButtonElement;
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

  it("shows the risk action reason prompt from the card action", () => {
    const card = aiSelfReportOnlyRule(
      ruleContext({
        stage: "finalApproval",
        verification: { aiClaimedDone: true, externalTestRun: false },
      }),
    );

    render(<ProvocationCard card={card!} mode="standard" />);

    fireEvent.click(screen.getByText("미검증 상태로 승인"));
    expect(screen.getByTestId("provocation-risk-reason-label").textContent).toBe(
      "무엇을 근거로 미검증 상태를 수용하나요?",
    );
  });
});

describe("ProvocationCardHost canonical mode visibility", () => {
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
