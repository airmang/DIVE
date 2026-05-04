import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";

interface Feature {
  id: string;
  target: { kind: "demo" | "route"; value: string };
  title: string;
  task: string;
  checklist: string[];
}

const FEATURES: Feature[] = [
  {
    id: "codex",
    target: { kind: "route", value: "settings" },
    title: "Codex OAuth (PKCE)",
    task: "5-1",
    checklist: [
      "Settings에 [ChatGPT 연결] 버튼",
      "CodexOAuthDialog 4-phase (idle/waiting/done/error)",
      "code + state 붙여넣기 fallback",
      "토큰 → Keyring 저장",
    ],
  },
  {
    id: "mcp-setup",
    target: { kind: "route", value: "settings" },
    title: "MCP 서버 등록",
    task: "5-2",
    checklist: [
      "McpServer 테이블 마이그레이션 v3",
      "stdio + http transport",
      "[+ 새 MCP 서버] 폼",
      "연결 테스트 버튼",
    ],
  },
  {
    id: "mcp-tools",
    target: { kind: "demo", value: "mcp" },
    title: "MCP 도구 권한 카드",
    task: "5-3",
    checklist: [
      "mcp__{server}__{tool} 네임스페이스",
      "MAX(default_risk, risk_hint) 병합",
      "출처 배지 (3종 카드 + 메시지)",
      "Agent Loop 통합 (Tool trait)",
    ],
  },
  {
    id: "prompt-helper",
    target: { kind: "route", value: "prompt-helper" },
    title: "프롬프트 도우미",
    task: "5-4",
    checklist: [
      "단계별 템플릿 라이브러리 (D/I/V/E)",
      "실시간 정규식 모호함 감지 (500ms)",
      "underlay 하이라이트 + 힌트 리스트",
      "외부 호출 0",
    ],
  },
  {
    id: "prompt-check",
    target: { kind: "route", value: "prompt-helper" },
    title: "보내기 전 점검",
    task: "5-5",
    checklist: [
      "PromptCheckDialog (4-phase)",
      "single-tool prompt_review",
      "Ctrl+Shift+Enter 단축키",
      "토큰 수 표시",
    ],
  },
];

export default function Phase5IntegrationPage() {
  const [rustSummary, setRustSummary] = useState<{ passed: number; failed: number } | null>(null);

  useEffect(() => {
    setRustSummary({ passed: 238, failed: 0 });
  }, []);

  const navigate = (target: Feature["target"]) => {
    const url = new URL(window.location.href);
    if (target.kind === "route") {
      url.searchParams.delete("demo");
      url.searchParams.set("route", target.value);
    } else {
      url.searchParams.delete("route");
      url.searchParams.set("demo", target.value);
    }
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <div
      className="min-h-screen w-screen overflow-y-auto bg-bg px-8 py-6 text-fg"
      data-testid="phase5-integration-page"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Phase 5 v0.3 통합 점검</h1>
            <Badge variant="accent">5-6</Badge>
          </div>
          <p className="text-xs text-fg-muted">
            Phase 5의 5개 산출물(Codex OAuth / MCP 클라이언트 / MCP 권한 카드 / 프롬프트 도우미 /
            보내기 전 점검)을 데모 단위로 모아 놓은 랜딩 페이지. Product 화면은 ?route로,
            순수 데모 화면은 ?demo로 이동합니다.
          </p>
        </header>

        {rustSummary ? (
          <div
            className="flex items-center gap-3 rounded-md border bg-bg-panel px-3 py-2 text-xs"
            data-testid="phase5-rust-summary"
          >
            <span className="font-semibold">Rust 테스트:</span>
            <Badge variant="success">{rustSummary.passed} passed</Badge>
            <Badge variant={rustSummary.failed === 0 ? "default" : "danger"}>
              {rustSummary.failed} failed
            </Badge>
            <span className="text-fg-muted">
              (최신 `cargo test --all-targets` 기준. CI에서 자동 갱신 예정 — Phase 6).
            </span>
          </div>
        ) : null}

        <section
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          data-testid="phase5-feature-grid"
        >
          {FEATURES.map((f) => (
            <Card
              key={f.id}
              className="flex flex-col gap-2 p-4"
              data-testid="phase5-feature-card"
              data-feature-id={f.id}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold">{f.title}</span>
                    <Badge variant="accent">{f.task}</Badge>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(f.target)}
                  data-testid="phase5-open-demo"
                  data-feature-id={f.id}
                >
                  열기
                </Button>
              </div>
              <ul className="flex flex-col gap-0.5 text-[11px] text-fg-muted">
                {f.checklist.map((item, i) => (
                  <li key={i} className="flex gap-1">
                    <span aria-hidden>✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </section>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("demo");
            window.history.pushState({}, "", url.toString());
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
          className="w-fit"
          data-testid="phase5-back"
        >
          메인 셸로 돌아가기
        </Button>
      </div>
    </div>
  );
}
