// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionGate } from "./DecisionGate";
import { deriveDecisionGatePolicy } from "./decisionGatePolicy";
import type { ProvocationCard, VerificationStatusItem } from "../../features/provocation";

const automatedEvidence: VerificationStatusItem = {
  id: "automated_tests_passed",
  label: "자동 테스트 통과",
  evidenceBacked: true,
  tone: "success",
};

const aiSelfReportOnly: VerificationStatusItem = {
  id: "ai_self_report_only",
  label: "AI 자가보고만 있음",
  evidenceBacked: false,
  tone: "warn",
};

const manualPreviewChecked: VerificationStatusItem = {
  id: "preview_checked",
  label: "수동 프리뷰 확인됨",
  evidenceBacked: true,
  tone: "success",
};

function driftCard(overrides: Partial<ProvocationCard> = {}): ProvocationCard {
  return {
    id: "diff_scope_drift:finalApproval:1",
    type: "diff_scope_drift",
    stage: "finalApproval",
    severity: "risk",
    title: "목표 밖 변경이 섞였을 수 있습니다",
    message: "고위험 파일이 함께 바뀌었습니다.",
    evidence: [{ source: "diff", label: "관련 확인 필요 파일", value: "package.json" }],
    actions: [],
    createdAt: "2026-06-13T00:00:00.000Z",
    metadata: { highRisk: true, highRiskFiles: ["package.json"] },
    ...overrides,
  };
}

function renderGate(overrides: Partial<ComponentProps<typeof DecisionGate>> = {}) {
  const props: ComponentProps<typeof DecisionGate> = {
    verificationStatuses: [],
    agencyState: null,
    provocationCards: [],
    verifyLog: null,
    rollbackAvailable: true,
    verifyRunning: false,
    onApprove: vi.fn(),
    onAcceptRisk: vi.fn(),
    onRequestChanges: vi.fn(),
    onVerifyFirst: vi.fn(),
    onRevert: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
  render(<DecisionGate {...props} />);
  return props;
}

describe("DecisionGate policy", () => {
  afterEach(() => cleanup());

  it("allows ordinary evidence-backed approval without a reason even when rollback is absent", () => {
    const policy = deriveDecisionGatePolicy({
      verificationStatuses: [automatedEvidence],
      rollbackAvailable: false,
    });

    expect(policy.requiresReason).toBe(false);
    expect(policy.canApproveDirectly).toBe(true);
  });

  it("does not treat preview-only evidence as verified without criterion confirmation", () => {
    const policy = deriveDecisionGatePolicy({
      verificationStatuses: [manualPreviewChecked],
      rollbackAvailable: false,
    });

    expect(policy.hasVerifiedEvidence).toBe(false);
    expect(policy.requiresReason).toBe(true);
  });

  it("blocks direct approval for preview-only evidence even when rollback is available", () => {
    const policy = deriveDecisionGatePolicy({
      verificationStatuses: [manualPreviewChecked],
      rollbackAvailable: true,
    });

    expect(policy.canApproveDirectly).toBe(false);
    expect(policy.requiresReason).toBe(true);
    expect(policy.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "unverified" })]),
    );
  });

  it("allows direct approval when preview evidence is linked to an acceptance criterion", () => {
    const policy = deriveDecisionGatePolicy({
      verificationStatuses: [manualPreviewChecked],
      acceptanceCriterionConfirmed: true,
      rollbackAvailable: false,
    });

    expect(policy.hasVerifiedEvidence).toBe(true);
    expect(policy.canApproveDirectly).toBe(true);
  });

  it("clears the unverified reason when preview evidence is linked to an acceptance criterion", () => {
    const policy = deriveDecisionGatePolicy({
      verificationStatuses: [manualPreviewChecked],
      acceptanceCriterionConfirmed: true,
      rollbackAvailable: true,
    });

    expect(policy.reasons).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "unverified" })]),
    );
    expect(policy.canApproveDirectly).toBe(true);
  });

  it("enables direct approval for preview evidence only after criterion confirmation is forwarded", () => {
    const props: ComponentProps<typeof DecisionGate> = {
      verificationStatuses: [manualPreviewChecked],
      agencyState: null,
      provocationCards: [],
      verifyLog: null,
      rollbackAvailable: true,
      verifyRunning: false,
      onApprove: vi.fn(),
      onAcceptRisk: vi.fn(),
      onRequestChanges: vi.fn(),
      onVerifyFirst: vi.fn(),
      onRevert: vi.fn(),
      onStop: vi.fn(),
    };

    const { rerender } = render(<DecisionGate {...props} />);

    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);

    rerender(<DecisionGate {...props} acceptanceCriterionConfirmed />);

    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires a short reason for AI self-report only approval", () => {
    const props = renderGate({
      verificationStatuses: [aiSelfReportOnly],
      rollbackAvailable: true,
    });

    expect(screen.getByTestId("decision-gate").dataset.reasonRequired).toBe("true");
    expect((screen.getByTestId("decision-gate-approve") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("decision-gate-risk-approve") as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByTestId("decision-gate-risk-reason"), {
      target: { value: "직접 화면을 확인했고 남은 위험을 기록함" },
    });
    fireEvent.click(screen.getByTestId("decision-gate-risk-approve"));

    expect(props.onAcceptRisk).toHaveBeenCalledWith("직접 화면을 확인했고 남은 위험을 기록함");
  });

  it("requires a reason after failed tests", () => {
    const policy = deriveDecisionGatePolicy({
      verifyLog: {
        intent_match: true,
        test_result: "fail",
        details: "1 failed",
        model: "mock",
        ran_at: 1,
      },
      rollbackAvailable: true,
    });

    expect(policy.reasons.map((reason) => reason.id)).toContain("failed_test");
    expect(policy.requiresReason).toBe(true);
  });

  it("requires a reason for high-risk unexpected files with concrete file evidence", () => {
    const policy = deriveDecisionGatePolicy({
      provocationCards: [driftCard()],
      rollbackAvailable: true,
    });

    expect(policy.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "high_risk_unexpected_files",
          evidence: "package.json",
        }),
      ]),
    );
  });

  it("requires a rollback-unavailable reason only when approval is otherwise unverified", () => {
    const policy = deriveDecisionGatePolicy({
      verificationStatuses: [],
      rollbackAvailable: false,
    });

    expect(policy.reasons.map((reason) => reason.id)).toContain("rollback_unavailable");
    expect(policy.requiresReason).toBe(true);
  });

  it("renders the immediate final-decision actions for risk states", () => {
    renderGate({
      verificationStatuses: [aiSelfReportOnly],
      rollbackAvailable: false,
    });

    expect(screen.getByTestId("decision-gate-approve")).toBeTruthy();
    expect(screen.getByTestId("decision-gate-risk-approve")).toBeTruthy();
    expect(screen.getByTestId("decision-gate-request-changes")).toBeTruthy();
    expect(screen.getByTestId("decision-gate-verify-first")).toBeTruthy();
    expect(screen.getByTestId("decision-gate-revert")).toBeTruthy();
    expect(screen.getByTestId("decision-gate-stop")).toBeTruthy();
  });
});
