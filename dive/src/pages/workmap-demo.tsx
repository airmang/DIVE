import { useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { Button } from "../components/ui/button";
import { WorkmapStrip } from "../components/shell/WorkmapStrip";
import { CardTile } from "../components/workmap/CardTile";
import { WorkmapCardList } from "../components/workmap/WorkmapCardList";
import type { CardState, CardTileData } from "../components/workmap/types";

function makeCard(
  id: number,
  title: string,
  state: CardState,
  stages: { d?: boolean; i?: boolean; v?: boolean; e?: boolean } = {},
  summary: string | null = null,
): CardTileData {
  return {
    id,
    title,
    summary,
    state,
    stagesCompleted: {
      d: stages.d ?? false,
      i: stages.i ?? false,
      v: stages.v ?? false,
      e: stages.e ?? false,
    },
    position: id,
  };
}

const FOUR_STATUS_CARDS: CardTileData[] = [
  makeCard(1, "로그인 폼 만들기", "decomposed", { d: true }),
  makeCard(
    2,
    "localStorage 저장 로직",
    "instructed",
    { d: true, i: true },
    "AI가 localStorage 저장 코드 작성 중",
  ),
  makeCard(
    3,
    "할 일 필터링 기능",
    "verifying",
    { d: true, i: true, v: true },
    "AI 자체검증 완료, 사용자 최종 승인 대기",
  ),
  makeCard(
    4,
    "다크 모드 토글",
    "verified",
    { d: true, i: true, v: true, e: true },
    "검증 통과 — 코드 보기로 결과 확인 가능",
  ),
];

const ALL_SIX_STATES: CardTileData[] = [
  makeCard(10, "할 일 추가 폼", "decomposed", { d: true }),
  makeCard(11, "추가 버튼 상호작용", "instructed", { d: true, i: true }),
  makeCard(12, "입력 유효성 검사", "verifying", { d: true, i: true, v: true }),
  makeCard(13, "로컬 저장 연결", "verified", { d: true, i: true, v: true, e: true }),
  makeCard(14, "빈 입력 경고 메시지", "rejected", { d: true, i: true }),
  makeCard(15, "통합 저장 레이어", "extended", { d: true, i: true, v: true, e: true }),
];

const MANY_CARDS: CardTileData[] = Array.from({ length: 12 }, (_, i) =>
  makeCard(
    100 + i,
    `작업 카드 #${i + 1} — 긴 제목도 말줄임 처리 예시`,
    (["decomposed", "instructed", "verifying", "verified", "rejected", "extended"] as CardState[])[
      i % 6
    ],
    {
      d: i % 6 >= 0,
      i: i % 6 >= 1,
      v: i % 6 >= 2,
      e: i % 6 >= 3,
    },
  ),
);

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

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <section className="space-y-3" data-testid={testId}>
      <h2 className="text-xl font-semibold text-fg">{title}</h2>
      <div className="rounded-lg border bg-bg-panel p-4">{children}</div>
    </section>
  );
}

