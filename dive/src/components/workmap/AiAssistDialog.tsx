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
import type { CardState, CardTileData } from "./types";

interface Draft {
  id: number;
  title: string;
  summary: string;
}

function mockSuggestionsFor(_input: string): Draft[] {
  return [
    {
      id: 1,
      title: "할 일 입력 폼",
      summary: "입력란과 추가 버튼 + 키보드 Enter 제출",
    },
    {
      id: 2,
      title: "할 일 목록 렌더",
      summary: "배열 상태 + 빈 상태 UI",
    },
    {
      id: 3,
      title: "체크/삭제 인터랙션",
      summary: "각 항목에 완료 토글 + 삭제 버튼",
    },
    {
      id: 4,
      title: "localStorage 영속화",
      summary: "페이지 새로고침 후에도 유지",
    },
  ];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: (cards: CardTileData[]) => void;
  positionStart?: number;
}

export function AiAssistDialog({ open, onOpenChange, onAccept, positionStart = 1 }: Props) {
  const [input, setInput] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setInput("");
    setDrafts(null);
    setSelected(new Set());
    setLoading(false);
  };

  const requestSuggestions = () => {
    setLoading(true);
    setDrafts(null);
    setTimeout(() => {
      const next = mockSuggestionsFor(input);
      setDrafts(next);
      setSelected(new Set(next.map((d) => d.id)));
      setLoading(false);
    }, 350);
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
      state: "decomposed" satisfies CardState,
      stagesCompleted: { d: true, i: false, v: false, e: false },
      position: positionStart + idx,
    }));

  const acceptSelected = () => {
    if (!drafts) return;
    const picked = drafts.filter((d) => selected.has(d.id));
    if (picked.length === 0) return;
    onAccept(buildCards(picked));
    reset();
    onOpenChange(false);
  };

  const acceptAll = () => {
    if (!drafts) return;
    onAccept(buildCards(drafts));
    reset();
    onOpenChange(false);
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
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>AI 도움 받기</DialogTitle>
          <DialogDescription>
            만들고 싶은 기능을 한 문장으로 설명하면 AI가 작업 카드를 제안합니다.
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
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button
                variant="primary"
                data-testid="ai-assist-request"
                onClick={requestSuggestions}
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
                disabled={selected.size === 0}
                data-testid="ai-assist-accept-selected"
              >
                선택 수락 ({selected.size})
              </Button>
              <Button variant="primary" onClick={acceptAll} data-testid="ai-assist-accept-all">
                모두 수락
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
