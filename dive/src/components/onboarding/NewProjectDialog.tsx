import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useProjectSessionStore } from "../../stores/project-session";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({ open, onOpenChange }: Props) {
  const createProject = useProjectSessionStore((s) => s.createProject);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      setError("프로젝트 경로를 입력하세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const row = await createProject(name.trim() || inferName(trimmedPath), trimmedPath);
      if (row) {
        onOpenChange(false);
        setName("");
        setPath("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-project-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 프로젝트</DialogTitle>
          <DialogDescription>
            프로젝트 이름과 폴더 경로를 입력하세요. `.dive/` 디렉터리가 자동 생성됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="np-name">
              이름 (선택)
            </label>
            <Input
              id="np-name"
              data-testid="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 로그인 페이지 만들기"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="np-path">
              폴더 경로
            </label>
            <Input
              id="np-path"
              data-testid="np-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/you/Projects/my-app"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {error ? (
            <p className="text-xs text-danger" role="alert" data-testid="np-error">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            data-testid="np-cancel"
          >
            취소
          </Button>
          <Button onClick={handleCreate} disabled={submitting} data-testid="np-create">
            {submitting ? "생성 중…" : "프로젝트 생성"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function inferName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "project";
}

export default NewProjectDialog;
