import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../chat/types";
import {
  checkpointToRecoveryItem,
  compactFailureReason,
  deriveFailureReason,
  latestToolFailureSummary,
} from "./productShellRecoveryLogic";

describe("product shell recovery logic", () => {
  it("maps checkpoint rows to recovery items without inventing changed files", () => {
    expect(
      checkpointToRecoveryItem({
        id: 1,
        session_id: 2,
        card_id: null,
        git_sha: "abc",
        kind: "manual",
        label: "Before risky edit",
        created_at: 3,
      }),
    ).toEqual({
      id: 1,
      label: "Before risky edit",
      kind: "manual",
      createdAt: 3,
      changedFiles: [],
    });
  });

  it("compacts long failure reasons to the controller limit", () => {
    const compacted = compactFailureReason(`  ${"x".repeat(230)}  `);
    expect(compacted).toHaveLength(220);
    expect(compacted.endsWith("...")).toBe(true);
  });

  it("prioritizes verify errors, failed verify logs, rejected cards, then tool failures", () => {
    const fallback = (result: "pass" | "fail" | "skipped") => `verify:${result}`;
    expect(
      deriveFailureReason({
        currentVerifyError: "model unavailable",
        currentVerifyLog: null,
        currentCardState: "rejected",
        latestToolFailureSummary: "tool failed",
        rejectedReason: "card rejected",
        verifyDidNotPassFallback: fallback,
      }),
    ).toBe("model unavailable");
    expect(
      deriveFailureReason({
        currentVerifyError: null,
        currentVerifyLog: {
          intent_match: true,
          test_result: "fail",
          details: "",
          model: "mock",
          ran_at: 1,
        },
        currentCardState: "rejected",
        latestToolFailureSummary: "tool failed",
        rejectedReason: "card rejected",
        verifyDidNotPassFallback: fallback,
      }),
    ).toBe("verify:fail");
    expect(
      deriveFailureReason({
        currentVerifyError: null,
        currentVerifyLog: null,
        currentCardState: "rejected",
        latestToolFailureSummary: "tool failed",
        rejectedReason: "card rejected",
        verifyDidNotPassFallback: fallback,
      }),
    ).toBe("card rejected");
  });

  it("finds the most recent failed tool result", () => {
    const messages: ChatMessage[] = [
      {
        id: "a",
        kind: "tool_result",
        createdAt: 1,
        toolName: "run",
        success: false,
        summary: "old",
      },
      { id: "b", kind: "tool_result", createdAt: 2, toolName: "run", success: true, summary: "ok" },
      {
        id: "c",
        kind: "tool_result",
        createdAt: 3,
        toolName: "run",
        success: false,
        summary: "new",
      },
    ];
    expect(latestToolFailureSummary(messages)).toBe("new");
  });
});
