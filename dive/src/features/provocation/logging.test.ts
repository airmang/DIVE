import { describe, expect, it } from "vitest";
import { buildProvocationLogPayload } from "./logging";
import type { ProvocationCard, ProvocationContext } from "./types";

function card(overrides: Partial<ProvocationCard> = {}): ProvocationCard {
  return {
    id: "ai_self_report_only:finalApproval:10",
    type: "ai_self_report_only",
    stage: "finalApproval",
    severity: "risk",
    title: "AI의 완료 보고만 있습니다",
    message: "실행 또는 테스트 증거 없이 완료 보고만 있습니다.",
    evidence: [{ source: "agent", label: "AI 완료 보고", value: "assistant 메시지 1개" }],
    actions: [
      {
        id: "continue",
        kind: "continue_with_risk",
        label: "위험을 감수하고 계속",
        requiresReason: true,
      },
    ],
    createdAt: "2026-06-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("provocation lifecycle logging payloads", () => {
  it("summarizes long prompt or code-like evidence instead of storing raw bodies", () => {
    const rawPrompt = [
      "import secretToken from './private';",
      "export function LoginForm() { return <input value={secretToken} />; }",
    ].join("\n");

    const payload = buildProvocationLogPayload({
      eventType: "provocation.card_shown",
      card: card({
        evidence: [{ source: "prompt", label: "사용자 요청", value: rawPrompt }],
      }),
      mode: "standard",
      context: {
        projectId: 1,
        sessionId: 2,
        verification: { aiClaimedDone: true, externalTestRun: false },
      } satisfies Partial<ProvocationContext>,
    });

    const encoded = JSON.stringify(payload);
    expect(encoded).not.toContain(rawPrompt);
    expect(encoded).not.toContain("secretToken");
    expect(payload.evidence[0].value).toMatchObject({
      kind: "summary",
      reason: "code_like",
      lineCount: 2,
    });
    expect(payload.verificationStatus?.statusIds).toEqual(
      expect.arrayContaining(["ai_self_report_only", "external_test_not_run"]),
    );
  });

  it("records selected action, required reason, verification status, and risk acceptance", () => {
    const payload = buildProvocationLogPayload({
      eventType: "provocation.continued_with_risk",
      card: card(),
      mode: "guided",
      action: {
        id: "continue",
        kind: "continue_with_risk",
        label: "위험을 감수하고 계속",
        requiresReason: true,
      },
      reason: "테스트는 실패했지만 변경 범위가 의도한 파일뿐임",
      context: {
        sessionId: 2,
        taskId: "step-1",
        toolCallId: "tool-1",
        verification: { testResult: "fail", failedButAccepted: true },
      },
    });

    expect(payload.lifecycleEvent).toBe("continued_with_risk");
    expect(payload.selectedAction).toMatchObject({
      id: "continue",
      kind: "continue_with_risk",
      requiresReason: true,
    });
    expect(payload.reasonRequired).toBe(true);
    expect(payload.reasonPresent).toBe(true);
    expect(payload.requiredReason.metrics?.wordCount).toBeGreaterThan(0);
    expect(payload.riskAccepted).toBe(true);
    expect(payload.verificationStatus?.verificationState).toBe("failed_but_accepted");
  });

  it("makes dismiss and mark-irrelevant export-distinguishable as lifecycle actions", () => {
    const dismissed = buildProvocationLogPayload({
      eventType: "provocation.dismissed",
      card: card(),
      mode: "standard",
    });
    const irrelevant = buildProvocationLogPayload({
      eventType: "provocation.marked_irrelevant",
      card: card(),
      mode: "standard",
    });

    expect(dismissed.selectedAction).toMatchObject({ kind: "dismiss" });
    expect(irrelevant.selectedAction).toMatchObject({ kind: "mark_irrelevant" });
    expect(dismissed.lifecycleEvent).toBe("dismissed");
    expect(irrelevant.lifecycleEvent).toBe("marked_irrelevant");
  });
});
