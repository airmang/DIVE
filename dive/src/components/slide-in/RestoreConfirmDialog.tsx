import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  checkpointLabel?: string | null;
  onConfirm: () => void;
}

export function RestoreConfirmDialog({ open, onOpenChange, checkpointLabel, onConfirm }: Props) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="restore-confirm-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>체크포인트로 복원</DialogTitle>
          <DialogDescription>
            현재 상태가 <span className="font-semibold">&ldquo;복원 직전&rdquo;</span> 체크포인트로
            자동 저장됩니다. 언제든 되돌릴 수 있습니다.
          </DialogDescription>
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
            aria-label="현재 상태 자동 백업 후 복원"
            className="mt-0.5"
          />
          <span>
            현재 상태 자동 백업 후 복원
            <span className="block text-fg-subtle">
              복원 전 `auto-pre-restore` 체크포인트가 생성됩니다.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} data-testid="restore-cancel">
            취소
          </Button>
          <Button onClick={handleConfirm} data-testid="restore-confirm">
            복원하기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RestoreConfirmDialog;
