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
}

export interface PermissionCardProps {
  card: PermissionCardData;
  onApprove: (toolCallId: string, modifiedArgs?: unknown) => void;
  onDeny: (toolCallId: string, reason?: string) => void;
}
