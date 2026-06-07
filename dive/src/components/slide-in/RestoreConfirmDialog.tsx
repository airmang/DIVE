import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { useT } from "../../i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkpointLabel?: string | null;
  onConfirm: () => void;
}

export function RestoreConfirmDialog({ open, onOpenChange, checkpointLabel, onConfirm }: Props) {
  const t = useT();
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="restore-confirm-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("restore_confirm.title")}</DialogTitle>
          <DialogDescription>{t("restore_confirm.description")}</DialogDescription>
        </DialogHeader>
        {checkpointLabel ? (
          <div
            className="rounded-md border bg-bg-panel2 p-3 text-sm text-fg"
            data-testid="restore-target-label"
          >
            {checkpointLabel}
          </div>
        ) : null}
        <label className="flex items-start gap-2 rounded-md border bg-bg-panel2 p-3 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked
            disabled
            readOnly
            aria-label={t("restore_confirm.backup_aria")}
            className="mt-0.5"
          />
          <span>
            {t("restore_confirm.backup_label")}
            <span className="block text-fg-subtle">{t("restore_confirm.backup_sub")}</span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="restore-cancel">
            {t("common.cancel")}
          </Button>
          <Button onClick={handleConfirm} data-testid="restore-confirm">
            {t("restore_confirm.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RestoreConfirmDialog;
