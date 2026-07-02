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
import { classifyProjectCreateError } from "../../lib/error-classify";
import { useT } from "../../i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({ open, onOpenChange }: Props) {
  const t = useT();
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
      const picked = await pickFolder({ title: t("new_project.pick_title") });
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
      setError(t("new_project.path_required"));
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
      // Show a deterministic plain-Korean message, never the raw Rust error (P1-06).
      setError(t(classifyProjectCreateError(err).bodyKey));
    } finally {
      setSubmitting(false);
    }
  };

  const browseSupported = isTauriEnv();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="new-project-dialog" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("new_project.title")}</DialogTitle>
          <DialogDescription>{t("new_project.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="np-path">
              {t("new_project.folder_label")}
            </label>
            <div className="flex gap-2">
              <Input
                id="np-path"
                data-testid="np-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={
                  browseSupported
                    ? t("new_project.browse_placeholder")
                    : t("new_project.manual_placeholder")
                }
                spellCheck={false}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleBrowse()}
                disabled={picking || !browseSupported}
                data-testid="np-browse"
                aria-label={t("new_project.browse_aria")}
              >
                <FolderOpen className="h-4 w-4" />
                <span className="ml-1.5">{t("new_project.browse")}</span>
              </Button>
            </div>
            {!browseSupported ? (
              <p className="text-[11px] text-fg-muted" data-testid="np-browse-unavailable">
                {t("new_project.browse_unavailable")}
              </p>
            ) : null}
            {/* S-045 (P1-07): recommend a new empty folder; work stays local + reversible. */}
            <p className="text-xs text-fg-muted" data-testid="np-folder-hint">
              {t("new_project.folder_hint")}
            </p>
            {isLikelyRootFolder(path) ? (
              <p className="text-[11px] text-warn" data-testid="np-folder-root-note">
                {t("new_project.folder_root_note")}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted" htmlFor="np-name">
              {t("new_project.name_label")}
            </label>
            <Input
              id="np-name"
              data-testid="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={path ? inferName(path) : t("new_project.name_placeholder")}
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
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={submitting || !path.trim()}
            data-testid="np-create"
          >
            {submitting ? t("new_project.creating") : t("new_project.create")}
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

/**
 * Lightweight, non-blocking heuristic: does the path look like the home root or
 * a common personal folder (Desktop/Documents/Downloads) a beginner shouldn't
 * scope DIVE over? Never a hard gate (Constitution V) — only surfaces a hint.
 */
function isLikelyRootFolder(raw: string): boolean {
  const trimmed = raw.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return false;
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1]?.toLowerCase();
  if (last === "desktop" || last === "documents" || last === "downloads") return true;
  const lower = parts.map((segment) => segment.toLowerCase());
  const usersIdx = lower.indexOf("users");
  if (usersIdx >= 0 && parts.length === usersIdx + 2) return true;
  const homeIdx = lower.indexOf("home");
  if (homeIdx >= 0 && parts.length === homeIdx + 2) return true;
  return false;
}

export default NewProjectDialog;
