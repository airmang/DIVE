import type { DiffPreviewData } from "../permission-card";

export type SlideInTab = "code" | "preview" | "terminal";
export type CodeEmptyReason = "no_output" | "blocked_no_output";

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

export interface SlideInOpenArgs {
  tab?: SlideInTab;
  files?: ChangedFile[];
  changeSummary?: string | null;
  emptyReason?: CodeEmptyReason | null;
  previewUrl?: string | null;
  replaceFiles?: boolean;
}
