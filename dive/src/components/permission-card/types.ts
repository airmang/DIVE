export type RiskLevel = "safe" | "warn" | "danger";

export interface DiffPreviewData {
  path: string;
  before: string;
  after: string;
}

export interface PermissionCardData {
  toolCallId: string;
  toolName: string;
  paramsPreview: string;
  risk: RiskLevel;
  diffPreview: DiffPreviewData | null;
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
  approvalRequirement?: {
    required: boolean;
    satisfied: boolean;
    message: string;
  };
}
