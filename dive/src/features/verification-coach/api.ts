import type {
  ObservationEvidenceInput,
  ObservationEvidenceRecord,
  VerificationCoachGenerateRequest,
  VerificationCoachGenerateResponse,
} from "./types";

type TauriApi = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
};

async function loadTauri(): Promise<TauriApi | null> {
  const w =
    typeof window === "undefined" ? null : (window as unknown as { __TAURI_INTERNALS__?: unknown });
  if (!w?.__TAURI_INTERNALS__) return null;
  const core = await import("@tauri-apps/api/core");
  return { invoke: core.invoke as TauriApi["invoke"] };
}

export async function generateVerificationCoachGuide(
  request: VerificationCoachGenerateRequest,
): Promise<VerificationCoachGenerateResponse> {
  const api = await loadTauri();
  if (!api) {
    return {
      status: "unavailable",
      eventId: `frontend-unavailable-${Date.now()}`,
      guideVersion: request.guideVersion ?? 1,
      dropReason: "runtime_unavailable",
      message: "Verification guidance is unavailable outside the DIVE runtime.",
    };
  }
  return api.invoke<VerificationCoachGenerateResponse>("verification_coach_generate", {
    request,
  });
}

export async function recordVerificationObservation(
  observation: ObservationEvidenceInput,
): Promise<ObservationEvidenceRecord> {
  const api = await loadTauri();
  const recordedAt = Date.now();
  if (!api) {
    return {
      ...observation,
      observationId: `frontend-observation-${recordedAt}`,
      recordedAt,
    };
  }
  return api.invoke<ObservationEvidenceRecord>("verification_observation_record", {
    observation,
  });
}
