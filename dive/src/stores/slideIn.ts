import { create } from "zustand";
import type {
  ChangedFile,
  CodeEmptyReason,
  PreviewSessionState,
  PreviewRequestContext,
  RuntimeExecutionEvidence,
  SlideInOpenArgs,
  SlideInTab,
  TerminalLine,
} from "../components/slide-in/types";

const MAX_TERMINAL_LINES = 1000;
const MAX_RUNTIME_EVIDENCE = 200;

interface SlideInState {
  isOpen: boolean;
  activeTab: SlideInTab;
  changedFiles: ChangedFile[];
  changeSummary: string | null;
  emptyReason: CodeEmptyReason | null;
  selectedFilePath: string | null;
  previewUrl: string | null;
  previewSession: PreviewSessionState | null;
  previewRequestContext: PreviewRequestContext | null;
  runtimeEvidence: RuntimeExecutionEvidence[];
  terminalLines: TerminalLine[];
  open: (args?: SlideInOpenArgs) => void;
  close: () => void;
  setActiveTab: (tab: SlideInTab) => void;
  setSelectedFile: (path: string | null) => void;
  setPreviewUrl: (url: string | null) => void;
  setPreviewSession: (session: PreviewSessionState | null) => void;
  setPreviewRequestContext: (context: PreviewRequestContext | null) => void;
  appendRuntimeEvidence: (evidence: RuntimeExecutionEvidence) => void;
  pushTerminalLine: (line: Omit<TerminalLine, "id" | "timestamp">) => void;
  clearTerminal: () => void;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useSlideInStore = create<SlideInState>((set) => ({
  isOpen: false,
  activeTab: "code",
  changedFiles: [],
  changeSummary: null,
  emptyReason: null,
  selectedFilePath: null,
  previewUrl: null,
  previewSession: null,
  previewRequestContext: null,
  runtimeEvidence: [],
  terminalLines: [],
  open: (args) =>
    set((prev) => {
      const files = args?.replaceFiles
        ? (args.files ?? [])
        : args?.files
          ? [...prev.changedFiles, ...args.files]
          : prev.changedFiles;
      const firstPath = files[0]?.path ?? null;
      return {
        isOpen: true,
        activeTab: args?.tab ?? prev.activeTab,
        changedFiles: files,
        changeSummary:
          args?.changeSummary !== undefined
            ? args.changeSummary
            : args?.replaceFiles
              ? null
              : prev.changeSummary,
        emptyReason:
          args?.emptyReason !== undefined
            ? args.emptyReason
            : args?.replaceFiles
              ? null
              : prev.emptyReason,
        selectedFilePath:
          prev.selectedFilePath && files.some((f) => f.path === prev.selectedFilePath)
            ? prev.selectedFilePath
            : firstPath,
        previewUrl:
          args?.previewUrl !== undefined
            ? args.previewUrl
            : args?.previewSession !== undefined
              ? (args.previewSession?.previewUrl ?? null)
              : prev.previewUrl,
        previewSession:
          args?.previewSession !== undefined ? args.previewSession : prev.previewSession,
        previewRequestContext:
          args?.previewRequestContext !== undefined
            ? args.previewRequestContext
            : prev.previewRequestContext,
        runtimeEvidence: args?.evidence
          ? [...prev.runtimeEvidence, ...args.evidence].slice(-MAX_RUNTIME_EVIDENCE)
          : prev.runtimeEvidence,
      };
    }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedFile: (path) => set({ selectedFilePath: path }),
  setPreviewUrl: (url) => set({ previewUrl: url }),
  setPreviewSession: (session) =>
    set({
      previewSession: session ? { ...session, kind: session.kind } : null,
      previewUrl: session?.previewUrl ?? null,
    }),
  setPreviewRequestContext: (context) => set({ previewRequestContext: context }),
  appendRuntimeEvidence: (evidence) =>
    set((prev) => ({
      runtimeEvidence: [...prev.runtimeEvidence, evidence].slice(-MAX_RUNTIME_EVIDENCE),
    })),
  pushTerminalLine: ({ kind, text }) =>
    set((prev) => {
      const next: TerminalLine = {
        id: uid(),
        kind,
        text,
        timestamp: Date.now(),
      };
      const all = [...prev.terminalLines, next];
      return {
        terminalLines:
          all.length > MAX_TERMINAL_LINES ? all.slice(all.length - MAX_TERMINAL_LINES) : all,
      };
    }),
  clearTerminal: () => set({ terminalLines: [] }),
}));
