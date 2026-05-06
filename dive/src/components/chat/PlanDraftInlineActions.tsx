import { Check, Pencil } from "lucide-react";
import { Button } from "../ui/button";
import { useT } from "../../i18n";

interface PlanDraftInlineActionsProps {
  onApprove: () => void;
  onRequestChanges: () => void;
  disabled?: boolean;
}

export function PlanDraftInlineActions({
  onApprove,
  onRequestChanges,
  disabled = false,
}: PlanDraftInlineActionsProps) {
  return (
    <div
      className="-mt-2 flex flex-wrap gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2"
      data-testid="plan-draft-inline-actions"
    >
      <Button
        variant="primary"
        size="sm"
        onClick={onApprove}
        disabled={disabled}
        data-testid="plan-inline-approve"
      >
        <Check />
        <PlanApproveLabel />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onRequestChanges}
        disabled={disabled}
        data-testid="plan-inline-request-changes"
      >
        <Pencil />
        <PlanRequestChangesLabel />
      </Button>
    </div>
  );
}

function PlanApproveLabel() {
  const t = useT();
  return <>{t("roadmap.chat_actions.plan_approve")}</>;
}

function PlanRequestChangesLabel() {
  const t = useT();
  return <>{t("roadmap.chat_actions.plan_request_changes")}</>;
}
