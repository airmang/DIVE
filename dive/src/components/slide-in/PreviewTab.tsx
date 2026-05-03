import { useState } from "react";
import { useSlideInStore } from "../../stores/slideIn";
import { Button } from "../ui/button";

function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function PreviewTab() {
  const previewUrl = useSlideInStore((s) => s.previewUrl);
  const setPreviewUrl = useSlideInStore((s) => s.setPreviewUrl);
  const [input, setInput] = useState(previewUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  const loadUrl = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError("URL을 입력하세요.");
      return;
    }
    if (!isSafeUrl(trimmed)) {
      setError("http / https URL만 허용됩니다.");
      return;
    }
    setError(null);
    setPreviewUrl(trimmed);
  };

  return (
    <div className="flex h-full flex-col" data-testid="preview-tab">
      <header className="flex items-center gap-2 border-b bg-bg-panel2 p-2">
        <input
          type="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="http://localhost:5173"
          aria-label="미리보기 URL"
          data-testid="preview-url-input"
          className="flex-1 rounded-md border bg-bg px-3 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          onKeyDown={(e) => {
            if (e.key === "Enter") loadUrl();
          }}
        />
        <Button size="sm" variant="outline" onClick={loadUrl} data-testid="preview-load">
          열기
        </Button>
      </header>
      {error ? (
        <p
          className="border-b border-danger/40 bg-danger/10 px-3 py-1 text-xs text-danger"
          data-testid="preview-error"
        >
          {error}
        </p>
      ) : null}
      <div className="flex-1 overflow-hidden bg-bg-panel2">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title="미리보기"
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full border-0 bg-bg"
            data-testid="preview-iframe"
          />
        ) : (
          <div
            className="flex h-full items-center justify-center p-6 text-center"
            data-testid="preview-empty"
          >
            <p className="text-sm text-fg-muted">
              웹 프로젝트만 지원합니다. URL을 입력해 열어보세요.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
