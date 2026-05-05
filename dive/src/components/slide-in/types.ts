import type { DiffPreviewData } from "../permission-card";

export type SlideInTab = "code" | "preview" | "terminal";

export interface ChangedFile {
  path: string;
  diff: DiffPreviewData;
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
  previewUrl?: string | null;
  replaceFiles?: boolean;
}
