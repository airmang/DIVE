import type { PlanRoadmapStep } from "../../features/roadmap";
import type { CardTileData } from "../workmap/types";

export type SessionStepMap = Record<number, number>;

export function buildPlanStepExecutionPrompt(item: PlanRoadmapStep): string {
  const lines = [
    "다음 계획 Step만 실행해 주세요.",
    "",
    "이 내용은 DIVE의 승인된 계획에서 가져온 실행 컨텍스트입니다. 범위를 넓히지 말고 이 Step의 완료 기준만 충족하세요.",
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
  const acceptanceCriteria = Array.isArray(item.step.acceptance_criteria)
    ? item.step.acceptance_criteria.filter((value): value is string => typeof value === "string")
    : [];
  if (acceptanceCriteria.length > 0) {
    lines.push("", "Acceptance criteria:", ...acceptanceCriteria.map((item) => `- ${item}`));
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
    "- 필요한 파일이나 디렉터리가 아직 없으면 직접 생성하세요.",
    "- 기존 동작을 불필요하게 바꾸지 말고 위 Step 범위 안에서만 수정하세요.",
    "- 완료 후 변경한 파일, 실행한 검증, 남은 위험을 짧게 보고하세요.",
    "- 완료 기준을 충족할 수 없으면 추측하지 말고 막힌 이유와 필요한 결정을 설명하세요.",
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
