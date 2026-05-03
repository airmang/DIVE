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

interface CardDetailPanelProps {
  open: boolean;
  card: CardTileData | null;
  toolCallCount?: number;
  onOpenChange: (open: boolean) => void;
  onInstructionChange?: (cardId: number, instruction: string) => void | Promise<void>;
  onTransition?: (cardId: number, transition: CardTransitionKind) => void | Promise<void>;
  onOpenCode?: (cardId: number) => void;
}

export function CardDetailPanel({
  open,
  card,
  toolCallCount = 0,
  onOpenChange,
  onInstructionChange,
  onTransition,
  onOpenCode,
}: CardDetailPanelProps) {
  const [instructionDraft, setInstructionDraft] = useState("");

  useEffect(() => {
    if (card) {
      setInstructionDraft(card.summary ?? "");
    } else {
      setInstructionDraft("");
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

  const handleSaveInstruction = async () => {
    if (onInstructionChange) {
      await onInstructionChange(card.id, instructionDraft);
    }
  };

  const handleTransition = async (transition: CardTransitionKind) => {
    if (onTransition) {
      await onTransition(card.id, transition);
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
            trimmedDraftLength: trimmedDraft.length,
            toolCallCount,
          })}
        </div>

        <DialogFooter>
          {renderStateFooter(card.state, {
            instructionNonEmpty,
            toolCallCount,
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
  trimmedDraftLength: number;
  toolCallCount: number;
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
        <div className="space-y-2" data-testid="verifying-body">
          <p className="text-sm text-fg">AI 자체검증이 진행 중입니다.</p>
          <p className="text-xs text-fg-muted">
            결과를 확인한 뒤 최종 승인 또는 거부를 선택하세요. (3-2에서 실제 검증 로직 추가)
          </p>
        </div>
      );
    case "verified":
      return (
        <div className="space-y-2" data-testid="verified-body">
          <p className="text-sm text-fg">검증을 통과했습니다.</p>
          <p className="text-xs text-fg-muted">
            코드 결과를 확인하거나, 문제가 발견되면 다시 거부할 수 있습니다.
          </p>
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
  onSaveInstruction: () => Promise<void>;
  onTransition: (t: CardTransitionKind) => Promise<void>;
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
    case "verifying":
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
            onClick={async () => {
              await ctx.onTransition("approve");
              ctx.onClose();
            }}
          >
            최종 승인
          </Button>
        </>
      );
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
