import { useState } from "react";
import { Button } from "../ui/button";

export type ApprovalOutcome = "approved" | "approved_with_concern" | "revision_requested";

export interface ApprovalDecision {
  outcome: ApprovalOutcome;
  note: string | null;
}

export type ApprovalDecisionWithTime = ApprovalDecision & { decided_at: number };

interface Props {
  disabled?: boolean;
  prompt?: string;
  onDecide: (decision: ApprovalDecision) => void;
}

export function ApprovalJudgment({ disabled, prompt, onDecide }: Props) {
  const [stance, setStance] = useState<"none" | "confirmed" | "concern">("none");
  const [note, setNote] = useState("");
  const noteOk = note.trim().length > 0;

  return (
    <div className="flex flex-col gap-2" data-testid="approval-judgment">
      <p className="text-xs text-fg-muted">{prompt ?? "결과를 직접 확인했나요?"}</p>
      <div className="flex gap-2">
        <Button
          variant={stance === "confirmed" ? "primary" : "ghost"}
          size="sm"
          disabled={disabled}
          data-testid="judgment-confirmed"
          onClick={() => setStance("confirmed")}
        >
          확인함
        </Button>
        <Button
          variant={stance === "concern" ? "danger" : "ghost"}
          size="sm"
          disabled={disabled}
          data-testid="judgment-concern"
          onClick={() => setStance("concern")}
        >
          우려 있음
        </Button>
      </div>

      {stance === "confirmed" ? (
        <Button
          size="sm"
          disabled={disabled}
          data-testid="judgment-approve"
          onClick={() => onDecide({ outcome: "approved", note: null })}
        >
          승인
        </Button>
      ) : null}

      {stance === "concern" ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="rounded-md border bg-bg-panel2 p-2 text-xs"
            placeholder="무엇이 우려되나요? (한 줄)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="judgment-note"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || !noteOk}
              data-testid="judgment-approve-anyway"
              onClick={() => onDecide({ outcome: "approved_with_concern", note: note.trim() })}
            >
              그래도 승인
            </Button>
            <Button
              size="sm"
              disabled={disabled || !noteOk}
              data-testid="judgment-request-revision"
              onClick={() => onDecide({ outcome: "revision_requested", note: note.trim() })}
            >
              수정 요청
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ApprovalJudgment;
