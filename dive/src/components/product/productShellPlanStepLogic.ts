import type { PlanRoadmapStep } from "../../features/roadmap";
import type { CardTileData } from "../workmap/types";
import type { Locale } from "../../i18n";

export type SessionStepMap = Record<number, number>;

interface ExecutionCriteriaContext {
  criteria: string[];
  linkedCriterionIds: string[];
  rationale: string | null;
}

function valueObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compactStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function criterionText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  const object = valueObject(value);
  const text = typeof object?.text === "string" ? object.text.trim() : "";
  return text || null;
}

function criteriaSource(value: unknown): unknown {
  const object = valueObject(value);
  if (!object) return value;
  for (const key of ["criteria", "acceptanceCriteria", "acceptance_criteria"]) {
    const candidate = object[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function executionCriteriaContext(value: unknown): ExecutionCriteriaContext {
  const object = valueObject(value);
  const source = criteriaSource(value);
  return {
    criteria: Array.isArray(source)
      ? source.map(criterionText).filter((item): item is string => Boolean(item))
      : [],
    linkedCriterionIds: [
      ...compactStrings(object?.linkedCriterionIds),
      ...compactStrings(object?.linked_criterion_ids),
    ],
    rationale:
      optionalString(object?.rationale) ??
      optionalString(object?.decompositionRationale) ??
      optionalString(object?.decomposition_rationale),
  };
}

export function buildPlanStepExecutionPrompt(item: PlanRoadmapStep, locale: Locale = "ko"): string {
  const en = locale === "en";
  const lines = [
    en ? "Execute only the following plan step." : "다음 계획 Step만 실행해 주세요.",
    "",
    en
      ? "This is execution context from DIVE's approved plan. Don't widen the scope — meet only this step's completion criteria."
      : "이 내용은 DIVE의 승인된 계획에서 가져온 실행 컨텍스트입니다. 범위를 넓히지 말고 이 Step의 완료 기준만 충족하세요.",
    "",
    `Step ID: ${item.step.step_id}`,
    `Title: ${item.step.title}`,
  ];
  if (item.step.instruction_seed?.trim()) {
    lines.push("", "Instruction:", item.step.instruction_seed.trim());
  } else if (item.step.summary?.trim()) {
    lines.push("", "Objective:", item.step.summary.trim());
  }
  const expectedFiles = Array.isArray(item.step.expected_files)
    ? item.step.expected_files.filter((value): value is string => typeof value === "string")
    : [];
  if (expectedFiles.length > 0) {
    lines.push("", "Expected files:", ...expectedFiles.map((file) => `- ${file}`));
  }
  const acceptanceCriteria = executionCriteriaContext(item.step.acceptance_criteria);
  if (acceptanceCriteria.criteria.length > 0) {
    lines.push(
      "",
      "Acceptance criteria:",
      ...acceptanceCriteria.criteria.map((item) => `- ${item}`),
    );
  }
  if (acceptanceCriteria.linkedCriterionIds.length > 0) {
    lines.push(
      "",
      "Linked PRD criteria:",
      ...acceptanceCriteria.linkedCriterionIds.map((criterionId) => `- ${criterionId}`),
    );
  }
  if (acceptanceCriteria.rationale) {
    lines.push("", "Rationale:", acceptanceCriteria.rationale);
  }
  const verificationDetails = [
    item.step.verification_kind?.trim() ? `Kind: ${item.step.verification_kind.trim()}` : null,
    item.step.verification_command?.trim()
      ? `Command: ${item.step.verification_command.trim()}`
      : null,
    item.step.verification_manual_check?.trim()
      ? `Manual check: ${item.step.verification_manual_check.trim()}`
      : null,
  ].filter((value): value is string => Boolean(value));
  if (verificationDetails.length > 0) {
    lines.push("", "Verification:", ...verificationDetails.map((detail) => `- ${detail}`));
  }
  lines.push(
    "",
    "Execution constraints:",
    en
      ? "- If a needed file or directory doesn't exist yet, create it yourself."
      : "- 필요한 파일이나 디렉터리가 아직 없으면 직접 생성하세요.",
    en
      ? "- Don't change existing behavior unnecessarily — modify only within this step's scope."
      : "- 기존 동작을 불필요하게 바꾸지 말고 위 Step 범위 안에서만 수정하세요.",
    en
      ? "- When done, briefly report the files you changed, the verification you ran, and any remaining risk."
      : "- 완료 후 변경한 파일, 실행한 검증, 남은 위험을 짧게 보고하세요.",
    en
      ? "- If you can't meet the completion criteria, don't guess — explain what's blocking you and what decision is needed."
      : "- 완료 기준을 충족할 수 없으면 추측하지 말고 막힌 이유와 필요한 결정을 설명하세요.",
  );
  return lines.join("\n");
}

export function deriveActivePlanStepIdForChat(input: {
  currentSessionId: number | null;
  justOpenedPlanStepBySession: SessionStepMap;
  currentCard: Pick<CardTileData, "id"> | null;
  planRoadmapSteps: PlanRoadmapStep[];
}): number | undefined {
  if (input.currentSessionId === null) return undefined;
  const justOpenedStepId = input.justOpenedPlanStepBySession[input.currentSessionId];
  if (justOpenedStepId !== undefined) return justOpenedStepId;
  if (!input.currentCard) return undefined;
  return input.planRoadmapSteps.find(
    (item) =>
      item.mapping?.session_id === input.currentSessionId &&
      item.mapping?.card_id === input.currentCard?.id,
  )?.step.id;
}

export function pruneCaughtUpPlanStepSessionMap(
  current: SessionStepMap,
  planRoadmapSteps: PlanRoadmapStep[],
): SessionStepMap {
  let changed = false;
  const next = { ...current };
  for (const [sessionIdText, stepId] of Object.entries(current)) {
    const sessionId = Number(sessionIdText);
    const mappingCaughtUp = planRoadmapSteps.some(
      (item) => item.mapping?.session_id === sessionId && item.mapping?.step_id === stepId,
    );
    if (mappingCaughtUp) {
      delete next[sessionId];
      changed = true;
    }
  }
  return changed ? next : current;
}
