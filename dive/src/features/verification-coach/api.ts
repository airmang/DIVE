import type {
  ObservationEvidenceInput,
  ObservationEvidenceRecord,
  VerificationCoachGenerateRequest,
  VerificationCoachGenerateResponse,
} from "./types";
import { loadTauri } from "../../lib/tauri";

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
