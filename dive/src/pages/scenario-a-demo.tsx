import { useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/button";
import { MainShell } from "../components/shell";
import { useWorkmapStore } from "../stores/workmap";
import { useSlideInStore } from "../stores/slideIn";
import type { CardTileData } from "../components/workmap/types";

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

const STEPS = [
  {
    id: 1,
    title: "1. 빈 워크맵 + 입력 차단",
    body: "초기 상태. 채팅 입력란은 D 게이트로 차단되어 있고, 상단 배너가 안내합니다.",
    testId: "step-1",
  },
  {
    id: 2,
    title: "2. AI 도움 받기 버튼",
    body: "빈 워크맵 본문에 'AI 도움 받기' 버튼이 있습니다. 클릭하면 다이얼로그가 열립니다.",
    testId: "step-2",
  },
  {
    id: 3,
    title: "3. 요구 입력 + 제안 받기",
    body: "원하는 기능을 한 문장으로 적고 '제안 받기'. 350ms 후 카드 초안 4개가 나타납니다.",
    testId: "step-3",
  },
  {
    id: 4,
    title: "4. 개별 또는 일괄 수락",
    body: "기본값은 모두 선택됨. 체크박스로 개별 선택하거나 '모두 수락'으로 일괄 추가.",
    testId: "step-4",
  },
  {
    id: 5,
    title: "5. 카드 추가 → D 게이트 해제",
    body: "카드가 들어오면 입력 차단 배너가 사라지고, 채팅이 활성화됩니다.",
    testId: "step-5",
  },
  {
    id: 6,
    title: "6. 완료 카드 클릭 → 슬라이드 인 코드 보기",
    body: "verified/extended 상태의 카드를 클릭하면 우측 슬라이드 인 패널이 코드 탭으로 열립니다.",
    testId: "step-6",
  },
];

function demoCards(): CardTileData[] {
  return [
    {
      id: 9001,
      title: "할 일 입력 폼",
      summary: "입력 + 제출",
      state: "decomposed",
      stagesCompleted: { d: true, i: false, v: false, e: false },
      position: 1,
    },
    {
      id: 9002,
      title: "할 일 목록 렌더",
      summary: "배열 렌더 + 빈 상태",
      state: "instructed",
      stagesCompleted: { d: true, i: true, v: false, e: false },
      position: 2,
    },
    {
      id: 9003,
      title: "체크/삭제 인터랙션",
      summary: "완료 토글 + 삭제",
      state: "verified",
      stagesCompleted: { d: true, i: true, v: true, e: true },
      position: 3,
    },
  ];
}

export default function ScenarioADemoPage() {
  const [stepsExpanded, setStepsExpanded] = useState(true);
  const setCards = useWorkmapStore((s) => s.setCardsLocal);
  const clear = useWorkmapStore((s) => s.clearLocal);
  const closeSlideIn = useSlideInStore((s) => s.close);

  const scenarioSeed = useMemo(() => demoCards(), []);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-bg text-fg">
      <header className="flex shrink-0 items-center justify-between border-b bg-bg-panel px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-accent" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold leading-tight">시나리오 A · 통합 데모</h1>
            <p className="text-xs text-fg-muted">
              DIVE_SPEC.md §3.1 · D 게이트 + AI 도움 + 슬라이드 인 연결 (작업 2-6)
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStepsExpanded((v) => !v)}
            data-testid="toggle-steps"
          >
            {stepsExpanded ? "설명 접기" : "설명 펼치기"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              clear();
              closeSlideIn();
            }}
            data-testid="scenario-reset"
          >
            초기화
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setCards(scenarioSeed)}
            data-testid="scenario-seed"
          >
            시나리오 seed
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {stepsExpanded ? (
        <aside className="shrink-0 border-b bg-bg-panel2 px-6 py-3" data-testid="steps-panel">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.id} className="rounded-md border bg-bg-panel p-2" data-testid={s.testId}>
                <p className="text-xs font-semibold text-fg">{s.title}</p>
                <p className="mt-0.5 text-[11px] text-fg-muted">{s.body}</p>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}

      <div className="min-h-0 flex-1" data-testid="scenario-shell">
        <MainShell />
      </div>
    </div>
  );
}
