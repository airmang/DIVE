import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastContextValue } from "../toast/toast-context";
import { usePlanRoadmap } from "../../features/roadmap";
import {
  PLAN_DRAFT_REVIEW_REQUEST_EVENT,
  usePlan,
  type InterviewRow,
  type PlanGenerationResult,
} from "../../features/planning";
import {
  decodePlanDraftQualityError,
  usePlanInterviewLLM,
  type PlanDraftLlmErrorReason,
  type PlanDraftQualityIssue,
} from "../../features/planning/usePlanInterviewLLM";
import { PLAN_DRAFT_PENDING_TIMEOUT_MS } from "./productShellControllerLogic";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface PlanDraftFailure {
  reason: PlanDraftLlmErrorReason;
  unresolvedQuestions: string[];
  issues?: PlanDraftQualityIssue[];
}

export function usePlanDraftPendingController(timeoutMs: number = PLAN_DRAFT_PENDING_TIMEOUT_MS) {
  const expectingPlanDraftRef = useRef(false);
  const [planDraftPending, setPlanDraftPending] = useState(false);

  const setPlanDraftExpectation = useCallback((pending: boolean) => {
    expectingPlanDraftRef.current = pending;
    setPlanDraftPending(pending);
  }, []);

  useEffect(() => {
    if (!planDraftPending) return;
    const handle = window.setTimeout(() => {
      expectingPlanDraftRef.current = false;
      setPlanDraftPending(false);
    }, timeoutMs);
    return () => window.clearTimeout(handle);
  }, [planDraftPending, timeoutMs]);

  return {
    expectingPlanDraftRef,
    planDraftPending,
    setPlanDraftExpectation,
  };
}

/**
 * Owns the interview → plan-draft lifecycle: the active interview, the generated
 * draft, the draft-quality failure, and the `usePlanInterviewLLM` observer that
 * turns a streamed plan draft into a submitted interview + generated plan (or a
 * recovery prompt). Created before `useChatSession` because the chat hook
 * consumes `planInterviewObserver`; the shell controller keeps the chat-driven
 * action handlers (approve/revise/retry/...) that read this returned state.
 */
