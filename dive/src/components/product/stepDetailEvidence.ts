export function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

/**
 * Minimum length for a manual observation to count as substantive evidence
 * (S-029). A bare keystroke or empty string is not an observation.
 */
export const MIN_OBSERVATION_LENGTH = 8;

export function isSubstantiveObservation(text: string | null | undefined): boolean {
  return typeof text === "string" && text.trim().length >= MIN_OBSERVATION_LENGTH;
}

/**
 * Split a single acceptance-criteria string into the distinct criteria it
 * enumerates (S-029): a multi-AC goal stored as one summary string (e.g.
 * "AC-1 …\nAC-2 …\nAC-3 …") must still gate on EACH criterion, not collapse to
 * one. Falls back to a single criterion for plain one-line text. Used only when
 * the step has no structured `linkedCriteria`.
 */
export function splitAcceptanceCriteria(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  let parts = trimmed
    .split(/\r?\n|[;•]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    const markerParts = trimmed
      .split(/(?=\bAC[\s-]?\d+\b)/i)
      .map((part) => part.replace(/^[,\s]+/, "").trim())
      .filter(Boolean);
    if (markerParts.length > 1) parts = markerParts;
  }
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique : [trimmed];
}
