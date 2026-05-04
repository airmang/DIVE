import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { CardStateBadge } from "./CardStateBadge";
import { getCardStateMeta } from "./card-state-meta";
import type { CardState, CardTileData } from "./types";

export type CardTransitionKind =
  | "enter_instruct"
  | "request_verify"
  | "approve"
  | "reject"
  | "reopen_from_reject"
  | "extend";

export interface VerifyLogView {
  intent_match: boolean;
  test_result: "pass" | "fail" | "skipped";
  details: string;
  model: string;
  ran_at: number;
  test_command?: string | null;
  test_exit_code?: number | null;
  test_stdout?: string | null;
  test_stderr?: string | null;
}

interface CardDetailPanelProps {
  open: boolean;
  card: CardTileData | null;
  toolCallCount?: number;
  verifyLog?: VerifyLogView | null;
  verifyState?: "idle" | "running" | "error";
  verifyError?: string | null;
  checkpointBadge?: string | null;
  onOpenChange: (open: boolean) => void;
  onInstructionChange?: (cardId: number, instruction: string) => void | Promise<void>;
  onTestCommandChange?: (cardId: number, testCommand: string) => void | Promise<void>;
  onTransition?: (
    cardId: number,
    transition: CardTransitionKind,
    options?: { approveForce?: boolean },
  ) => void | Promise<void>;
  onVerify?: (cardId: number) => void | Promise<void>;
  onOpenCode?: (cardId: number) => void;
}

