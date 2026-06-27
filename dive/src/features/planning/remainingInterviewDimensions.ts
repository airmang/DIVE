import type { InterviewAnswer } from "./types";

const TOTAL_DIMENSIONS = 6;

const DIMENSION_PATTERNS = {
  audience:
    /\b(audience|customer|customers|for whom|students?|teachers?|users?|who will|who is this for)\b/i,
  doneSignal: /\b(done|complete|completed|finished|ready|success|successful|observable result)\b/i,
  scope:
    /\b(in scope|include|includes|first version|mvp|build|deliver|feature|features|requirements?)\b/i,
  nonGoals: /\b(non-goals?|out of scope|exclude|excludes|not doing|will not|won't|defer|skip)\b/i,
  acceptanceCriteria:
    /\b(acceptance criteria|criterion|criteria|checkable|verify|verified|testable|passes when|must show)\b/i,
} as const;

function hasAnswer(answer: InterviewAnswer): boolean {
  return answer.answer.trim().length > 0;
}

function countAcceptanceCriteria(answer: string): number {
  const trimmed = answer.trim();
  if (trimmed.length === 0) return 0;

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const listed = lines.filter((line) => /^(-|\*|\d+[.)]|ac\s*\d+[:.)-]?)/i.test(line));
  if (listed.length > 0) return Math.min(2, listed.length);

  const semicolonParts = trimmed
    .split(/;+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (semicolonParts.length > 1) return Math.min(2, semicolonParts.length);

  const sentences = trimmed
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length > 1) return Math.min(2, sentences.length);

  return 1;
}

export function remainingInterviewDimensions(answers: readonly InterviewAnswer[]): number {
  const filled = {
    audience: false,
    doneSignal: false,
    scope: false,
    nonGoals: false,
  };
  let acceptanceCriteria = 0;

  for (const answer of answers) {
    if (!hasAnswer(answer)) continue;
    const combined = `${answer.question} ${answer.answer}`;

    if (DIMENSION_PATTERNS.audience.test(combined)) filled.audience = true;
    if (DIMENSION_PATTERNS.doneSignal.test(combined)) filled.doneSignal = true;
    if (DIMENSION_PATTERNS.scope.test(combined)) filled.scope = true;
    if (DIMENSION_PATTERNS.nonGoals.test(combined)) filled.nonGoals = true;
    if (DIMENSION_PATTERNS.acceptanceCriteria.test(combined)) {
      acceptanceCriteria += countAcceptanceCriteria(answer.answer);
    }
  }

  const filledDimensions =
    Number(filled.audience) +
    Number(filled.doneSignal) +
    Number(filled.scope) +
    Number(filled.nonGoals) +
    Math.min(2, acceptanceCriteria);

  return Math.max(0, TOTAL_DIMENSIONS - filledDimensions);
}
