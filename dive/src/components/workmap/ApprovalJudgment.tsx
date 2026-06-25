import { useId, useState } from "react";
import { Button } from "../ui/button";
import { useT } from "../../i18n";

export type ApprovalOutcome =
  | "approved"
  | "approved_with_concern"
  | "revision_requested"
  | "verification_deferred";

export interface ApprovalDecision {
  outcome: ApprovalOutcome;
  note: string | null;
  observationEvidence?: {
    observationIds: string[];
    manualChecks: string[];
    criterionIds: string[];
  } | null;
}

export type ApprovalDecisionWithTime = ApprovalDecision & { decided_at: number };

interface Props {
  disabled?: boolean;
  prompt?: string;
  onDecide: (decision: ApprovalDecision) => void;
}

export function ApprovalJudgment({ disabled, prompt, onDecide }: Props) {
  const t = useT();
  const noteId = useId();
  const [stance, setStance] = useState<"none" | "confirmed" | "concern">("none");
  const [note, setNote] = useState("");
  const noteOk = note.trim().length > 0;

  return (
    <div className="flex flex-col gap-2" data-testid="approval-judgment">
      <p className="text-xs text-fg-muted">{prompt ?? t("approval_judgment.prompt_default")}</p>
      <div className="flex gap-2">
        <Button
          variant={stance === "confirmed" ? "primary" : "ghost"}
          size="sm"
          disabled={disabled}
          data-testid="judgment-confirmed"
          onClick={() => setStance("confirmed")}
        >
          {t("approval_judgment.confirmed")}
        </Button>
        <Button
          variant={stance === "concern" ? "danger" : "ghost"}
          size="sm"
          disabled={disabled}
          data-testid="judgment-concern"
          onClick={() => setStance("concern")}
        >
          {t("approval_judgment.concern")}
        </Button>
      </div>

      {stance === "confirmed" ? (
        <Button
          size="sm"
          disabled={disabled}
          data-testid="judgment-approve"
          onClick={() => onDecide({ outcome: "approved", note: null })}
        >
          {t("approval_judgment.approve")}
        </Button>
      ) : null}

      {stance === "concern" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={noteId} className="text-xs font-medium text-fg-muted">
            {t("approval_judgment.concern_reason_label")}
          </label>
          <textarea
            id={noteId}
            className="rounded-md border bg-bg-panel2 p-2 text-xs"
            placeholder={t("approval_judgment.concern_reason_placeholder")}
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
              {t("approval_judgment.approve_anyway")}
            </Button>
            <Button
              size="sm"
              disabled={disabled || !noteOk}
              data-testid="judgment-request-revision"
              onClick={() => onDecide({ outcome: "revision_requested", note: note.trim() })}
            >
              {t("approval_judgment.request_revision")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ApprovalJudgment;
