import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { Button } from "../ui/button";
import { useT } from "../../i18n";
import {
  generateVerificationCoachGuide,
  recordVerificationObservation,
} from "../../features/verification-coach/api";
import type {
  GuidanceReasonCode,
  ObservationEvidenceKind,
  ObservationEvidenceRecord,
  VerificationCoachGenerateRequest,
  VerificationCoachGenerateResponse,
  VerificationGuide,
} from "../../features/verification-coach/types";

interface VerificationCoachPanelProps {
  request: VerificationCoachGenerateRequest | null;
  observation: ObservationEvidenceRecord | null;
  onObservationRecorded: (record: ObservationEvidenceRecord) => void;
}

const OBSERVATION_KINDS: ObservationEvidenceKind[] = [
  "manual_observation",
  "terminal_observation",
  "file_observation",
  "preview_observation",
  "app_run_observation",
  "test_observation",
];

const COACH_UNAVAILABLE_REASON_KEYS: Record<GuidanceReasonCode, string> = {
  ok: "roadmap.step_detail.coach_unavailable",
  provider_not_configured: "roadmap.step_detail.coach_unavailable_reason.provider_not_configured",
  missing_credentials: "roadmap.step_detail.coach_unavailable_reason.missing_credentials",
  missing_project_root: "roadmap.step_detail.coach_unavailable_reason.missing_project_root",
  provider_not_supported: "roadmap.step_detail.coach_unavailable_reason.provider_not_supported",
  runtime_unavailable: "roadmap.step_detail.coach_unavailable_reason.runtime_unavailable",
  sidecar_unavailable: "roadmap.step_detail.coach_unavailable_reason.sidecar_unavailable",
  sidecar_error: "roadmap.step_detail.coach_unavailable_reason.sidecar_error",
  timeout: "roadmap.step_detail.coach_unavailable_reason.timeout",
  malformed_output: "roadmap.step_detail.coach_unavailable_reason.malformed_output",
  generic_guidance: "roadmap.step_detail.coach_unavailable_reason.generic_guidance",
  unsupported_evidence: "roadmap.step_detail.coach_unavailable_reason.unsupported_evidence",
  unsafe_action: "roadmap.step_detail.coach_unavailable_reason.unsafe_action",
  missing_criterion: "roadmap.step_detail.coach_unavailable_reason.missing_criterion",
};

function automaticGenerationKey(request: VerificationCoachGenerateRequest | null): string {
  if (!request) return "";
  const { evidence, guideVersion: _guideVersion, ...stableRequest } = request;
  const { priorObservations: _priorObservations, ...stableEvidence } = evidence;
  return JSON.stringify({ ...stableRequest, evidence: stableEvidence });
}

