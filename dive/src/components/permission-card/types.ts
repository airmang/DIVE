export type RiskLevel = "safe" | "warn" | "danger";

export interface DiffPreviewData {
  path: string;
  before: string;
  after: string;
}

export interface PermissionChangeSummary {
  headline: string;
  details: string[];
  addedLines: number;
  removedLines: number;
  fileKind: string;
  wholeFileReplacement: boolean;
}

export interface PermissionWholeFileOverwriteWarning {
  linesRemoved: number;
}

export interface PermissionApprovalWarnings {
  secretFlagged: boolean;
  secretReasons: string[];
  wholeFileOverwrite: PermissionWholeFileOverwriteWarning | null;
}

export interface PermissionCardData {
  toolCallId: string;
  toolName: string;
  paramsPreview: string;
  risk: RiskLevel;
  diffPreview: DiffPreviewData | null;
  approvalWarnings?: PermissionApprovalWarnings | null;
  args: unknown;
  actionContext?: PermissionActionContext;
}

export interface PermissionActionContext {
  readFiles?: string[];
  writeFiles?: string[];
  expectedFiles?: string[];
  diffPreviewPath?: string | null;
  checkpointAvailable?: boolean | null;
}

export interface PermissionCardProps {
  card: PermissionCardData;
  onApprove: (toolCallId: string, modifiedArgs?: unknown) => void;
  onDeny: (toolCallId: string, reason?: string) => void;
  onDiffViewed?: (toolCallId: string) => void;
  approvalRequirement?: {
    required: boolean;
    satisfied: boolean;
    message: string;
    confirmLabel?: string;
    confirmed?: boolean;
    onConfirmChange?: (confirmed: boolean) => void;
  };
}
