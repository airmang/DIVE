import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastContextValue } from "../toast/toast-context";
import {
  requestPlanAddStepDraft,
  usePlan,
  usePlanRouter,
  type RouteDecision,
} from "../../features/planning";
import { usePlanRoadmap } from "../../features/roadmap";
import { requestProjectRailTab } from "./ProjectRail";
import type { ConfirmableRouteDecision } from "./PlanRouteConfirmModal";

type Translate = (key: string, values?: Record<string, string | number>) => string;

interface PendingPlanRouteConfirmation {
  decision: ConfirmableRouteDecision;
  resolve: (approved: boolean) => void;
}

interface PendingPlanReplaceConfirmation {
  resolve: (confirmed: boolean) => void;
}

/**
 * Owns the confirm-before-apply flow for chat messages that the plan router
 * interprets as plan edits (S-037): `handleBeforeChatSend` routes the message,
 * opens the route/replace confirmation modals, and applies remove/supersede/
 * multi_step edits. Extracted from `useProductShellController` unchanged — it is
 * created before `useChatSession` because the chat hook consumes
 * `handleBeforeChatSend` as its pre-send gate.
 */
export function usePlanChatRouting(input: {
  currentProjectId: number | null;
  plan: ReturnType<typeof usePlan>;
  planRoadmap: ReturnType<typeof usePlanRoadmap>;
  planRouter: ReturnType<typeof usePlanRouter>;
  toast: ToastContextValue["toast"];
  t: Translate;
}) {
  const { currentProjectId, plan, planRoadmap, planRouter, toast, t } = input;
  const [pendingPlanRoute, setPendingPlanRoute] = useState<PendingPlanRouteConfirmation | null>(
    null,
  );
  const pendingPlanRouteRef = useRef<PendingPlanRouteConfirmation | null>(null);
  const [pendingPlanReplace, setPendingPlanReplace] =
    useState<PendingPlanReplaceConfirmation | null>(null);
  const pendingPlanReplaceRef = useRef<PendingPlanReplaceConfirmation | null>(null);

  useEffect(() => {
    pendingPlanRouteRef.current = pendingPlanRoute;
  }, [pendingPlanRoute]);

  useEffect(
    () => () => {
      pendingPlanRouteRef.current?.resolve(false);
    },
    [],
  );

  const requestPlanRouteConfirmation = useCallback(
    (decision: ConfirmableRouteDecision) =>
      new Promise<boolean>((resolve) => {
        setPendingPlanRoute({ decision, resolve });
      }),
    [],
  );

  const settlePlanRouteConfirmation = useCallback((approved: boolean) => {
    const pending = pendingPlanRouteRef.current;
    if (!pending) return;
    pending.resolve(approved);
    pendingPlanRouteRef.current = null;
    setPendingPlanRoute(null);
  }, []);

  useEffect(() => {
    pendingPlanReplaceRef.current = pendingPlanReplace;
  }, [pendingPlanReplace]);
  useEffect(
    () => () => {
      pendingPlanReplaceRef.current?.resolve(false);
    },
    [],
  );
  const requestPlanReplaceConfirmation = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        setPendingPlanReplace({ resolve });
      }),
    [],
  );
  const settlePlanReplaceConfirmation = useCallback((confirmed: boolean) => {
    const pending = pendingPlanReplaceRef.current;
    if (!pending) return;
    pending.resolve(confirmed);
    pendingPlanReplaceRef.current = null;
    setPendingPlanReplace(null);
  }, []);

  const handleBeforeChatSend = useCallback(
    async ({
      text,
      runMode,
    }: {
      text: string;
      runMode?: "interview" | "plan" | "build" | "verify";
    }) => {
      if (runMode === "interview") return true;
      const approvedPlanId = planRoadmap.status?.has_approved_plan
        ? planRoadmap.status.plan_id
        : plan.status?.has_approved_plan
          ? plan.status.plan_id
          : null;
      if (approvedPlanId === null || currentProjectId === null) return true;

      let decision: RouteDecision;
      try {
        decision = await planRouter.route(text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.toLowerCase().includes("cancel")) return false;
        toast({
          variant: "error",
          title: t("planning.route.error.routing_failed", {
            message,
          }),
        });
        return true;
      }

      // add_step routes to the dashboard add-step area; remove/supersede apply
      // chat / skip stay normal chat; every confirmable outcome opens the modal.
      // add_step routes to the dashboard add-step area; remove / supersede /
      // multi_step apply from the modal; duplicate / clarify are informational.
      if (decision.action === "chat" || decision.action === "skip") {
        return true;
      }

      const approved = await requestPlanRouteConfirmation(decision);

      if (decision.action === "duplicate" || decision.action === "clarify") {
        // Informational: the modal was the response — duplicate shows the
        // collision, clarify asks a question the user answers in chat (which
        // routes again). Don't re-send the original message.
        return false;
      }

      if (decision.action === "add_step") {
        // "Just chat" keeps the original message as a normal chat turn.
        if (!approved) return true;
        requestProjectRailTab("dashboard");
        requestPlanAddStepDraft({
          projectId: currentProjectId,
          planId: approvedPlanId,
          draft: decision.draft,
          reason: decision.reason,
          source: "chat_route",
        });
        toast({
          variant: "info",
          title: t("planning.route.confirm.dedicated_area_title"),
          description: t("planning.route.confirm.dedicated_area_description"),
        });
        return false;
      }

      // remove_step / supersede_step / multi_step apply directly from the modal;
      // "Cancel" dismisses without re-sending the request to chat.
      if (!approved) return false;
      try {
        if (decision.action === "remove_step") {
          const stepLabel = `${decision.target.stepId}: ${decision.target.title}`;
          await planRouter.removeStep(approvedPlanId, decision.target.dbId, decision.reason);
          toast({
            variant: "success",
            title: t("planning.route.confirm.removed_toast", { step: stepLabel }),
          });
        } else if (decision.action === "supersede_step") {
          const stepLabel = `${decision.target.stepId}: ${decision.target.title}`;
          await planRouter.supersedeStep(
            approvedPlanId,
            decision.target.dbId,
            decision.replacement,
            decision.reason,
          );
          toast({
            variant: "success",
            title: t("planning.route.confirm.superseded_toast", { step: stepLabel }),
          });
        } else {
          // multi_step: insert the whole dependency-ordered batch in one IPC.
          await planRouter.appendSteps(approvedPlanId, decision.drafts, {
            mutationReason: decision.reason,
          });
          toast({
            variant: "success",
            title: t("planning.route.confirm.added_steps_toast", {
              count: decision.drafts.length,
            }),
          });
        }
        await planRoadmap.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast({
          variant: "error",
          title: t("planning.route.confirm.apply_failed", { message }),
        });
      }
      return false;
    },
    [currentProjectId, plan, planRoadmap, planRouter, requestPlanRouteConfirmation, t, toast],
  );

  return {
    handleBeforeChatSend,
    pendingPlanRoute,
    settlePlanRouteConfirmation,
    requestPlanReplaceConfirmation,
    pendingPlanReplace,
    settlePlanReplaceConfirmation,
  };
}