export function VerificationCoachPanel({
  request,
  observation,
  onObservationRecorded,
}: VerificationCoachPanelProps) {
  const t = useT();
  const [response, setResponse] = useState<VerificationCoachGenerateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [observationText, setObservationText] = useState("");
  const [evidenceKind, setEvidenceKind] = useState<ObservationEvidenceKind>("manual_observation");
  const [recording, setRecording] = useState(false);
  const requestRef = useRef<VerificationCoachGenerateRequest | null>(null);
  requestRef.current = request;
  const requestKey = useMemo(() => automaticGenerationKey(request), [request]);

  useEffect(() => {
    let cancelled = false;
    const currentRequest = requestRef.current;
    if (!currentRequest) {
      setResponse(null);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    void generateVerificationCoachGuide({
      ...currentRequest,
      guideVersion: (currentRequest.guideVersion ?? 0) + nonce,
    })
      .then((next) => {
        if (!cancelled) setResponse(next);
      })
      .catch(() => {
        if (!cancelled) {
          setResponse({
            status: "unavailable",
            eventId: `coach-error-${Date.now()}`,
            guideVersion: (currentRequest.guideVersion ?? 0) + nonce + 1,
            dropReason: "runtime_unavailable",
            message: "Verification guidance is unavailable.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce, requestKey]);

  if (!request) return null;
  const guide = response?.status === "shown" ? response.guide : null;
  const unavailableReason = response?.dropReason ?? response?.validation?.reasonCode ?? null;
  const unavailableMessage = unavailableReason
    ? t(COACH_UNAVAILABLE_REASON_KEYS[unavailableReason] ?? "roadmap.step_detail.coach_unavailable")
    : (response?.message ?? t("roadmap.step_detail.coach_unavailable"));
  const criterionIds = request.step.acceptanceCriteria
    .map((criterion) => criterion.criterionId.trim())
    .filter(Boolean);
  const canRecord = criterionIds.length > 0 && observationText.trim().length > 0 && !recording;

  const handleRecordObservation = () => {
    if (!canRecord) return;
    setRecording(true);
    void recordVerificationObservation({
      sessionId: request.sessionId,
      cardId: request.cardId,
      planStepId: request.planStepId,
      guideVersion: response?.guideVersion ?? request.guideVersion ?? null,
      evidenceKind,
      criterionIds,
      observationText: observationText.trim(),
    })
      .then((record) => {
        onObservationRecorded(record);
        setObservationText(record.observationText);
      })
      .finally(() => setRecording(false));
  };

  return (
    <section
      className="text-xs"
      data-testid="verification-coach-panel"
      data-status={response?.status ?? (loading ? "loading" : "idle")}
    >
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => setNonce((current) => current + 1)}
          data-testid="verification-coach-regenerate"
          aria-label={t("roadmap.step_detail.coach_regenerate")}
        >
          <RefreshCcw />
          {t("roadmap.step_detail.coach_regenerate")}
        </Button>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-fg-muted" data-testid="verification-coach-loading">
          {t("roadmap.step_detail.coach_loading")}
        </p>
      ) : guide ? (
        <GuideView guide={guide} />
      ) : (
        <p className="mt-3 text-xs text-fg-muted" data-testid="verification-coach-unavailable">
          {unavailableMessage}
        </p>
      )}

      <div
        className="mt-3 rounded-sm border border-border/80 bg-bg/70 px-2 py-2 text-xs"
        data-testid="verification-observation-form"
      >
        <label className="block font-medium text-fg">
          {t("roadmap.step_detail.coach_observation_label")}
          <textarea
            className="mt-1 min-h-20 w-full resize-none rounded-md border bg-bg px-2 py-1.5 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={observationText}
            onChange={(event) => setObservationText(event.target.value)}
            placeholder={t("roadmap.step_detail.coach_observation_placeholder")}
            data-testid="verification-observation-text"
          />
        </label>
        <label className="mt-2 block font-medium text-fg">
          {t("roadmap.step_detail.coach_observation_kind")}
          <select
            className="mt-1 w-full rounded-md border bg-bg px-2 py-1.5 text-xs"
            value={evidenceKind}
            onChange={(event) => setEvidenceKind(event.target.value as ObservationEvidenceKind)}
            data-testid="verification-observation-kind"
          >
            {OBSERVATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`roadmap.step_detail.coach_kind.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!canRecord}
            onClick={handleRecordObservation}
            data-testid="verification-observation-record"
          >
            {t("roadmap.step_detail.coach_record_observation")}
          </Button>
          {observation ? (
            <span
              className="text-[11px] font-medium text-success"
              data-testid="verification-observation-saved"
            >
              {t("roadmap.step_detail.coach_observation_saved")}
            </span>
          ) : (
            <span className="text-[11px] text-fg-muted">
              {t("roadmap.step_detail.coach_observation_needs_criterion")}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function GuideView({ guide }: { guide: VerificationGuide }) {
  const t = useT();
  return (
    <div className="mt-3 space-y-3" data-testid="verification-coach-guide">
      <p className="text-sm font-semibold leading-snug text-fg">{guide.criterionSummary}</p>
      <ol className="space-y-2">
        {guide.recommendedChecks.map((check, index) => (
          <li
            key={`${check.kind}-${check.label}-${index}`}
            className="rounded-sm border border-border/80 bg-bg/70 px-2 py-2 text-xs"
            data-testid="verification-coach-check"
            data-check-kind={check.kind}
          >
            <div className="font-semibold text-fg">{check.label}</div>
            <p className="mt-1 whitespace-pre-wrap text-fg-muted">{check.instruction}</p>
            <p className="mt-1 text-[11px] text-fg">
              <span className="font-medium">{t("roadmap.step_detail.coach_check_expected")}: </span>
              {check.expectedObservation}
            </p>
          </li>
        ))}
      </ol>
      {guide.evidencePrompts.length > 0 ? (
        <div className="rounded-sm border border-border/80 bg-bg/60 px-2 py-2 text-[11px] text-fg-muted">
          <div className="font-semibold text-fg">{t("roadmap.step_detail.coach_prompt_title")}</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {guide.evidencePrompts.map((prompt) => (
              <li key={prompt}>{prompt}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default VerificationCoachPanel;
