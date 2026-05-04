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
    title: "1. 빈 워크맵 (D 게이트)",
    body: "채팅 입력이 차단됩니다. 'D seed' 버튼으로 카드 1개를 생성하세요.",
    testId: "step-b-1",
  },
  {
    id: 2,
    title: "2. Decomposed → Instructed",
    body: "카드 클릭 → 지시 입력 → [I 단계로 진입]. state가 Instructed로 전이.",
    testId: "step-b-2",
  },
  {
    id: 3,
    title: "3. Instructed → Verifying",
    body: "카드 다시 클릭 → [V 단계로 진입]. 도구 호출 1회 이상 필요.",
    testId: "step-b-3",
  },
  {
    id: 4,
    title: "4. Verifying → Verified",
    body: "검증 결과 확인 → [최종 승인]. 거부 시 Rejected 상태로 전환.",
    testId: "step-b-4",
  },
  {
    id: 5,
    title: "5. Verified 클릭 → 슬라이드 인",
    body: "Verified 카드는 모달 대신 우측 슬라이드 인 코드 탭으로 라우팅.",
    testId: "step-b-5",
  },
  {
    id: 6,
    title: "6. 모든 카드 완료 → E 단계",
    body: "모든 카드가 Verified/Extended면 E 배너가 표시됩니다.",
    testId: "step-b-6",
  },
];

function dSeedCards(): CardTileData[] {
  return [
    {
      id: 8001,
      title: "로그인 폼 구현",
      summary: null,
      state: "decomposed",
      stagesCompleted: { d: true, i: false, v: false, e: false },
      position: 1,
    },
  ];
}

function iSeedCards(): CardTileData[] {
  return [
    {
      id: 8001,
      title: "로그인 폼 구현",
      summary: "사용자/비밀번호 입력 + 서버 인증 POST + 에러 표시",
      state: "instructed",
      stagesCompleted: { d: true, i: true, v: false, e: false },
      position: 1,
    },
  ];
}

function vSeedCards(): CardTileData[] {
  return [
    {
      id: 8001,
      title: "로그인 폼 구현",
      summary: "사용자/비밀번호 입력 + 서버 인증 POST + 에러 표시",
      state: "verifying",
      stagesCompleted: { d: true, i: true, v: false, e: false },
      position: 1,
    },
  ];
}

function verifiedSeedCards(): CardTileData[] {
  return [
    {
      id: 8001,
      title: "로그인 폼 구현",
      summary: "사용자/비밀번호 입력 + 서버 인증 POST + 에러 표시",
      state: "verified",
      stagesCompleted: { d: true, i: true, v: true, e: false },
      position: 1,
    },
  ];
}

function rejectedSeedCards(): CardTileData[] {
  return [
    {
      id: 8001,
      title: "로그인 폼 구현",
      summary: "사용자/비밀번호 입력 + 서버 인증 POST + 에러 표시",
      state: "rejected",
      stagesCompleted: { d: true, i: true, v: false, e: false },
      position: 1,
    },
  ];
}

function allDoneSeedCards(): CardTileData[] {
  return [
    {
      id: 8001,
      title: "로그인 폼 구현",
      summary: "완료",
      state: "verified",
      stagesCompleted: { d: true, i: true, v: true, e: false },
      position: 1,
    },
    {
      id: 8002,
      title: "회원가입 폼 구현",
      summary: "완료",
      state: "extended",
      stagesCompleted: { d: true, i: true, v: true, e: true },
      position: 2,
    },
  ];
}

export default function ScenarioBDemoPage() {
  const [stepsExpanded, setStepsExpanded] = useState(true);
  const setCards = useWorkmapStore((s) => s.setCardsLocal);
  const clear = useWorkmapStore((s) => s.clearLocal);
  const setCurrentCard = useWorkmapStore((s) => s.setCurrentCardLocal);
  const closeSlideIn = useSlideInStore((s) => s.close);

  const seeds = useMemo(
    () => ({
      d: dSeedCards(),
      i: iSeedCards(),
      v: vSeedCards(),
      verified: verifiedSeedCards(),
      rejected: rejectedSeedCards(),
      all: allDoneSeedCards(),
    }),
    [],
  );

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-bg text-fg">
      <header className="flex shrink-0 items-center justify-between border-b bg-bg-panel px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-accent" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold leading-tight">시나리오 B · 상태 머신 데모</h1>
            <p className="text-xs text-fg-muted">
              DIVE_SPEC.md §3.2 · 카드 상태 전이 + I/V/E 게이트 (작업 3-1)
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setStepsExpanded((v) => !v)}
            data-testid="toggle-steps-b"
          >
            {stepsExpanded ? "설명 접기" : "설명 펼치기"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              clear();
              setCurrentCard(null);
              closeSlideIn();
            }}
            data-testid="scenario-b-reset"
          >
            초기화
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCards(seeds.d)}
            data-testid="scenario-b-seed-d"
          >
            D seed
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCards(seeds.i)}
            data-testid="scenario-b-seed-i"
          >
            I seed
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCards(seeds.v)}
            data-testid="scenario-b-seed-v"
          >
            V seed
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCards(seeds.verified)}
            data-testid="scenario-b-seed-verified"
          >
            Verified seed
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCards(seeds.rejected)}
            data-testid="scenario-b-seed-rejected"
          >
            Rejected seed
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setCards(seeds.all)}
            data-testid="scenario-b-seed-all"
          >
            E seed (all done)
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {stepsExpanded ? (
        <aside className="shrink-0 border-b bg-bg-panel2 px-6 py-3" data-testid="steps-panel-b">
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

      <div className="min-h-0 flex-1" data-testid="scenario-b-shell">
        <MainShell />
      </div>
    </div>
  );
}
