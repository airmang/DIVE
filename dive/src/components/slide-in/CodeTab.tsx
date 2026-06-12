import { useMemo } from "react";
import { AlertCircle, FileCode, Terminal } from "lucide-react";
import { DiffViewer } from "../permission-card";
import { useSlideInStore } from "../../stores/slideIn";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import { Button } from "../ui/button";

export function CodeTab() {
  const t = useT();
  const files = useSlideInStore((s) => s.changedFiles);
  const changeSummary = useSlideInStore((s) => s.changeSummary);
  const emptyReason = useSlideInStore((s) => s.emptyReason);
  const selected = useSlideInStore((s) => s.selectedFilePath);
  const setSelected = useSlideInStore((s) => s.setSelectedFile);
  const setActiveTab = useSlideInStore((s) => s.setActiveTab);

  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => a.path.localeCompare(b.path)),
    [files],
  );

  const current = useMemo(
    () => sortedFiles.find((f) => f.path === selected) ?? sortedFiles[0] ?? null,
    [sortedFiles, selected],
  );

  if (sortedFiles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        {changeSummary ? (
          <p
            className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg"
            data-testid="change-summary"
          >
            {changeSummary}
          </p>
        ) : null}
        <div
          className="max-w-sm rounded-md border bg-bg-panel2 px-4 py-3"
          data-testid="code-tab-empty"
          data-empty-reason={emptyReason ?? "no_output"}
        >
          <div className="flex items-start gap-2 text-left">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-fg">
                {t(`slide_in.code_empty.${emptyReason ?? "no_output"}.title`)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                {t(`slide_in.code_empty.${emptyReason ?? "no_output"}.description`)}
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => setActiveTab("terminal")}
                data-testid="code-tab-empty-action"
              >
                <Terminal />
                {t("slide_in.code_empty.open_terminal")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full" data-testid="code-tab">
      <aside
        className="w-[150px] shrink-0 overflow-y-auto border-r bg-bg-panel2"
        data-testid="changed-files-list"
      >
        <ul>
          {sortedFiles.map((f) => {
            const adds = f.diff ? countOp(f.diff.before, f.diff.after, "add") : null;
            const dels = f.diff ? countOp(f.diff.before, f.diff.after, "del") : null;
            const active = current?.path === f.path;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelected(f.path)}
                  data-testid="changed-file-item"
                  data-file-path={f.path}
                  data-active={active ? "true" : "false"}
                  className={cn(
                    "w-full border-b px-2 py-2 text-left text-xs transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-accent-subtle text-fg" : "text-fg-muted hover:bg-bg-panel",
                  )}
                >
                  <div className="truncate font-mono">{f.path}</div>
                  {adds !== null && dels !== null ? (
                    <div className="mt-0.5 font-mono text-[10px]">
                      <span className="text-success">+{adds}</span>
                      {"  "}
                      <span className="text-danger">−{dels}</span>
                    </div>
                  ) : (
                    <div className="mt-0.5 text-[10px] text-fg-subtle">diff 미수집</div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <div className="min-w-0 flex-1 overflow-auto p-3">
        {changeSummary ? (
          <p
            className="mb-3 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-fg"
            data-testid="change-summary"
          >
            {changeSummary}
          </p>
        ) : null}
        {current?.diff ? <DiffViewer diff={current.diff} /> : null}
        {current && !current.diff ? <DiffUnavailable path={current.path} /> : null}
      </div>
    </div>
  );
}

function DiffUnavailable({ path }: { path: string }) {
  return (
    <div
      className="rounded-md border bg-bg-panel2 px-4 py-3 text-sm"
      data-testid="diff-unavailable"
      data-file-path={path}
    >
      <div className="flex items-start gap-2">
        <FileCode className="mt-0.5 h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
        <div>
          <p className="font-semibold text-fg">변경 파일로 기록됨</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            이 항목은 체크포인트나 이전 버전 데이터에서 경로만 저장되어 줄 단위 diff가 없습니다.
            더 이상 +0/−0으로 표시하지 않습니다.
          </p>
        </div>
      </div>
    </div>
  );
}

function countOp(before: string, after: string, op: "add" | "del"): number {
  const a = before === "" ? [] : before.split(/\r?\n/);
  const b = after === "" ? [] : after.split(/\r?\n/);
  const setA = new Set(a);
  const setB = new Set(b);
  if (op === "add") {
    return b.filter((l) => !setA.has(l)).length;
  }
  return a.filter((l) => !setB.has(l)).length;
}
