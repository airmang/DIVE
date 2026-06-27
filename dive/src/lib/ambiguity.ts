export type AmbiguityKind =
  | "pronoun"
  | "vague_subject"
  | "vague_quantity"
  | "ambiguous_time"
  | "missing_target";

export interface AmbiguityHit {
  kind: AmbiguityKind;
  span: [number, number];
  match: string;
  suggestion: string;
}

export type AmbiguityLocale = "ko" | "en";

interface Rule {
  kind: AmbiguityKind;
  pattern: RegExp;
  suggestion: string;
}

const RULES_BY_LOCALE: Record<AmbiguityLocale, Rule[]> = {
  ko: [
    {
      kind: "pronoun",
      pattern: /(이거|그거|저거|이것|그것|저것|그걸|이걸)/gu,
      suggestion: "지시 대명사 대신 구체적인 이름(파일명/함수명/단계 제목)으로 바꿔 주세요.",
    },
    {
      kind: "ambiguous_time",
      pattern: /(저번|지난번|방금|아까)\s*(거|것|대화|코드|파일)?/gu,
      suggestion: '언제·어느 시점의 것인지 명시해 주세요 — 예: "3번 단계" 또는 "직전 메시지".',
    },
    {
      kind: "vague_subject",
      pattern: /(뭔가|어떤\s*거|그런\s*(식|거))/gu,
      suggestion: "뭘 만들지·뭘 고칠지를 구체적으로 써 주세요.",
    },
    {
      kind: "vague_quantity",
      pattern: /(적당히|대충|여러|알아서|아무거나)\s*(개|번|건)?/gu,
      suggestion: "개수·범위를 숫자 또는 이름 목록으로 명시해 주세요.",
    },
    {
      kind: "missing_target",
      pattern:
        /(지워줘|삭제해줘|없애줘|고쳐줘|수정해줘|바꿔줘|만들어줘|추가해줘)(?=\s*$|\s*[.!?])/gu,
      suggestion: "무엇을 대상으로 하는 명령인지(파일·함수·UI 요소) 덧붙여 주세요.",
    },
  ],
  en: [
    {
      kind: "vague_subject",
      pattern: /\b(something|nice|whatever|anything|up to you|you decide)\b/giu,
      suggestion: "Name the specific thing to build or improve.",
    },
    {
      kind: "pronoun",
      pattern: /\b(it|this|that)\b/giu,
      suggestion: "Replace the pronoun with the specific file, feature, or UI element.",
    },
    {
      kind: "vague_quantity",
      pattern: /\b(a few|some)\b/giu,
      suggestion: "Give a number, range, or named list.",
    },
    {
      kind: "missing_target",
      pattern: /\b(make|fix)\s+it\b/giu,
      suggestion: "Name the target to make or fix.",
    },
  ],
};

export function detectAmbiguity(text: string): AmbiguityHit[];
export function detectAmbiguity(text: string, locale: AmbiguityLocale): AmbiguityHit[];
export function detectAmbiguity(text: string, locale: AmbiguityLocale = "ko"): AmbiguityHit[] {
  if (!text || text.length === 0) return [];
  const hits: AmbiguityHit[] = [];
  for (const rule of RULES_BY_LOCALE[locale]) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      if (m.index === rule.pattern.lastIndex) {
        rule.pattern.lastIndex++;
        continue;
      }
      hits.push({
        kind: rule.kind,
        span: [m.index, m.index + m[0].length],
        match: m[0],
        suggestion: rule.suggestion,
      });
    }
  }
  hits.sort((a, b) => a.span[0] - b.span[0]);
  return dedupeOverlapping(hits);
}

function dedupeOverlapping(hits: AmbiguityHit[]): AmbiguityHit[] {
  const out: AmbiguityHit[] = [];
  for (const hit of hits) {
    const last = out[out.length - 1];
    if (!last || hit.span[0] >= last.span[1]) {
      out.push(hit);
    }
  }
  return out;
}

export interface HighlightSegment {
  text: string;
  hit: AmbiguityHit | null;
}

export function segmentWithHits(text: string, hits: AmbiguityHit[]): HighlightSegment[] {
  if (hits.length === 0) return [{ text, hit: null }];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.span[0] > cursor) {
      segments.push({ text: text.slice(cursor, hit.span[0]), hit: null });
    }
    segments.push({
      text: text.slice(hit.span[0], hit.span[1]),
      hit,
    });
    cursor = hit.span[1];
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), hit: null });
  }
  return segments;
}
