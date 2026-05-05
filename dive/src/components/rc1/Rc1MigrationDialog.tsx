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

interface Props {
  open: boolean;
  result: Rc1MigrationResult | null;
  onAcknowledge: () => void;
}

export function Rc1MigrationDialog({ open, result, onAcknowledge }: Props) {
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
          <DialogTitle>DIVE v1.0.0-rc.1은 데모 빌드였습니다</DialogTitle>
          <DialogDescription>
            실제 데이터 저장 기능 없이 화면만 구동되는 상태였기에, 이전 세션·프로젝트·단계 데이터는
            복구할 수 없습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-fg">
          <p>
            v1.0.0-rc.2부터는 SQLite에 실제로 저장됩니다. API 키를 다시 입력하고 프로젝트를 새로
            만들어 주세요.
          </p>
          <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-xs text-fg-muted">
            <p className="font-medium text-fg">이번 실행에서 정리한 rc.1 demo key</p>
            <p data-testid="rc1-removed-count">{removedCount}개 삭제됨</p>
            {result?.preservedKeys.length ? (
              <p data-testid="rc1-preserved-keys">보존: {result.preservedKeys.join(", ")}</p>
            ) : null}
          </div>
          <p className="text-xs text-fg-muted">불편을 끼쳐 죄송합니다. — DIVE 팀</p>
        </div>

        <DialogFooter>
          <Button variant="primary" onClick={onAcknowledge} data-testid="rc1-migration-confirm">
            확인하고 새로 시작
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default Rc1MigrationDialog;
