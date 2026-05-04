import { useState } from "react";
import { FolderOpen } from "lucide-react";
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
import { isTauriEnv, pickFolder } from "../../lib/tauri-dialog";

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
  const [picking, setPicking] = useState(false);

  const handleBrowse = async () => {
    setPicking(true);
    setError(null);
    try {
      const picked = await pickFolder({ title: "프로젝트 폴더 선택" });
      if (picked) {
        setPath(picked);
        if (!name.trim()) {
          setName(inferName(picked));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  };

  const handleCreate = async () => {
    const trimmedPath = path.trim();
    if (!trimmedPath) {
      setError("프로젝트 폴더를 선택하세요.");
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

  const browseSupported = isTauriEnv();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-project-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>새 프로젝트</DialogTitle>
          <DialogDescription>
            작업할 폴더를 선택하세요. 선택한 폴더에 `.dive/`가 자동 생성됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="np-path">
              프로젝트 폴더
            </label>
            <div className="flex gap-2">
              <Input
                id="np-path"
                data-testid="np-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={browseSupported ? "찾아보기를 눌러 선택" : "/Users/you/Projects/my-app"}
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleBrowse()}
                disabled={picking || !browseSupported}
                data-testid="np-browse"
                aria-label="폴더 찾아보기"
              >
                <FolderOpen className="h-4 w-4" />
                <span className="ml-1.5">찾아보기</span>
              </Button>
            </div>
            {!browseSupported ? (
              <p className="text-[10px] text-fg-muted" data-testid="np-browse-unavailable">
                데스크톱 앱에서 폴더 선택창을 사용할 수 있습니다.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="np-name">
              이름 (선택)
            </label>
            <Input
              id="np-name"
              data-testid="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={path ? inferName(path) : "프로젝트 이름"}
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
          <Button
            onClick={() => void handleCreate()}
            disabled={submitting || !path.trim()}
            data-testid="np-create"
          >
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
