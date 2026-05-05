import { useMemo } from "react";
import { DiffViewer } from "../permission-card";
import { useSlideInStore } from "../../stores/slideIn";
import { cn } from "../../lib/utils";

export function CodeTab() {
  const files = useSlideInStore((s) => s.changedFiles);
  const changeSummary = useSlideInStore((s) => s.changeSummary);
  const selected = useSlideInStore((s) => s.selectedFilePath);
  const setSelected = useSlideInStore((s) => s.setSelectedFile);

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
        <div data-testid="code-tab-empty">
          <p className="text-sm text-fg-muted">변경된 파일이 없습니다.</p>
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
            const adds = countOp(f.diff.before, f.diff.after, "add");
            const dels = countOp(f.diff.before, f.diff.after, "del");
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
                  <div className="mt-0.5 font-mono text-[10px]">
                    <span className="text-success">+{adds}</span>
                    {"  "}
                    <span className="text-danger">−{dels}</span>
                  </div>
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
        {current ? <DiffViewer diff={current.diff} /> : null}
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
