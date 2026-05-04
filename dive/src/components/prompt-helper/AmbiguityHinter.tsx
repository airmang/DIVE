import { useEffect, useMemo, useRef, useState } from "react";
import type { AmbiguityHit, DiveStage } from "../../lib/ambiguity";
import { detectAmbiguity, segmentWithHits } from "../../lib/ambiguity";

interface Props {
  value: string;
  stage?: DiveStage | null;
  debounceMs?: number;
  onHitsChange?: (hits: AmbiguityHit[]) => void;
}

export function AmbiguityUnderlay({ value, stage, debounceMs = 500, onHitsChange }: Props) {
  const [hits, setHits] = useState<AmbiguityHit[]>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
      const detected = detectAmbiguity(value, stage ?? undefined);
      setHits(detected);
      onHitsChange?.(detected);
    }, debounceMs);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [value, stage, debounceMs, onHitsChange]);

  const segments = useMemo(() => segmentWithHits(value, hits), [value, hits]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm leading-normal text-transparent"
      data-testid="ambiguity-underlay"
      data-hit-count={hits.length}
    >
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark
            key={i}
            className="rounded-sm bg-warn/30 text-transparent"
            data-testid="ambiguity-hit"
            data-hit-kind={seg.hit.kind}
            title={seg.hit.suggestion}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </div>
  );
}

interface HintListProps {
  hits: AmbiguityHit[];
}

export function AmbiguityHintList({ hits }: HintListProps) {
  if (hits.length === 0) return null;
  return (
    <ul
      className="flex flex-col gap-1 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-[11px]"
      role="list"
      data-testid="ambiguity-hint-list"
    >
      {hits.map((h, i) => (
        <li key={i} className="flex gap-2" data-testid="ambiguity-hint" data-hit-kind={h.kind}>
          <code className="text-warn">{h.match}</code>
          <span className="text-fg-muted">{h.suggestion}</span>
        </li>
      ))}
    </ul>
  );
}
