// NOTE (P2 approval-judgment-dead-component): the ApprovalJudgment component
// itself was dead (superseded by the judgment gate inline in
// StepDetailSlideIn.tsx) and has been removed. This file is kept only as the
// home of the ApprovalOutcome/ApprovalDecision/ApprovalDecisionWithTime types,
// which are still live and type-imported by roadmap/types.ts,
// useProductShellController.ts, useWorkmap.ts, StepDetailSlideIn.tsx, and
// useChatSession.ts. Residual for a follow-up: relocate these types to a
// non-component module (e.g. features/roadmap/types.ts) and update the five
// importers + the "ApprovalJudgment" substring check in
// scripts/verify-product-flow.mjs accordingly.
export type ApprovalOutcome =
  | "approved"
  | "approved_with_concern"
  | "revision_requested"
  | "verification_deferred";

export interface ApprovalDecision {
  outcome: ApprovalOutcome;
  note: string | null;
  observationEvidence?: {
    observationIds: string[];
    manualChecks: string[];
    criterionIds: string[];
  } | null;
}

export type ApprovalDecisionWithTime = ApprovalDecision & { decided_at: number };