export function usePlanDraftLifecycle(input: {
  currentProjectId: number | null;
  plan: ReturnType<typeof usePlan>;
  planRoadmap: ReturnType<typeof usePlanRoadmap>;
  requestPlanReplaceConfirmation: () => Promise<boolean>;
  toast: ToastContextValue["toast"];
  t: Translate;
}) {
  const { currentProjectId, plan, planRoadmap, requestPlanReplaceConfirmation, toast, t } = input;
  const currentDraft = plan.currentDraft;
  const planStatus = plan.status?.status;

  const [activeInterview, setActiveInterview] = useState<InterviewRow | null>(null);
  const activeInterviewRef = useRef<InterviewRow | null>(null);
  const [generatedPlanDraft, setGeneratedPlanDraft] = useState<PlanGenerationResult | null>(null);
  const [planDraftReviewRequestNonce, setPlanDraftReviewRequestNonce] = useState(0);
  const [planDraftFailure, setPlanDraftFailure] = useState<PlanDraftFailure | null>(null);
  const { expectingPlanDraftRef, planDraftPending, setPlanDraftExpectation } =
    usePlanDraftPendingController();

  useEffect(() => {
    activeInterviewRef.current = activeInterview;
  }, [activeInterview]);

  useEffect(() => {
    if (generatedPlanDraft && generatedPlanDraft.plan.project_id !== currentProjectId) {
      setGeneratedPlanDraft(null);
    }
  }, [currentProjectId, generatedPlanDraft]);

  useEffect(() => {
    const handler = (event: Event) => {
      const requestedProjectId = (event as CustomEvent<{ projectId?: number }>).detail?.projectId;
      if (typeof requestedProjectId === "number" && requestedProjectId !== currentProjectId) {
        return;
      }
      setPlanDraftReviewRequestNonce((nonce) => nonce + 1);
    };
    window.addEventListener(PLAN_DRAFT_REVIEW_REQUEST_EVENT, handler);
    return () => window.removeEventListener(PLAN_DRAFT_REVIEW_REQUEST_EVENT, handler);
  }, [currentProjectId]);

  useEffect(() => {
    if (currentProjectId === null || generatedPlanDraft !== null || planStatus !== "draft") {
      return;
    }
    let cancelled = false;
    void currentDraft()
      .then((draft) => {
        if (!cancelled && draft) {
          setGeneratedPlanDraft(draft);
        }
      })
      .catch((err) => {
        console.warn("load current plan draft failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [currentDraft, currentProjectId, generatedPlanDraft, planDraftReviewRequestNonce, planStatus]);

  const planInterviewObserver = usePlanInterviewLLM({
    onPlanDraft: (draft) => {
      const interview = activeInterviewRef.current;
      if (!interview) {
        setPlanDraftExpectation(false);
        return;
      }
      setPlanDraftFailure(null);
      void (async () => {
        try {
          const submitted =
            interview.status === "draft"
              ? await plan.submitInterview(
                  interview.id,
                  draft.intentSummary,
                  draft.unresolvedQuestions,
                )
              : interview;
          setActiveInterview({
            ...submitted,
            intent_summary: draft.intentSummary,
            unresolved_questions: draft.unresolvedQuestions,
          });
          // A project already carrying an APPROVED plan would make plan
          // generation hard-fail in the backend ("already has approved plan").
          // We know this up front via plan.status, so confirm a deliberate
          // replacement (discards the approved plan + its steps) before
          // generating, instead of dead-ending the student on a raw error.
          let replaceApproved = false;
          if (plan.status?.has_approved_plan) {
            replaceApproved = await requestPlanReplaceConfirmation();
            if (!replaceApproved) {
              toast({
                variant: "info",
                title: t("planning.replace.kept_title"),
                description: t("planning.replace.kept_description"),
              });
              return;
            }
          }
          const generated = await plan.generateDraft(
            interview.id,
            draft.planInput,
            replaceApproved,
          );
          setGeneratedPlanDraft(generated);
          await planRoadmap.refresh();
          toast({
            variant: "success",
            title: t("planning.interview.draft_ready_title"),
            description: t("planning.interview.draft_ready_description"),
          });
        } catch (err) {
          const qualityError = decodePlanDraftQualityError(err);
          if (qualityError) {
            const unresolvedQuestions = qualityError.unresolvedQuestions ?? [];
            setPlanDraftFailure({
              reason: qualityError.reason,
              unresolvedQuestions,
              issues: qualityError.issues,
            });
            setActiveInterview((current) =>
              current
                ? {
                    ...current,
                    unresolved_questions: unresolvedQuestions,
                  }
                : current,
            );
            toast({
              variant: "warn",
              title: t(`planning.interview.recovery.${qualityError.reason}.title`),
              description: t(`planning.interview.recovery.${qualityError.reason}.description`),
            });
            return;
          }
          toast({
            variant: "error",
            title: t("planning.interview.draft_failed_title"),
            description: err instanceof Error ? err.message : String(err),
          });
        } finally {
          setPlanDraftExpectation(false);
        }
      })();
    },
    onPlanDraftError: (error) => {
      if (!expectingPlanDraftRef.current) return;
      if (!activeInterviewRef.current) {
        setPlanDraftExpectation(false);
        return;
      }
      setPlanDraftExpectation(false);
      setPlanDraftFailure({
        reason: error.reason,
        unresolvedQuestions: error.unresolvedQuestions ?? [],
        issues: error.issues,
      });
      setActiveInterview((current) =>
        current
          ? {
              ...current,
              unresolved_questions: error.unresolvedQuestions ?? [],
            }
          : current,
      );
      toast({
        variant: "warn",
        title: t(`planning.interview.recovery.${error.reason}.title`),
        description: t(`planning.interview.recovery.${error.reason}.description`),
      });
    },
  });

  return {
    activeInterview,
    setActiveInterview,
    activeInterviewRef,
    generatedPlanDraft,
    setGeneratedPlanDraft,
    planDraftFailure,
    setPlanDraftFailure,
    planDraftPending,
    setPlanDraftExpectation,
    planInterviewObserver,
  };
}
