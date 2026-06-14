import type {
  ProvocationCard,
  ProvocationCardType,
  ProvocationSeverity,
  ScaffoldMode,
  SupervisorMode,
} from "./types";

const TYPE_PRIORITY: Record<ProvocationCardType, number> = {
  diff_scope_drift: 600,
  ai_self_report_only: 500,
  regeneration_loop: 400,
  missing_verification_step: 300,
  missing_acceptance_criteria: 200,
  oversized_scope: 100,
};

const SEVERITY_PRIORITY: Record<ProvocationSeverity, number> = {
  risk: 30,
  caution: 20,
  info: 10,
};

export function rankProvocationCard(card: ProvocationCard): number {
  let score = TYPE_PRIORITY[card.type] + SEVERITY_PRIORITY[card.severity];

  if (card.type === "diff_scope_drift" && card.metadata?.highRisk === true) {
    score += 100;
  }

  if (card.type === "ai_self_report_only" && card.stage === "finalApproval") {
    score += 60;
  }

  return score;
}

export function sortProvocationCards(cards: ProvocationCard[]): ProvocationCard[] {
  return [...cards].sort((a, b) => {
    const byRank = rankProvocationCard(b) - rankProvocationCard(a);
    if (byRank !== 0) return byRank;
    return a.id.localeCompare(b.id);
  });
}

export function selectPrimaryProvocationCard(cards: ProvocationCard[]): ProvocationCard | null {
  return sortProvocationCards(cards)[0] ?? null;
}

export function shouldShowProvocationCardInMode(
  card: ProvocationCard,
  mode: ScaffoldMode | SupervisorMode,
): boolean {
  void card;
  void mode;
  return true;
}
