import type { ChatMessage } from "../chat/types";
import type { VerifyLogView } from "../workmap/types";
import type { RecoveryCheckpointItem } from "./RecoveryPanel";
import type { CheckpointRowPayload } from "../../hooks/useChatSession";

export function checkpointToRecoveryItem(row: CheckpointRowPayload): RecoveryCheckpointItem {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    createdAt: row.created_at,
    changedFiles: row.changed_files ?? [],
  };
}

export function compactFailureReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length <= 220) return trimmed;
  return `${trimmed.slice(0, 217)}...`;
}

export function latestToolFailureSummary(messages: ChatMessage[]): string | null {
  const failure = [...messages]
    .reverse()
    .find((message) => message.kind === "tool_result" && !message.success);
  return failure?.kind === "tool_result" ? failure.summary : null;
}

export function deriveFailureReason(input: {
  currentVerifyError: string | null;
  currentVerifyLog: VerifyLogView | null;
  currentCardState: string | null | undefined;
  latestToolFailureSummary: string | null;
  rejectedReason: string;
  verifyDidNotPassFallback: (result: VerifyLogView["test_result"]) => string;
}): string | null {
  const verifyFailureReason =
    input.currentVerifyError ??
    (input.currentVerifyLog &&
    !(input.currentVerifyLog.intent_match && input.currentVerifyLog.test_result === "pass")
      ? input.currentVerifyLog.details ||
        input.verifyDidNotPassFallback(input.currentVerifyLog.test_result)
      : null);
  const rejectedReason = input.currentCardState === "rejected" ? input.rejectedReason : null;
  return verifyFailureReason ?? rejectedReason ?? input.latestToolFailureSummary;
}
