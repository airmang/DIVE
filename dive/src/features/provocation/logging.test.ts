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

  it("keeps action availability metadata compact and explicit", () => {
    const payload = buildProvocationLogPayload({
      eventType: "provocation.action_clicked",
      card: card(),
      mode: "standard",
      action: {
        id: "rollback",
        kind: "rollback_last_change",
        label: "마지막 변경 되돌리기",
        disabledReason: "복구 경로 없음",
        todoId: "S-009-terminal-rollback",
      },
    });

    expect(payload.selectedAction).toMatchObject({
      id: "rollback",
      kind: "rollback_last_change",
      disabledReason: "복구 경로 없음",
      todoId: "S-009-terminal-rollback",
    });
    expect(JSON.stringify(payload.selectedAction)).not.toContain("```");
  });

  it("adds stable agency metadata without raw file or command bodies", () => {
    const payload = buildProvocationLogPayload({
      eventType: "provocation.continued_with_risk",
      card: card({
        type: "diff_scope_drift",
        stage: "execute",
        evidence: [{ source: "diff", label: "변경 파일", value: "package.json" }],
        metadata: {
          changedFiles: ["src/App.tsx", "package.json"],
          targetFiles: ["src/App.tsx"],
          highRiskFiles: ["package.json"],
          affectedCommands: ["pnpm install --registry https://example.invalid"],
        },
      }),
      mode: "standard",
      action: {
        id: "continue",
        kind: "continue_with_risk",
        label: "위험을 감수하고 계속",
        requiresReason: true,
      },
      reason: "의존성 변경이 목표 범위에 필요함",
      context: {
        changedFiles: [{ path: "src/App.tsx" }, { path: "package.json" }],
        targetFiles: ["src/App.tsx"],
      },
    });

    expect(payload.agencyComponent).toBe("decision");
    expect(payload.agencyState).toBe("approved_with_risk");
    expect(payload.riskLevel).toBe("risk");
    expect(payload.affectedFiles).toEqual({
      changedFiles: ["src/App.tsx", "package.json"],
      targetFiles: ["src/App.tsx"],
      highRiskFiles: ["package.json"],
    });
    expect(payload.affectedCommands).toEqual([
      expect.objectContaining({ kind: "command", redacted: true }),
    ]);
    expect(JSON.stringify(payload.affectedCommands)).not.toContain("pnpm install");
    expect(payload.decision).toMatchObject({
      event: "continued_with_risk",
      actionKind: "continue_with_risk",
    });
    expect(payload.reasonPresent).toBe(true);
  });
});
