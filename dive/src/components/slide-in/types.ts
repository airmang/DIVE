import type { DiffPreviewData } from "../permission-card";

export type SlideInTab = "code" | "preview" | "terminal";
export type CodeEmptyReason = "no_output" | "blocked_no_output";
export type PreviewSessionStatus = "opening" | "ready" | "unavailable" | "failed";
export type RuntimeEvidenceSource = "preview" | "project_command" | "terminal_script";
export type RuntimeEvidenceStatus =
  | "ready"
  | "passed"
  | "failed"
  | "blocked"
  | "unavailable"
  | "cancelled";

export interface ChangedFile {
  path: string;
  diff: DiffPreviewData | null;
}

export interface TerminalLine {
  id: string;
  kind: "stdout" | "stderr" | "info";
  text: string;
  timestamp: number;
}

export interface PreviewSessionState {
  requestId: string;
  status: PreviewSessionStatus;
  previewUrl: string | null;
  assetFilePath?: string | null;
  targetLabel: string;
  commandSummary?: string | null;
  errorReason?: string | null;
  updatedAt: number;
}

export interface PreviewRequestContext {
  sessionId?: number | null;
  cardId?: number | null;
  source?: "student_action" | "ai_tool" | "review_action" | "reroute";
}

export interface RuntimeExecutionEvidence {
  evidenceId: string;
  source: RuntimeEvidenceSource;
  status: RuntimeEvidenceStatus;
  summary: string;
  stdoutSummary?: string | null;
  stderrSummary?: string | null;
  exitCode?: number | null;
  previewTarget?: string | null;
  recordedAt: number;
}

export interface SlideInOpenArgs {
  tab?: SlideInTab;
  files?: ChangedFile[];
  changeSummary?: string | null;
  emptyReason?: CodeEmptyReason | null;
  previewUrl?: string | null;
  previewSession?: PreviewSessionState | null;
  previewRequestContext?: PreviewRequestContext | null;
  evidence?: RuntimeExecutionEvidence[];
  replaceFiles?: boolean;
}
