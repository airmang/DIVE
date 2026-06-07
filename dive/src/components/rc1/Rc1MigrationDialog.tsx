import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import type { Rc1MigrationResult } from "../../lib/rc1-migration";
import { useT } from "../../i18n";

interface Props {
  open: boolean;
  result: Rc1MigrationResult | null;
  onAcknowledge: () => void;
}

export function Rc1MigrationDialog({ open, result, onAcknowledge }: Props) {
  const t = useT();
  const removedCount = result?.removedKeys.length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onAcknowledge();
      }}
    >
      <DialogContent data-testid="rc1-migration-dialog" className="z-[70] max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("rc1_migration.title")}</DialogTitle>
          <DialogDescription>{t("rc1_migration.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-fg">
          <p>{t("rc1_migration.body")}</p>
          <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-xs text-fg-muted">
            <p className="font-medium text-fg">{t("rc1_migration.removed_heading")}</p>
            <p data-testid="rc1-removed-count">
              {t("rc1_migration.removed_count", { count: removedCount })}
            </p>
            {result?.preservedKeys.length ? (
              <p data-testid="rc1-preserved-keys">
                {t("rc1_migration.preserved", { keys: result.preservedKeys.join(", ") })}
              </p>
            ) : null}
          </div>
          <p className="text-xs text-fg-muted">{t("rc1_migration.apology")}</p>
        </div>

        <DialogFooter>
          <Button variant="primary" onClick={onAcknowledge} data-testid="rc1-migration-confirm">
            {t("rc1_migration.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default Rc1MigrationDialog;
