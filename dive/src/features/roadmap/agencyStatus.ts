import type { ChangedFile } from "../../components/slide-in/types";
import type { VerifyLogView } from "../../components/workmap/types";
import type { ApprovalProvenance, VerificationStatusId } from "../provocation";
import { hasConcreteVerification } from "../provocation/verificationGrade";
import type {
  AgencyStateId,
  AgencyStateItem,
  AgencyStateView,
  AgencyTone,
  RoadmapStepStatus,
} from "./types";

type AgencySourceStatus = RoadmapStepStatus | "blocked" | "ready";

const EMPTY_AGENCY_STATE: AgencyStateView = {
  primary: null,
  items: [],
  hasRisk: false,
};

const AGENCY_STATE_META: Record<AgencyStateId, Omit<AgencyStateItem, "id">> = {
  intent_needed: {
    component: "intent",
    label: "의도/완료 기준 필요",
    tone: "warn",
    evidenceBacked: false,
    priority: 40,
  },
  plan_review_needed: {
    component: "plan",
    label: "계획 검토 필요",
    tone: "warn",
    evidenceBacked: false,
    priority: 50,
  },
  approval_required: {
    component: "action",
    label: "승인 필요",
    tone: "warn",
    evidenceBacked: false,
    priority: 75,
  },
  running: {
    component: "action",
    label: "실행 중",
    tone: "info",
    evidenceBacked: false,
    priority: 30,
  },
  diff_review_needed: {
    component: "diff",
    label: "변경 확인 필요",
    tone: "warn",
    evidenceBacked: false,
    priority: 65,
  },
  verification_needed: {
    component: "verify",
    label: "검증 필요",
    tone: "warn",
    evidenceBacked: false,
    priority: 60,
  },
  verified_with_evidence: {
    component: "verify",
    label: "검증 증거 있음",
    tone: "success",
    evidenceBacked: true,
    priority: 10,
  },
  ai_self_report_only: {
    component: "verify",
    label: "AI 자가보고만 있음",
    tone: "risk",
    evidenceBacked: false,
    priority: 90,
  },
  verification_failed: {
    component: "verify",
    label: "검증 실패",
    tone: "risk",
    evidenceBacked: false,
    priority: 100,
  },
  rollback_available: {
    component: "rollback",
    label: "되돌리기 가능",
    tone: "info",
    evidenceBacked: true,
    priority: 20,
  },
  approved_with_risk: {
    component: "decision",
    label: "위험 감수 승인",
    tone: "risk",
    evidenceBacked: false,
    priority: 95,
  },
};

export interface DeriveAgencyStateInput {
  goalText?: string | null;
  acceptanceCriteria?: string | string[] | null;
  planDraftPending?: boolean;
  pendingPermission?: boolean;
  running?: boolean;
  status?: AgencySourceStatus | null;
  changedFiles?: ChangedFile[] | string[] | null;
  diffViewed?: boolean;
  verifyLog?: VerifyLogView | null;
  verificationState?: ApprovalProvenance["verificationState"] | string | null;
  approvalProvenance?: ApprovalProvenance | null;
  acceptanceCriterionConfirmed?: boolean;
  checkpointAvailable?: boolean;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function hasAcceptanceCriteria(value: DeriveAgencyStateInput["acceptanceCriteria"]): boolean {
  if (Array.isArray(value)) return value.some((item) => item.trim().length > 0);
  return hasText(value);
}

function changedFileCount(files: DeriveAgencyStateInput["changedFiles"]): number {
  return (
    files?.filter((item) => {
      if (typeof item === "string") return item.trim().length > 0;
      return item.path.trim().length > 0;
    }).length ?? 0
  );
}

function statusIds(provenance: ApprovalProvenance | null | undefined): string[] {
  return provenance?.statusIds ?? provenance?.statuses.map((item) => item.id) ?? [];
}

function addState(states: Map<AgencyStateId, AgencyStateItem>, id: AgencyStateId) {
  if (states.has(id)) return;
  states.set(id, { id, ...AGENCY_STATE_META[id] });
}

function sortedView(states: Map<AgencyStateId, AgencyStateItem>): AgencyStateView {
  if (states.size === 0) return EMPTY_AGENCY_STATE;
  const items = [...states.values()].sort((a, b) => b.priority - a.priority);
  return {
    primary: items[0] ?? null,
    items,
    hasRisk: items.some((item) => item.tone === "risk"),
  };
}

export function deriveAgencyStateView(input: DeriveAgencyStateInput): AgencyStateView {
  const states = new Map<AgencyStateId, AgencyStateItem>();
  const ids = statusIds(input.approvalProvenance);
  const verificationState =
    input.verificationState ?? input.approvalProvenance?.verificationState ?? null;
  const riskAccepted = input.approvalProvenance?.riskAccepted ?? false;
  const testResult = input.verifyLog?.test_result ?? null;
  const hasChangedFiles = changedFileCount(input.changedFiles) > 0;
  const reachedVerificationSurface =
    input.status === "review" || input.status === "done" || input.status === "shipped";

  if (!hasText(input.goalText) || !hasAcceptanceCriteria(input.acceptanceCriteria)) {
    addState(states, "intent_needed");
  }

  if (input.planDraftPending) addState(states, "plan_review_needed");
  if (input.pendingPermission || input.status === "review") addState(states, "approval_required");
  if (input.running || input.status === "in_progress") addState(states, "running");

  if (hasChangedFiles && !input.diffViewed) {
    addState(states, "diff_review_needed");
  }

  if (testResult === "fail" || verificationState === "failed_but_accepted") {
    addState(states, "verification_failed");
  }

  if (
    ids.includes("ai_self_report_only") ||
    (input.verifyLog?.intent_match === true && testResult === "skipped")
  ) {
    addState(states, "ai_self_report_only");
  }

  if (
    riskAccepted ||
    ids.includes("approved_with_risk") ||
    verificationState === "unverified_risk_accepted" ||
    verificationState === "failed_but_accepted"
  ) {
    addState(states, "approved_with_risk");
  }

  if (input.checkpointAvailable) {
    addState(states, "rollback_available");
  }

  const verified = hasConcreteVerification({
    statusIds: ids as VerificationStatusId[],
    testResult,
    manualOrPreviewObserved: ids.includes("app_launched") || ids.includes("preview_checked"),
    acceptanceCriterionConfirmed: input.acceptanceCriterionConfirmed ?? false,
  });
  if (verified || verificationState === "verified_with_evidence") {
    addState(states, "verified_with_evidence");
  }

  if (
    (reachedVerificationSurface && !input.verifyLog) ||
    testResult === "skipped" ||
    ids.includes("external_test_not_run") ||
    verificationState === "unverified_risk_accepted"
  ) {
    if (!states.has("verified_with_evidence")) addState(states, "verification_needed");
  }

  return sortedView(states);
}

export function agencyToneClass(tone: AgencyTone): string {
  switch (tone) {
    case "success":
      return "border-success/60 bg-success/10 text-success";
    case "risk":
      return "border-danger/60 bg-danger/10 text-danger";
    case "warn":
      return "border-warn/60 bg-warn/10 text-warn";
    case "info":
      return "border-info/50 bg-info/10 text-info";
  }
}
