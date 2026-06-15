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
    const noop = vi.fn();
    expect(
      deriveStageBanner({
        cardCount: 0,
        currentCard: null,
        allVerified: false,
        onOpenResultPanel: noop,
        t,
      }),
    ).toBeNull();
    expect(
      deriveStageBanner({
        cardCount: 2,
        currentCard: null,
        allVerified: true,
        onOpenResultPanel: noop,
        t,
      }),
    ).toEqual({
      tone: "success",
      message: "stage.banner_all_verified",
      actionLabel: "chat.result_label",
      onAction: noop,
    });
    expect(
      deriveStageBanner({
        cardCount: 1,
        currentCard: { state: "instructed", summary: " " },
        allVerified: false,
        onOpenResultPanel: noop,
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

  it("offers an explicit review action while a card is waiting for verification judgment", () => {
    const openResult = vi.fn();
    const openReview = vi.fn();
    expect(
      deriveStageBanner({
        cardCount: 1,
        currentCard: { state: "verifying", summary: "Implement todo input" },
        allVerified: false,
        onOpenResultPanel: openResult,
        onOpenReviewPanel: openReview,
        t,
      }),
    ).toEqual({
      tone: "info",
      message: "stage.banner_verifying",
      actionLabel: "stage.action_open_review",
      onAction: openReview,
    });
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
      onPrdAction: vi.fn(),
      onPlanAction: vi.fn(),
      onSessionAction: vi.fn(),
      prdStatus: "missing",
      hasPlan: false,
      hasApprovedPlan: false,
      t,
    });
    expect(model?.steps.map((step) => [step.key, step.status])).toEqual([
      ["project", "done"],
      ["provider", "current"],
      ["prd", "pending"],
      ["plan", "pending"],
    ]);
  });

  it("routes provider-complete onboarding into PRD authoring before plan or session", () => {
    const model = deriveGetStartedModel({
      isDemoRoute: false,
      projectSessionLoaded: true,
      currentProjectId: 1,
      hasConnectedProvider: true,
      currentSessionId: null,
      currentProjectName: "DIVE",
      providerDoneHint: "OpenAI",
      onProjectAction: vi.fn(),
      onProviderAction: vi.fn(),
      onPrdAction: vi.fn(),
      onPlanAction: vi.fn(),
      onSessionAction: vi.fn(),
      prdStatus: "missing",
      hasPlan: false,
      hasApprovedPlan: false,
      t,
    });

    expect(model?.steps.map((step) => [step.key, step.status])).toEqual([
      ["project", "done"],
      ["provider", "done"],
      ["prd", "current"],
      ["plan", "pending"],
    ]);
    expect(model?.steps.find((step) => step.key === "prd")?.actionLabel).toBe(
      "get_started.prd_action",
    );
  });

  it("resumes a PRD draft instead of opening ordinary chat", () => {
    const onPrdAction = vi.fn();
    const model = deriveGetStartedModel({
      isDemoRoute: false,
      projectSessionLoaded: true,
      currentProjectId: 1,
      hasConnectedProvider: true,
      currentSessionId: null,
      currentProjectName: "DIVE",
      providerDoneHint: "OpenAI",
      onProjectAction: vi.fn(),
      onProviderAction: vi.fn(),
      onPrdAction,
      onPlanAction: vi.fn(),
      onSessionAction: vi.fn(),
      prdStatus: "draft",
      hasPlan: false,
      hasApprovedPlan: false,
      t,
    });

    const prd = model?.steps.find((step) => step.key === "prd");
    expect(prd?.status).toBe("current");
    expect(prd?.actionLabel).toBe("get_started.prd_resume_action");
    prd?.onAction?.();
    expect(onPrdAction).toHaveBeenCalledTimes(1);
  });

  it("routes saved minimal PRDs to plan creation before session start", () => {
    const model = deriveGetStartedModel({
      isDemoRoute: false,
      projectSessionLoaded: true,
      currentProjectId: 1,
      hasConnectedProvider: true,
      currentSessionId: null,
      currentProjectName: "DIVE",
      providerDoneHint: "OpenAI",
      onProjectAction: vi.fn(),
      onProviderAction: vi.fn(),
      onPrdAction: vi.fn(),
      onPlanAction: vi.fn(),
      onSessionAction: vi.fn(),
      prdStatus: "minimal",
      hasPlan: false,
      hasApprovedPlan: false,
      t,
    });

    expect(model?.steps.map((step) => [step.key, step.status])).toEqual([
      ["project", "done"],
      ["provider", "done"],
      ["prd", "done"],
      ["plan", "current"],
    ]);
  });

  it("does not show onboarding once an approved plan and session are available", () => {
    const model = deriveGetStartedModel({
      isDemoRoute: false,
      projectSessionLoaded: true,
      currentProjectId: 1,
      hasConnectedProvider: true,
      currentSessionId: 99,
      currentProjectName: "DIVE",
      providerDoneHint: "OpenAI",
      onProjectAction: vi.fn(),
      onProviderAction: vi.fn(),
      onPrdAction: vi.fn(),
      onPlanAction: vi.fn(),
      onSessionAction: vi.fn(),
      prdStatus: "minimal",
      hasPlan: true,
      hasApprovedPlan: true,
      t,
    });

    expect(model).toBeNull();
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
