import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { LearningHint } from "../ui/learning-hint";
import type { CardState, CardTileData } from "./types";

interface Draft {
  id: number;
  title: string;
  summary: string;
  rationale?: string | null;
  priority?: "must" | "should" | "nice" | string | null;
  estimated_steps?: number | null;
}

function mockSuggestionsFor(_input: string): Draft[] {
  return [
    {
      id: 1,
      title: "할 일 입력 폼",
      summary: "입력란과 추가 버튼 + 키보드 Enter 제출",
      rationale: "사용자가 새 항목을 만들 수 있어야 목록 기능을 시작할 수 있습니다.",
      priority: "must",
      estimated_steps: 2,
    },
    {
      id: 2,
      title: "할 일 목록 렌더",
      summary: "배열 상태 + 빈 상태 UI",
      rationale: "입력된 항목을 화면에 보여줘야 앱의 핵심 결과를 확인할 수 있습니다.",
      priority: "must",
      estimated_steps: 2,
    },
    {
      id: 3,
      title: "체크/삭제 인터랙션",
      summary: "각 항목에 완료 토글 + 삭제 버튼",
      rationale: "목록 항목을 관리하는 기본 상호작용을 완성합니다.",
      priority: "should",
      estimated_steps: 3,
    },
    {
      id: 4,
      title: "localStorage 영속화",
      summary: "페이지 새로고침 후에도 유지",
      rationale: "새로고침 후에도 결과가 남아야 완성도를 체감할 수 있습니다.",
      priority: "nice",
      estimated_steps: 2,
    },
  ];
}

interface BackendCard {
  title: string;
  summary: string;
  rationale?: string | null;
  priority?: string | null;
  estimated_steps?: number | null;
}

async function fetchAssistCardsViaIpc(description: string): Promise<Draft[] | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;

  const core = await import("@tauri-apps/api/core");
  const raw = await core.invoke<BackendCard[]>("ai_assist_cards", { description });
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("AI 단계 제안 결과가 비어 있습니다.");
  }
  return raw.map((c, idx) => ({
    id: idx + 1,
    title: c.title,
    summary: c.summary,
    rationale: c.rationale ?? null,
    priority: c.priority ?? null,
    estimated_steps: c.estimated_steps ?? null,
  }));
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: (cards: CardTileData[]) => void | Promise<void>;
  positionStart?: number;
  allowDemoFallback?: boolean;
}

export function AiAssistDialog({
  open,
  onOpenChange,
  onAccept,
  positionStart = 1,
  allowDemoFallback = false,
}: Props) {
  const [input, setInput] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [source, setSource] = useState<"mock" | "llm" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setInput("");
    setDrafts(null);
    setSelected(new Set());
    setLoading(false);
    setAccepting(false);
    setSource(null);
    setError(null);
  };

  const requestSuggestions = async () => {
    setLoading(true);
    setDrafts(null);
    setError(null);
    try {
      const fromIpc = await fetchAssistCardsViaIpc(input);
      if (fromIpc) {
        setDrafts(fromIpc);
        setSelected(new Set(fromIpc.map((d) => d.id)));
        setSource("llm");
        return;
      }

      if (!allowDemoFallback) {
        setError("AI 단계 제안 IPC를 사용할 수 없습니다. DIVE 데스크톱 앱에서 다시 시도하세요.");
        return;
      }

      await new Promise((r) => setTimeout(r, 350));
      const next = mockSuggestionsFor(input);
      setDrafts(next);
      setSelected(new Set(next.map((d) => d.id)));
      setSource("mock");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 단계 제안에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildCards = (drafts: Draft[]): CardTileData[] =>
    drafts.map((d, idx) => ({
      id: Date.now() + idx,
      title: d.title,
      summary: d.summary,
      assistSummary: d.summary,
      acceptanceCriteria: buildAcceptanceCriteria(d),
      state: "decomposed" satisfies CardState,
      stagesCompleted: { d: true, i: false, v: false, e: false },
      position: positionStart + idx,
    }));

  function buildAcceptanceCriteria(d: Draft): string | null {
    const lines = [
      d.rationale ? `분해 이유: ${d.rationale}` : null,
      d.priority ? `우선순위: ${d.priority}` : null,
      d.estimated_steps ? `예상 단계: ${d.estimated_steps}` : null,
    ].filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : null;
  }

  const acceptSelected = async () => {
    if (!drafts) return;
    const picked = drafts.filter((d) => selected.has(d.id));
    if (picked.length === 0) return;
    setAccepting(true);
    try {
      await onAccept(buildCards(picked));
      reset();
      onOpenChange(false);
    } finally {
      setAccepting(false);
    }
  };

  const acceptAll = async () => {
    if (!drafts) return;
    setAccepting(true);
    try {
      await onAccept(buildCards(drafts));
      reset();
      onOpenChange(false);
    } finally {
      setAccepting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-w-xl"
        data-testid="ai-assist-dialog"
        data-source={source ?? ""}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>AI 도움 받기</DialogTitle>
          <DialogDescription>
            만들고 싶은 기능을 한 문장으로 적으세요.
            <LearningHint inline className="ml-1">
              AI가 로드맵 단계를 제안합니다.
            </LearningHint>
          </DialogDescription>
        </DialogHeader>

        {drafts === null ? (
          <>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              aria-label="AI 도움 요청 입력"
              data-testid="ai-assist-input"
              placeholder="예: 간단한 할 일 앱을 만들고 싶어요"
              className="w-full resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            />
            {error ? (
              <p
                className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
                data-testid="ai-assist-error"
              >
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button
                variant="primary"
                data-testid="ai-assist-request"
                onClick={() => {
                  void requestSuggestions();
                }}
                disabled={loading || input.trim().length === 0}
              >
                <Sparkles />
                {loading ? "제안 받는 중..." : "제안 받기"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="max-h-80 overflow-y-auto" data-testid="ai-assist-drafts">
              <ul className="space-y-2">
                {drafts.map((d) => {
                  const isSelected = selected.has(d.id);
                  return (
                    <li
                      key={d.id}
                      className="rounded-md border bg-bg-panel2 p-3"
                      data-testid="ai-assist-draft"
                      data-draft-id={d.id}
                    >
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(d.id)}
                          className="mt-1"
                          data-testid="ai-assist-draft-checkbox"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-fg">{d.title}</p>
                          <p className="mt-0.5 text-xs text-fg-muted">{d.summary}</p>
                          {d.rationale || d.priority || d.estimated_steps ? (
                            <p className="mt-1 text-[11px] text-fg-muted">
                              {[
                                d.priority ? `우선순위 ${d.priority}` : null,
                                d.estimated_steps ? `예상 ${d.estimated_steps}단계` : null,
                                d.rationale ?? null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => reset()}>
                다시 요청
              </Button>
              <Button
                variant="outline"
                onClick={acceptSelected}
                disabled={selected.size === 0 || accepting}
                data-testid="ai-assist-accept-selected"
              >
                선택 수락 ({selected.size})
              </Button>
              <Button
                variant="primary"
                onClick={acceptAll}
                disabled={accepting}
                data-testid="ai-assist-accept-all"
              >
                {accepting ? "저장 중..." : "모두 수락"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
