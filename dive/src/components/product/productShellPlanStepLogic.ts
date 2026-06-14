import type { PlanRoadmapStep } from "../../features/roadmap";
import type { CardTileData } from "../workmap/types";

export type SessionStepMap = Record<number, number>;

export function buildPlanStepExecutionPrompt(item: PlanRoadmapStep): string {
  const lines = [
    "이 roadmap step을 바로 실행해 주세요.",
    `Step: ${item.step.step_id} - ${item.step.title}`,
  ];
  if (item.step.instruction_seed?.trim()) {
    lines.push("", item.step.instruction_seed.trim());
  } else if (item.step.summary?.trim()) {
    lines.push("", item.step.summary.trim());
  }
  const expectedFiles = Array.isArray(item.step.expected_files)
    ? item.step.expected_files.filter((value): value is string => typeof value === "string")
    : [];
  if (expectedFiles.length > 0) {
    lines.push("", `Expected files: ${expectedFiles.join(", ")}`);
  }
  const acceptanceCriteria = Array.isArray(item.step.acceptance_criteria)
    ? item.step.acceptance_criteria.filter((value): value is string => typeof value === "string")
    : [];
  if (acceptanceCriteria.length > 0) {
    lines.push("", "Acceptance criteria:", ...acceptanceCriteria.map((item) => `- ${item}`));
  }
  lines.push(
    "",
    '참고: 작업 디렉터리에 필요한 구조나 파일이 아직 없을 수 있습니다(특히 첫 단계). 이럴 때 "코드가 없다"며 멈추거나 기존 코드 위치를 되묻지 말고, 완료 기준을 충족하도록 필요한 파일과 디렉터리를 직접 생성하여 이 단계를 완료하세요.',
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
