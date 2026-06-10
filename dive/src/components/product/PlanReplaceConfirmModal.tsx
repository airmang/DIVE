import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { useT } from "../../i18n";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

interface PlanReplaceConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirms discarding an existing APPROVED plan before generating a new one
 * from a fresh interview. Replacing deletes the approved plan and its steps
 * (Step/StepSessionMapping cascade), so this is a deliberate, opt-in action.
 */
export function PlanReplaceConfirmModal({
  open,
  onConfirm,
  onCancel,
}: PlanReplaceConfirmModalProps) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent data-testid="plan-replace-confirm" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warn" aria-hidden />
            {t("planning.replace.title")}
          </DialogTitle>
          <DialogDescription>{t("planning.replace.description")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} data-testid="plan-replace-cancel">
            <X className="h-4 w-4" />
            {t("planning.replace.cancel_button")}
          </Button>
          <Button variant="danger" onClick={onConfirm} data-testid="plan-replace-confirm-button">
            <RotateCcw className="h-4 w-4" />
            {t("planning.replace.confirm_button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PlanReplaceConfirmModal;
