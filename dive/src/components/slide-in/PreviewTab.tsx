import { useState } from "react";
import { useSlideInStore } from "../../stores/slideIn";
import { Button } from "../ui/button";

const PREVIEW_CANDIDATES = ["http://127.0.0.1:5173", "http://localhost:5173"];

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

  const loadCandidate = (url: string) => {
    setInput(url);
    setError(null);
    setPreviewUrl(url);
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
            <div className="max-w-sm">
              <p className="text-sm font-semibold text-fg">결과를 볼 로컬 주소를 선택하세요.</p>
              <p className="mt-2 text-sm text-fg-muted">
                웹 프로젝트 서버가 실행 중이면 아래 기본 주소로 바로 확인할 수 있습니다.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {PREVIEW_CANDIDATES.map((url) => (
                  <Button
                    key={url}
                    size="sm"
                    variant="outline"
                    onClick={() => loadCandidate(url)}
                    data-testid="preview-candidate"
                  >
                    {url}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
