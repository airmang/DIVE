import { MessageCircle, Plus } from "lucide-react";
import type { RouteDecision } from "../../features/planning";
import type { PlanRoadmapStep } from "../../features/roadmap";
import { useT } from "../../i18n";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type AddStepDecision = Extract<RouteDecision, { action: "add_step" }>;

interface PlanRouteConfirmModalProps {
  open: boolean;
  decision: AddStepDecision | null;
  steps: PlanRoadmapStep[];
  onApprove: () => void;
  onReject: () => void;
}

export function PlanRouteConfirmModal({
  open,
  decision,
  steps,
  onApprove,
  onReject,
}: PlanRouteConfirmModalProps) {
  const t = useT();
  const draft = decision?.draft ?? null;
  const dependencyText = draft
    ? formatDependencies(draft.dependencies, steps, t("planning.route.confirm.no_dependencies"))
    : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onReject();
      }}
    >
      <DialogContent data-testid="plan-route-confirm" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("planning.route.confirm.title")}</DialogTitle>
          <DialogDescription>{t("planning.route.confirm.description")}</DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="flex flex-col gap-4">
            <section className="rounded-md border bg-bg-panel2 p-4">
              <p className="text-xs font-semibold uppercase text-fg-muted">
                {t("planning.route.confirm.suggested_title")}
              </p>
              <h2 className="mt-1 text-base font-semibold text-fg">{draft.title}</h2>
              <p className="mt-2 text-sm text-fg-muted">{draft.summary}</p>
            </section>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-fg-muted">
                  {t("planning.route.confirm.dependencies_label")}
                </p>
                <p className="mt-1 text-fg">{dependencyText}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-fg-muted">
                  {t("planning.route.confirm.parallel_group_label")}
                </p>
                <p className="mt-1 text-fg">
                  {draft.parallelGroup ?? t("planning.route.confirm.none")}
                </p>
              </div>
            </div>

            {draft.acceptanceCriteria.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-fg-muted">
                  {t("planning.route.confirm.acceptance_label")}
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-fg">
                  {draft.acceptanceCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {decision?.reason ? (
              <div>
                <p className="text-xs font-medium text-fg-muted">
                  {t("planning.route.confirm.reason_label")}
                </p>
                <p className="mt-1 text-sm text-fg-muted">{decision.reason}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onReject} data-testid="plan-route-skip">
            <MessageCircle className="h-4 w-4" />
            {t("planning.route.confirm.skip_button")}
          </Button>
          <Button onClick={onApprove} data-testid="plan-route-approve">
            <Plus className="h-4 w-4" />
            {t("planning.route.confirm.add_button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDependencies(
  dependencies: string[],
  steps: PlanRoadmapStep[],
  emptyLabel: string,
): string {
  if (dependencies.length === 0) return emptyLabel;
  return dependencies
    .map((dependency) => {
      const match = steps.find((item) => item.step.step_id === dependency);
      return match ? `${dependency} (${match.step.title})` : dependency;
    })
    .join(", ");
}
