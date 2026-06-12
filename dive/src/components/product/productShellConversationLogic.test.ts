import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../chat/types";
import {
  deriveComposerHint,
  deriveEmptyState,
  deriveGetStartedModel,
  deriveInputBlocked,
  deriveStageBanner,
  findLatestInterviewQuestion,
  shouldShowInterviewPanel,
} from "./productShellConversationLogic";

const t = (key: string) => key;

describe("product shell conversation logic", () => {
  it("derives stage banners for empty, selected, and complete card states", () => {
    expect(
      deriveStageBanner({ cardCount: 0, currentCard: null, allVerified: false, t }),
    ).toBeNull();
    expect(deriveStageBanner({ cardCount: 2, currentCard: null, allVerified: true, t })).toEqual({
      tone: "success",
      message: "stage.banner_all_verified",
    });
    expect(
      deriveStageBanner({
        cardCount: 1,
        currentCard: { state: "instructed", summary: " " },
        allVerified: false,
        t,
      }),
    ).toEqual({ tone: "warn", message: "stage.banner_instructed_empty" });
  });

  it("derives input blockers in the same priority as the controller", () => {
    const noop = vi.fn();
    expect(
      deriveInputBlocked({
        isDemoRoute: false,
        currentProjectId: null,
        currentSessionId: null,
        hasConnectedProvider: false,
        onEmptyStateAction: noop,
        onOpenSettings: noop,
        t,
      })?.actionLabel,
    ).toBe("sidebar.new_project");
    expect(
      deriveInputBlocked({
        isDemoRoute: false,
        currentProjectId: 1,
        currentSessionId: null,
        hasConnectedProvider: false,
        onEmptyStateAction: noop,
        onOpenSettings: noop,
        t,
      })?.actionLabel,
    ).toBe("stage.action_open_settings");
  });

  it("derives composer hints and empty states", () => {
    const noop = vi.fn();
    expect(
      deriveComposerHint({
        currentCard: { state: "instructed", summary: null },
        onWriteInstruction: noop,
        t,
      })?.message,
    ).toBe("stage.hint_no_instruction");
    expect(
      deriveEmptyState({
        currentProjectId: 1,
        currentSessionId: null,
        onEmptyStateAction: noop,
        t,
      })?.title,
    ).toBe("chat.empty_no_session_title");
  });

  it("derives get-started step statuses", () => {
    const model = deriveGetStartedModel({
      isDemoRoute: false,
      projectSessionLoaded: true,
      currentProjectId: 1,
      hasConnectedProvider: false,
      currentSessionId: null,
      currentProjectName: "DIVE",
      providerDoneHint: null,
      onProjectAction: vi.fn(),
      onProviderAction: vi.fn(),
      onSessionAction: vi.fn(),
      t,
    });
    expect(model?.steps.map((step) => [step.key, step.status])).toEqual([
      ["project", "done"],
      ["provider", "current"],
      ["session", "pending"],
    ]);
  });

  it("finds latest assistant interview question with fallback", () => {
    const messages: ChatMessage[] = [
      { id: "u", kind: "user", createdAt: 1, content: "answer" },
      { id: "a1", kind: "assistant", createdAt: 2, content: " ", streaming: false },
      { id: "a2", kind: "assistant", createdAt: 3, content: "Next question?", streaming: false },
    ];
    expect(findLatestInterviewQuestion(messages, "fallback")).toBe("Next question?");
    expect(findLatestInterviewQuestion([], "fallback")).toBe("fallback");
  });

  it("shows interview panel only for active pre-approval plan states", () => {
    expect(
      shouldShowInterviewPanel({
        isDemoRoute: false,
        currentProjectId: 1,
        generatedPlanDraftPresent: false,
        planStatus: {
          status: "needs_interview",
          has_plan: true,
          has_approved_plan: false,
          plan_summary: null,
          plan_id: 1,
          step_count: 0,
          ready_count: 0,
          blocked_count: 0,
          active_count: 0,
          done_count: 0,
        },
      }),
    ).toBe(true);
    expect(
      shouldShowInterviewPanel({
        isDemoRoute: false,
        currentProjectId: 1,
        generatedPlanDraftPresent: false,
        planStatus: {
          status: "approved",
          has_plan: true,
          has_approved_plan: true,
          plan_summary: null,
          plan_id: 1,
          step_count: 0,
          ready_count: 0,
          blocked_count: 0,
          active_count: 0,
          done_count: 0,
        },
      }),
    ).toBe(false);
  });
});
