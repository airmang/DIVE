import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/button";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "라이트 모드로" : "다크 모드로";
  return (
    <Button variant="outline" size="sm" onClick={toggleTheme} aria-label={label}>
      {theme === "dark" ? <Sun /> : <Moon />}
      {label}
    </Button>
  );
}

interface IssuedChild {
  label: string;
  key: string;
  hash: string;
  limitUsd: number;
}

interface BackendChildKey {
  key: string;
  hash: string;
  label: string;
  limit_usd: number | null;
}

async function issueViaIpc(
  mainKey: string,
  label: string,
  limitUsd: number,
): Promise<BackendChildKey | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    return (await core.invoke<BackendChildKey>("openrouter_issue_key", {
      mainKey,
      label,
      limitUsd,
    })) satisfies BackendChildKey;
  } catch {
    return null;
  }
}

function mockChildKey(label: string, limitUsd: number, seed: number): BackendChildKey {
  const rand = Math.random().toString(36).slice(2, 10);
  return {
    key: `sk-or-demo-${seed}-${rand}`,
    hash: `hash-${seed}-${rand}`,
    label,
    limit_usd: limitUsd,
  };
}

export default function ProvisioningDemoPage() {
  const [mainKey, setMainKey] = useState("sk-main-demo");
  const [classLabel, setClassLabel] = useState("2026-05-04-A반");
  const [perStudentLimit, setPerStudentLimit] = useState(5);
  const [count, setCount] = useState(25);
  const [issued, setIssued] = useState<IssuedChild[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<"ipc" | "mock" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issueBatch = async () => {
    setLoading(true);
    setError(null);
    const next: IssuedChild[] = [];
    let usedSource: "ipc" | "mock" | null = null;
    for (let i = 1; i <= count; i += 1) {
      const label = `${classLabel}-#${String(i).padStart(2, "0")}`;
      try {
        const child =
          (await issueViaIpc(mainKey, label, perStudentLimit)) ??
          mockChildKey(label, perStudentLimit, i);
        if (!usedSource) {
          usedSource = (child.key.startsWith("sk-or-demo-") ? "mock" : "ipc") as "ipc" | "mock";
        }
        next.push({
          label: child.label,
          key: child.key,
          hash: child.hash,
          limitUsd: child.limit_usd ?? perStudentLimit,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        break;
      }
    }
    setIssued(next);
    setSource(usedSource);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-bg-base text-fg">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Provisioning Demo (task 3-5)</h1>
        <div className="flex items-center gap-2">
          <a href="/" className="text-sm text-fg-muted underline">
            ← 홈으로
          </a>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
        <section data-testid="demo-section-intro" className="rounded-md border bg-bg-panel2 p-4">
          <h2 className="text-sm font-semibold">무엇을 확인하는가</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-muted">
            <li>교사용 OpenRouter 메인 키 + 차시 라벨 + 학생 수 입력.</li>
            <li>일괄 발급 → 자식 키 N개 + 각 키 QR 코드 렌더.</li>
            <li>Tauri 런타임에서는 실제 `/api/v1/keys` 호출, 브라우저 데모에서는 mock.</li>
            <li>짧은 URL 호스팅은 Phase 4-5로 연기. 3-5는 QR만.</li>
          </ul>
        </section>

        <section
          data-testid="demo-section-form"
          className="space-y-2 rounded-md border bg-bg-panel2 p-4"
        >
          <div>
            <label htmlFor="prov-main-key" className="block text-xs font-semibold text-fg-muted">
              OpenRouter 메인 키
            </label>
            <input
              id="prov-main-key"
              data-testid="prov-main-key"
              type="password"
              value={mainKey}
              onChange={(e) => setMainKey(e.target.value)}
              className="mt-1 w-full rounded-md border bg-bg-panel px-3 py-2 font-mono text-sm text-fg"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="prov-label" className="block text-xs font-semibold text-fg-muted">
                차시 라벨
              </label>
              <input
                id="prov-label"
                data-testid="prov-label"
                type="text"
                value={classLabel}
                onChange={(e) => setClassLabel(e.target.value)}
                className="mt-1 w-full rounded-md border bg-bg-panel px-3 py-2 text-sm text-fg"
              />
            </div>
            <div>
              <label htmlFor="prov-count" className="block text-xs font-semibold text-fg-muted">
                학생 수
              </label>
              <input
                id="prov-count"
                data-testid="prov-count"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Number(e.target.value) || 1)}
                className="mt-1 w-24 rounded-md border bg-bg-panel px-3 py-2 text-sm text-fg"
              />
            </div>
            <div>
              <label htmlFor="prov-limit" className="block text-xs font-semibold text-fg-muted">
                한도(USD)
              </label>
              <input
                id="prov-limit"
                data-testid="prov-limit"
                type="number"
                min={0.5}
                step={0.5}
                value={perStudentLimit}
                onChange={(e) => setPerStudentLimit(Number(e.target.value) || 1)}
                className="mt-1 w-24 rounded-md border bg-bg-panel px-3 py-2 text-sm text-fg"
              />
            </div>
          </div>
          <Button
            variant="primary"
            data-testid="prov-issue"
            disabled={loading || mainKey.trim().length === 0 || classLabel.trim().length === 0}
            onClick={() => {
              void issueBatch();
            }}
          >
            {loading ? "발급 중..." : `${count}개 일괄 발급`}
          </Button>
          {error ? (
            <p className="text-xs text-danger" data-testid="prov-error">
              {error}
            </p>
          ) : null}
          {source ? (
            <p className="text-[11px] text-fg-muted" data-testid="prov-source">
              source: {source}
            </p>
          ) : null}
        </section>

        {issued.length > 0 ? (
          <section
            data-testid="demo-section-results"
            className="space-y-3 rounded-md border bg-bg-panel2 p-4"
          >
            <h2 className="text-sm font-semibold">발급된 키 ({issued.length}개)</h2>
            <ul className="grid grid-cols-2 gap-3" data-testid="prov-results">
              {issued.slice(0, 6).map((c) => (
                <li
                  key={c.hash}
                  className="flex items-start gap-3 rounded-md border bg-bg-panel p-2"
                  data-testid="prov-result-item"
                  data-label={c.label}
                >
                  <div
                    className="rounded bg-white p-1"
                    data-testid="prov-qr"
                    data-key-hash={c.hash}
                  >
                    <QRCodeSVG value={c.key} size={64} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-fg">{c.label}</p>
                    <p className="truncate font-mono text-[10px] text-fg-muted">{c.key}</p>
                    <p className="text-[10px] text-fg-muted">한도: ${c.limitUsd.toFixed(2)}</p>
                  </div>
                </li>
              ))}
            </ul>
            {issued.length > 6 ? (
              <p className="text-[11px] text-fg-muted">
                (미리보기 6개만 표시 — 실제로는 {issued.length}개 전부 발급됨)
              </p>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
