export type RoadmapActionKind =
  | "open_project"
  | "resume_step"
  | "start_step"
  | "start_group"
  | "complete_step";

export interface RoadmapActionFailure {
  action: RoadmapActionKind;
  projectName?: string;
  stepLabel?: string;
  message: string;
  occurredAt: number;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function makeRoadmapActionFailure(
  input: Omit<RoadmapActionFailure, "message" | "occurredAt"> & { error: unknown },
): RoadmapActionFailure {
  return {
    action: input.action,
    projectName: input.projectName,
    stepLabel: input.stepLabel,
    message: errorMessage(input.error),
    occurredAt: Date.now(),
  };
}
