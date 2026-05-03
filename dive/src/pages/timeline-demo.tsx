import { useState } from "react";
import { CheckpointTimeline, type TimelineItem } from "../components/slide-in/CheckpointTimeline";
import { Button } from "../components/ui/button";

const SEED: TimelineItem[] = [
  {
    id: 1,
    session_id: 1,
    card_id: null,
    git_sha: "abc1234",
    kind: "init",
    label: "초기 저장",
    created_at: Date.now() - 60_000 * 30,
  },
  {
    id: 2,
    session_id: 1,
    card_id: 1,
    git_sha: "def5678",
    kind: "auto",
    label: "[V 통과] 로그인 폼",
    created_at: Date.now() - 60_000 * 20,
  },
  {
    id: 3,
    session_id: 1,
    card_id: 1,
    git_sha: "ghi9abc",
    kind: "manual",
    label: "수동 저장",
    created_at: Date.now() - 60_000 * 10,
  },
];

export function TimelineDemoPage() {
  const [items, setItems] = useState<TimelineItem[]>(SEED);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const handleRestore = (id: number) => {
    setCurrentId(id);
    setLog((l) => [`restore #${id}`, ...l].slice(0, 6));
  };

  return (
    <div className="min-h-screen bg-bg p-8 text-fg" data-testid="timeline-demo-shell">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold">CheckpointTimeline 데모</h1>
          <p className="text-sm text-fg-muted">
            3개 체크포인트 (init / auto / manual) — 호버 시 툴팁, 클릭으로 복원.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              setItems((s) => [
                ...s,
                {
                  id: s.length + 1,
                  session_id: 1,
                  card_id: null,
                  git_sha: `new${s.length}`,
                  kind: "auto",
                  label: `auto #${s.length + 1}`,
                  created_at: Date.now(),
                },
              ])
            }
            data-testid="timeline-add"
          >
            체크포인트 추가
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setItems([]);
              setCurrentId(null);
            }}
            data-testid="timeline-clear"
          >
            전부 제거
          </Button>
        </div>

        <div className="rounded-md border bg-bg-panel">
          <div className="p-3 text-xs font-medium text-fg-muted">슬라이드 인 하단 영역</div>
          <CheckpointTimeline
            sessionId={1}
            currentCheckpointId={currentId}
            onRestore={handleRestore}
            mockItems={items}
          />
        </div>

        <div>
          <div className="text-xs font-semibold text-fg-muted">로그</div>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
            {log.map((l, i) => (
              <li key={i} data-testid="timeline-log">
                {l}
              </li>
            ))}
            {log.length === 0 ? <li className="text-fg-subtle">아직 없음</li> : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default TimelineDemoPage;
