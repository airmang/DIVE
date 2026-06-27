import type { SupervisorMode } from "../provocation";

export type VerificationCoachStatus = "shown" | "unavailable" | "dropped";

export type VerificationCheckKind =
  | "preview"
  | "app_run"
  | "terminal"
  | "file"
  | "diff"
  | "test"
  | "manual";

export type ObservationEvidenceKind =
  | "manual_observation"
  | "preview_observation"
  | "app_run_observation"
  | "terminal_observation"
  | "file_observation"
  | "test_observation";

export type GuidanceReasonCode =
  | "ok"
  | "provider_not_configured"
  | "missing_credentials"
  | "missing_project_root"
  | "provider_not_supported"
  | "runtime_unavailable"
  | "sidecar_unavailable"
  | "sidecar_error"
  | "timeout"
  | "malformed_output"
  | "generic_guidance"
  | "unsupported_evidence"
  | "unsafe_action"
  | "missing_criterion";

export interface VerificationCriterion {
  criterionId: string;
  text: string;
}

export interface VerificationCoachStep {
  title: string;
  summary?: string | null;
  instruction?: string | null;
  acceptanceCriteria: VerificationCriterion[];
}

export interface PriorObservationEvidence {
  observationId: string;
  guideVersion?: number | null;
  criterionIds: string[];
  evidenceKind: ObservationEvidenceKind;
  observationText: string;
  recordedAt?: number | null;
}

export interface VerificationCoachEvidence {
  changedFiles: string[];
  verificationKind?: string | null;
  verificationCommand?: string | null;
  verificationManualCheck?: string | null;
  testResult?: "pass" | "fail" | "skipped" | null;
  aiClaimedDone?: boolean;
  previewAvailable: boolean;
  appRunAvailable: boolean;
  diffAvailable: boolean;
  priorObservations: PriorObservationEvidence[];
}

export interface VerificationCoachGenerateRequest {
  sessionId: number;
  projectId?: number | null;
  cardId: number;
  planStepId?: number | null;
  guideVersion?: number | null;
  sourceUiMode: SupervisorMode;
  locale?: string;
  step: VerificationCoachStep;
  evidence: VerificationCoachEvidence;
}

export interface VerificationRecommendedCheck {
  kind: VerificationCheckKind;
  label: string;
  instruction: string;
  expectedObservation: string;
}

export interface VerificationGuide {
  criterionSummary: string;
  recommendedChecks: VerificationRecommendedCheck[];
  expectedObservations?: string[];
  evidencePrompts: string[];
}

export interface GuidanceValidationResult {
  outcome: "valid" | "dropped" | "unavailable";
  reasonCode: GuidanceReasonCode;
  evidenceRefs: string[];
}

export interface VerificationCoachFallbackGuidance {
  criterionId: string;
  classes: string[];
}

export interface VerificationCoachGenerateResponse {
  status: VerificationCoachStatus;
  eventId: string;
  guideVersion: number;
  guide?: VerificationGuide | null;
  fallbackGuidance?: VerificationCoachFallbackGuidance[];
  validation?: GuidanceValidationResult | null;
  dropReason?: GuidanceReasonCode | null;
  message?: string | null;
  model?: string | null;
  latencyMs?: number | null;
}

export interface ObservationEvidenceInput {
  sessionId: number;
  cardId: number;
  planStepId?: number | null;
  guideVersion?: number | null;
  evidenceKind: ObservationEvidenceKind;
  criterionIds: string[];
  observationText: string;
}

export interface ObservationEvidenceRecord extends ObservationEvidenceInput {
  observationId: string;
  recordedAt: number;
}