export function CardDetailPanel({
  open,
  card,
  toolCallCount = 0,
  verifyLog = null,
  verifyState = "idle",
  verifyError = null,
  checkpointBadge = null,
  onOpenChange,
  onInstructionChange,
  onTestCommandChange,
  onTransition,
  onVerify,
  onOpenCode,
}: CardDetailPanelProps) {
  const [instructionDraft, setInstructionDraft] = useState("");
  const [testCommandDraft, setTestCommandDraft] = useState("");
  const [forceApprove, setForceApprove] = useState(false);

  useEffect(() => {
    if (card) {
      setInstructionDraft(card.summary ?? "");
      setTestCommandDraft(card.testCommand ?? "");
      setForceApprove(false);
    } else {
      setInstructionDraft("");
      setTestCommandDraft("");
      setForceApprove(false);
    }
  }, [card]);

  if (!card) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[560px]" data-testid="card-detail-panel">
          <DialogHeader>
            <DialogTitle>카드 없음</DialogTitle>
            <DialogDescription>선택된 카드가 없습니다.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const meta = getCardStateMeta(card.state);
  const trimmedDraft = instructionDraft.trim();
  const instructionNonEmpty = trimmedDraft.length > 0;
  const approveEligible = !!verifyLog && verifyLog.intent_match && verifyLog.test_result !== "fail";

  const handleSaveInstruction = async () => {
    if (onInstructionChange) {
      await onInstructionChange(card.id, instructionDraft);
    }
    if (onTestCommandChange) {
      await onTestCommandChange(card.id, testCommandDraft);
    }
  };

  const handleTransition = async (
    transition: CardTransitionKind,
    options?: { approveForce?: boolean },
  ) => {
    if (onTransition) {
      await onTransition(card.id, transition, options);
    }
  };

  const handleVerify = async () => {
    if (onVerify) {
      await onVerify(card.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[560px]"
        data-testid="card-detail-panel"
        data-card-state={card.state}
        data-card-id={card.id}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CardStateBadge state={card.state} mode="expanded" />
            <DialogTitle>{card.title}</DialogTitle>
          </div>
          <DialogDescription>
            {meta.label} · 카드 #{card.id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {renderStateBody(card.state, {
            instructionDraft,
            setInstructionDraft,
            testCommandDraft,
            setTestCommandDraft,
            trimmedDraftLength: trimmedDraft.length,
            toolCallCount,
            verifyLog,
            verifyState,
            verifyError,
            onVerify: handleVerify,
            forceApprove,
            setForceApprove,
            checkpointBadge,
          })}
        </div>

        <DialogFooter>
          {renderStateFooter(card.state, {
            instructionNonEmpty,
            toolCallCount,
            verifyLog,
            approveEligible,
            forceApprove,
            onSaveInstruction: handleSaveInstruction,
            onTransition: handleTransition,
            onOpenCode: onOpenCode ? () => onOpenCode(card.id) : undefined,
            onClose: () => onOpenChange(false),
          })}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BodyContext {
  instructionDraft: string;
  setInstructionDraft: (v: string) => void;
  testCommandDraft: string;
  setTestCommandDraft: (v: string) => void;
  trimmedDraftLength: number;
  toolCallCount: number;
  verifyLog: VerifyLogView | null;
  verifyState: "idle" | "running" | "error";
  verifyError: string | null;
  onVerify: () => Promise<void>;
  forceApprove: boolean;
  setForceApprove: (v: boolean) => void;
  checkpointBadge: string | null;
}

function renderStateBody(state: CardState, ctx: BodyContext) {
  switch (state) {
    case "decomposed":
    case "instructed":
    case "rejected":
      return (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-fg-muted" htmlFor="instruction-input">
            지시 (Instruction)
          </label>
          <textarea
            id="instruction-input"
            data-testid="instruction-input"
            value={ctx.instructionDraft}
            onChange={(e) => ctx.setInstructionDraft(e.target.value)}
            rows={4}
            className="w-full rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
            placeholder="이 카드에서 AI에게 시킬 일을 구체적으로 적으세요"
          />
          <p className="text-[11px] text-fg-muted">
            {state === "rejected"
              ? "거부 사유를 반영해 지시를 수정한 뒤 다시 시작하세요."
              : "지시가 작성되면 I 단계로 진입합니다."}
          </p>
          <div className="space-y-1 pt-2">
            <label className="text-xs font-semibold text-fg-muted" htmlFor="test-command-input">
              검증 명령 (선택)
            </label>
            <input
              id="test-command-input"
              data-testid="test-command-input"
              value={ctx.testCommandDraft}
              onChange={(e) => ctx.setTestCommandDraft(e.target.value)}
              className="w-full rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
              placeholder="예: pnpm test src/App.test.ts"
            />
            <p className="text-[11px] text-fg-muted">
              V 단계 검증 시 프로젝트 루트에서 실행됩니다. 위험하거나 프로젝트 밖으로 나가는
              명령은 차단됩니다.
            </p>
          </div>
          {state === "instructed" ? (
            <p className="text-[11px] text-fg-muted" data-testid="tool-call-count">
              도구 호출: {ctx.toolCallCount}회
              {ctx.toolCallCount === 0 ? " · 도구 호출 1회 이상 후 검증 시작 가능" : ""}
            </p>
          ) : null}
        </div>
      );
    case "verifying":
      return (
        <div className="space-y-3" data-testid="verifying-body">
          <p className="text-xs text-fg-muted">
            AI가 지시와 코드 변경의 일치 여부를 분석합니다. 결과를 확인한 뒤 최종 승인 또는 거부를
            선택하세요.
          </p>
          {ctx.verifyLog ? (
            <div className="space-y-2" data-testid="verify-log">
              <div
                className="rounded-md border border-border bg-bg-panel2 p-3"
                data-testid="verify-intent-match"
                data-intent-match={ctx.verifyLog.intent_match ? "true" : "false"}
              >
                <p className="text-xs font-semibold text-fg-muted">의도-코드 일치</p>
                <p className="mt-0.5 text-sm font-medium text-fg">
                  {ctx.verifyLog.intent_match ? "일치 ✓" : "불일치 ✗"}
                </p>
              </div>
              <div
                className="rounded-md border border-border bg-bg-panel2 p-3"
                data-testid="verify-test-result"
                data-test-result={ctx.verifyLog.test_result}
              >
                <p className="text-xs font-semibold text-fg-muted">테스트 결과</p>
                <p className="mt-0.5 text-sm font-medium text-fg">
                  {ctx.verifyLog.test_result === "pass"
                    ? "통과"
                    : ctx.verifyLog.test_result === "fail"
                      ? "실패"
                    : "실행 안 함"}
                </p>
              </div>
              {ctx.verifyLog.test_command ? (
                <div
                  className="space-y-2 rounded-md border border-border bg-bg-panel2 p-3"
                  data-testid="verify-test-command"
                >
                  <div>
                    <p className="text-xs font-semibold text-fg-muted">검증 명령</p>
                    <p className="mt-0.5 break-all font-mono text-xs text-fg">
                      {ctx.verifyLog.test_command}
                    </p>
                    <p className="mt-1 text-[10px] text-fg-muted">
                      종료 코드:{" "}
                      {ctx.verifyLog.test_exit_code === null ||
                      ctx.verifyLog.test_exit_code === undefined
                        ? "(없음)"
                        : ctx.verifyLog.test_exit_code}
                    </p>
                  </div>
                  {ctx.verifyLog.test_stdout ? (
                    <pre
                      className="max-h-32 overflow-auto rounded border border-border bg-bg-panel px-2 py-1 text-[11px] text-fg"
                      data-testid="verify-test-stdout"
                    >
                      {ctx.verifyLog.test_stdout}
                    </pre>
                  ) : null}
                  {ctx.verifyLog.test_stderr ? (
                    <pre
                      className="max-h-32 overflow-auto rounded border border-border bg-bg-panel px-2 py-1 text-[11px] text-danger"
                      data-testid="verify-test-stderr"
                    >
                      {ctx.verifyLog.test_stderr}
                    </pre>
                  ) : null}
                </div>
              ) : null}
              <div
                className="rounded-md border border-border bg-bg-panel2 p-3"
                data-testid="verify-details"
              >
                <p className="text-xs font-semibold text-fg-muted">세부 내역</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg">
                  {ctx.verifyLog.details || "(없음)"}
                </p>
                <p className="mt-1 text-[10px] text-fg-muted">
                  모델: {ctx.verifyLog.model} · {new Date(ctx.verifyLog.ran_at).toLocaleString()}
                </p>
              </div>

              {!(ctx.verifyLog.intent_match && ctx.verifyLog.test_result !== "fail") ? (
                <label
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-xs"
                  data-testid="force-approve-toggle"
                >
                  <input
                    type="checkbox"
                    checked={ctx.forceApprove}
                    onChange={(e) => ctx.setForceApprove(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    검증이 성공하지 않았습니다. <b>그래도 최종 승인</b>하려면 체크하세요.
                  </span>
                </label>
              ) : null}
            </div>
          ) : (
            <div
              className="rounded-md border border-dashed border-border bg-bg-panel2 p-3 text-xs text-fg-muted"
              data-testid="verify-empty"
            >
              아직 검증이 실행되지 않았습니다. [검증 실행] 버튼을 눌러 시작하세요.
            </div>
          )}

          {ctx.verifyState === "running" ? (
            <p className="text-xs text-fg-muted" data-testid="verify-running">
              검증 중...
            </p>
          ) : null}
          {ctx.verifyState === "error" && ctx.verifyError ? (
            <p className="text-xs text-danger" data-testid="verify-error">
              검증 실패: {ctx.verifyError}
            </p>
          ) : null}

          <Button
            variant="outline"
            size="sm"
            data-testid="btn-run-verify"
            disabled={ctx.verifyState === "running"}
            onClick={() => {
              void ctx.onVerify();
            }}
          >
            {ctx.verifyLog ? "재검증" : "검증 실행"}
          </Button>
        </div>
      );
    case "verified":
      return (
        <div className="space-y-2" data-testid="verified-body">
          <p className="text-sm text-fg">검증을 통과했습니다.</p>
          <p className="text-xs text-fg-muted">
            코드 결과를 확인하거나, 문제가 발견되면 다시 거부할 수 있습니다.
          </p>
          {ctx.checkpointBadge ? (
            <p
              className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
              data-testid="checkpoint-badge"
            >
              체크포인트 기록됨 · {ctx.checkpointBadge}
            </p>
          ) : null}
        </div>
      );
    case "extended":
      return (
        <div className="space-y-2" data-testid="extended-body">
          <p className="text-sm text-fg">E 단계 통합·확장 완료.</p>
          <p className="text-xs text-fg-muted">읽기 전용. 다음 세션에서 이어서 작업하세요.</p>
        </div>
      );
  }
}

interface FooterContext {
  instructionNonEmpty: boolean;
  toolCallCount: number;
  verifyLog: VerifyLogView | null;
  approveEligible: boolean;
  forceApprove: boolean;
  onSaveInstruction: () => Promise<void>;
  onTransition: (t: CardTransitionKind, options?: { approveForce?: boolean }) => Promise<void>;
  onOpenCode?: () => void;
  onClose: () => void;
}

function renderStateFooter(state: CardState, ctx: FooterContext) {
  switch (state) {
    case "decomposed":
      return (
        <>
          <Button variant="ghost" onClick={ctx.onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            data-testid="btn-enter-instruct"
            disabled={!ctx.instructionNonEmpty}
            onClick={async () => {
              await ctx.onSaveInstruction();
              await ctx.onTransition("enter_instruct");
              ctx.onClose();
            }}
          >
            I 단계로 진입
          </Button>
        </>
      );
    case "instructed":
      return (
        <>
          <Button
            variant="outline"
            data-testid="btn-save-instruction"
            disabled={!ctx.instructionNonEmpty}
            onClick={async () => {
              await ctx.onSaveInstruction();
            }}
          >
            지시 저장
          </Button>
          <Button
            variant="primary"
            data-testid="btn-request-verify"
            disabled={!ctx.instructionNonEmpty || ctx.toolCallCount === 0}
            onClick={async () => {
              await ctx.onTransition("request_verify");
              ctx.onClose();
            }}
          >
            V 단계로 진입 (검증 시작)
          </Button>
        </>
      );
    case "verifying": {
      const canApprove = !!ctx.verifyLog && (ctx.approveEligible || ctx.forceApprove);
      return (
        <>
          <Button
            variant="outline"
            data-testid="btn-reject"
            onClick={async () => {
              await ctx.onTransition("reject");
              ctx.onClose();
            }}
          >
            거부
          </Button>
          <Button
            variant="primary"
            data-testid="btn-approve"
            disabled={!canApprove}
            onClick={async () => {
              await ctx.onTransition("approve", {
                approveForce: !ctx.approveEligible && ctx.forceApprove,
              });
              ctx.onClose();
            }}
          >
            최종 승인
          </Button>
        </>
      );
    }
    case "verified":
      return (
        <>
          <Button
            variant="outline"
            data-testid="btn-open-code"
            onClick={() => {
              ctx.onOpenCode?.();
              ctx.onClose();
            }}
          >
            코드 보기
          </Button>
          <Button
            variant="ghost"
            data-testid="btn-reject"
            onClick={async () => {
              await ctx.onTransition("reject");
              ctx.onClose();
            }}
          >
            거부 — 다시 작업
          </Button>
          <Button variant="primary" onClick={ctx.onClose}>
            닫기
          </Button>
        </>
      );
    case "rejected":
      return (
        <>
          <Button variant="ghost" onClick={ctx.onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            data-testid="btn-reopen"
            disabled={!ctx.instructionNonEmpty}
            onClick={async () => {
              await ctx.onSaveInstruction();
              await ctx.onTransition("reopen_from_reject");
              ctx.onClose();
            }}
          >
            다시 I 단계로 진입
          </Button>
        </>
      );
    case "extended":
      return (
        <Button variant="primary" onClick={ctx.onClose}>
          닫기
        </Button>
      );
  }
}

export default CardDetailPanel;