export default function WorkmapDemoPage() {
  const [clickLog, setClickLog] = useState<string[]>([]);
  const [addLog, setAddLog] = useState<number>(0);
  const [stripCollapsed, setStripCollapsed] = useState(false);
  const [stripCanAdd, setStripCanAdd] = useState(true);

  const cards = useMemo(() => FOUR_STATUS_CARDS, []);

  const handleCardClick = (card: CardTileData) => {
    const line = `card ${card.id} clicked — state=${card.state}`;
    setClickLog((prev) => [line, ...prev].slice(0, 5));
  };

  const handleAdd = () => {
    setAddLog((n) => n + 1);
  };

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-center justify-between border-b bg-bg-panel px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-accent" aria-hidden />
          <div>
            <h1 className="text-2xl font-semibold leading-tight">워크맵 카드 타일 데모</h1>
            <p className="text-xs text-fg-muted">
              DIVE_SPEC.md §5.2 · 드라이 데모 (데이터 없음, mock)
            </p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-8 px-6 py-8">
        <Section title="1. 펼침 모드 · 4가지 대표 상태" testId="demo-section-expanded">
          <div className="flex items-center gap-3 overflow-x-auto">
            {FOUR_STATUS_CARDS.map((card) => (
              <CardTile key={card.id} card={card} mode="expanded" onClick={handleCardClick} />
            ))}
          </div>
        </Section>

        <Section title="2. 접힘 모드 · 4가지 대표 상태" testId="demo-section-collapsed">
          <div className="flex items-center gap-3 overflow-x-auto">
            {FOUR_STATUS_CARDS.map((card) => (
              <CardTile key={card.id} card={card} mode="collapsed" onClick={handleCardClick} />
            ))}
          </div>
        </Section>

        <Section title="3. 6가지 CardState 전부 (펼침)" testId="demo-section-all-states">
          <div className="flex items-center gap-3 overflow-x-auto">
            {ALL_SIX_STATES.map((card) => (
              <CardTile key={card.id} card={card} mode="expanded" onClick={handleCardClick} />
            ))}
          </div>
        </Section>

        <Section title="4. WorkmapCardList — 가로 스크롤 + 추가 버튼" testId="demo-section-list">
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-xs text-fg-muted">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={stripCanAdd}
                  onChange={(e) => setStripCanAdd(e.target.checked)}
                  data-testid="demo-toggle-can-add"
                />
                canAddCard (D 단계에서만 true)
              </label>
              <span>onAdd 호출 수: {addLog}</span>
            </div>
            <div className="h-[150px] rounded-md border bg-bg-panel2 p-2">
              <WorkmapCardList
                cards={MANY_CARDS}
                mode="expanded"
                canAddCard={stripCanAdd}
                onAddCard={handleAdd}
                onCardClick={handleCardClick}
              />
            </div>
            <div className="h-[56px] rounded-md border bg-bg-panel2 p-2">
              <WorkmapCardList
                cards={MANY_CARDS}
                mode="collapsed"
                canAddCard={stripCanAdd}
                onAddCard={handleAdd}
                onCardClick={handleCardClick}
              />
            </div>
          </div>
        </Section>

        <Section title="5. WorkmapStrip 통합 — 실제 레이아웃 위에서" testId="demo-section-strip">
          <div className="space-y-2 text-xs text-fg-muted">
            <p>아래는 WorkmapStrip(220/80px)을 mock 카드와 함께 렌더한 모습.</p>
            <div className="flex items-center gap-3">
              <Button size="sm" variant="ghost" onClick={() => setStripCollapsed((c) => !c)}>
                {stripCollapsed ? "펼치기" : "접기"} (또는 우측 토글)
              </Button>
              <span>현재: {stripCollapsed ? "collapsed" : "expanded"}</span>
            </div>
          </div>
          <div className="mt-3 overflow-hidden rounded-md border">
            <WorkmapStrip
              collapsed={stripCollapsed}
              onToggle={() => setStripCollapsed((c) => !c)}
              cards={cards}
              canAddCard={stripCanAdd}
              onAddCard={handleAdd}
              onCardClick={handleCardClick}
            />
          </div>
        </Section>

        <Section title="클릭 로그 (최근 5건)" testId="demo-section-log">
          {clickLog.length === 0 ? (
            <p className="text-xs text-fg-muted">카드를 클릭하면 여기에 기록됩니다.</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs text-fg-muted" data-testid="demo-click-log">
              {clickLog.map((line, idx) => (
                <li key={`${idx}-${line}`}>{line}</li>
              ))}
            </ul>
          )}
        </Section>

        <footer className="pt-6 text-xs text-fg-subtle">
          워크맵 카드 타일 — 작업 2-1. 실제 데이터/라우팅은 2-6, 상태 전환은 3-1.
        </footer>
      </main>
    </div>
  );
}
