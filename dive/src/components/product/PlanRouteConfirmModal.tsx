import { ClipboardList, ListPlus, MessageCircle, Repeat, Trash2 } from "lucide-react";
import type {
  AcceptanceCriterionInput,
  MultiStepDraftInput,
  RouteDecision,
  StepDraftInput,
  StepRefPayload,
} from "../../features/planning";
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

// S-033 P8b: the confirm modal surfaces every reviewable router outcome. Apply
// happens from here (remove/supersede/multi_step) or routes to the add-step area
// (add_step); duplicate and clarify are informational (dismiss-only).
export type ConfirmableRouteDecision = Extract<
  RouteDecision,
  {
    action: "add_step" | "remove_step" | "supersede_step" | "duplicate" | "clarify" | "multi_step";
  }
>;

// duplicate and clarify present information; they have no apply action.
function isInfoOnly(action: ConfirmableRouteDecision["action"]): boolean {
  return action === "duplicate" || action === "clarify";
}

type Translate = ReturnType<typeof useT>;

interface PlanRouteConfirmModalProps {
  open: boolean;
  decision: ConfirmableRouteDecision | null;
  steps: PlanRoadmapStep[];
  busy?: boolean;
  onApprove: () => void;
  onReject: () => void;
}

export function PlanRouteConfirmModal({
  open,
  decision,
  steps,
  busy = false,
  onApprove,
  onReject,
}: PlanRouteConfirmModalProps) {
  const t = useT();

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onReject();
      }}
    >
      <DialogContent data-testid="plan-route-confirm" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{headerTitle(decision, t)}</DialogTitle>
          <DialogDescription>{headerDescription(decision, t)}</DialogDescription>
        </DialogHeader>

        {decision ? (
          <div className="flex flex-col gap-4" data-testid={`plan-route-body-${decision.action}`}>
            <RouteDecisionBody decision={decision} steps={steps} t={t} />
            {decision.reason ? (
              <div>
                <p className="text-xs font-medium text-fg-muted">
                  {t("planning.route.confirm.reason_label")}
                </p>
                <p className="mt-1 text-sm text-fg-muted">{decision.reason}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <RouteDecisionFooter
          decision={decision}
          busy={busy}
          onApprove={onApprove}
          onReject={onReject}
          t={t}
        />
      </DialogContent>
    </Dialog>
  );
}

function RouteDecisionBody({
  decision,
  steps,
  t,
}: {
  decision: ConfirmableRouteDecision;
  steps: PlanRoadmapStep[];
  t: Translate;
}) {
  switch (decision.action) {
    case "add_step":
      return <DraftCard draft={decision.draft} steps={steps} t={t} />;
    case "remove_step":
      return (
        <StepRefCard
          target={decision.target}
          label={t("planning.route.confirm.current_step_label")}
        />
      );
    case "supersede_step":
      return (
        <div className="flex flex-col gap-3">
          <StepRefCard
            target={decision.target}
            label={t("planning.route.confirm.supersede.before_label")}
            tone="muted"
          />
          <DraftCard
            draft={decision.replacement}
            steps={steps}
            t={t}
            label={t("planning.route.confirm.supersede.after_label")}
          />
        </div>
      );
    case "duplicate":
      return (
        <div className="flex flex-col gap-3">
          <StepRefCard
            target={decision.existing}
            label={t("planning.route.confirm.duplicate.existing_label")}
          />
          <DraftCard
            draft={decision.draft}
            steps={steps}
            t={t}
            label={t("planning.route.confirm.duplicate.attempted_label")}
            tone="muted"
          />
        </div>
      );
    case "clarify":
      return <ClarifyCard decision={decision} t={t} />;
    case "multi_step":
      return <MultiStepList drafts={decision.drafts} t={t} />;
    default: {
      // Compile-time exhaustiveness: a new ConfirmableRouteDecision action must
      // add a case here, or this `never` assignment fails to type-check.
      const exhaustive: never = decision;
      return exhaustive;
    }
  }
}

function ClarifyCard({
  decision,
  t,
}: {
  decision: Extract<ConfirmableRouteDecision, { action: "clarify" }>;
  t: Translate;
}) {
  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-md border bg-bg-panel2 p-4">
        <p className="text-xs font-semibold uppercase text-fg-muted">
          {t("planning.route.confirm.clarify.question_label")}
        </p>
        <p className="mt-1 text-base font-semibold text-fg">{decision.question}</p>
      </section>
      {decision.candidateIntent ? (
        <div>
          <p className="text-xs font-medium text-fg-muted">
            {t("planning.route.confirm.clarify.intent_label")}
          </p>
          <p className="mt-1 text-sm text-fg-muted">{decision.candidateIntent}</p>
        </div>
      ) : null}
    </div>
  );
}

function MultiStepList({ drafts, t }: { drafts: MultiStepDraftInput[]; t: Translate }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase text-fg-muted">
        {t("planning.route.confirm.multi_step.steps_label", { count: drafts.length })}
      </p>
      <ol className="flex flex-col gap-3">
        {drafts.map((item, index) => (
          <li key={index} className="rounded-md border bg-bg-panel2 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-fg">
                <span className="text-fg-muted">{index + 1}.</span> {item.draft.title}
              </h3>
              {item.dependsOnDraft.length > 0 ? (
                <span className="shrink-0 text-xs text-fg-muted">
                  {t("planning.route.confirm.multi_step.depends_on_label", {
                    steps: item.dependsOnDraft.map((dep) => `#${dep + 1}`).join(", "),
                  })}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-fg-muted">{item.draft.summary}</p>
            {item.draft.expectedFiles.length > 0 ? (
              <p className="mt-2 text-xs text-fg-muted">{item.draft.expectedFiles.join(", ")}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RouteDecisionFooter({
  decision,
  busy,
  onApprove,
  onReject,
  t,
}: {
  decision: ConfirmableRouteDecision | null;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  t: Translate;
}) {
  if (decision && isInfoOnly(decision.action)) {
    return (
      <DialogFooter>
        <Button onClick={onReject} data-testid="plan-route-dismiss">
          {decision.action === "clarify"
            ? t("planning.route.confirm.clarify.dismiss_button")
            : t("planning.route.confirm.duplicate.dismiss_button")}
        </Button>
      </DialogFooter>
    );
  }

  return (
    <DialogFooter>
      <Button variant="ghost" onClick={onReject} data-testid="plan-route-skip" disabled={busy}>
        <MessageCircle className="h-4 w-4" />
        {decision?.action === "add_step"
          ? t("planning.route.confirm.skip_button")
          : t("planning.route.confirm.cancel_button")}
      </Button>
      <Button onClick={onApprove} data-testid="plan-route-approve" disabled={busy}>
        {primaryIcon(decision)}
        {primaryLabel(decision, t)}
      </Button>
    </DialogFooter>
  );
}

function DraftCard({
  draft,
  steps,
  t,
  label,
  tone = "default",
}: {
  draft: StepDraftInput;
  steps: PlanRoadmapStep[];
  t: Translate;
  label?: string;
  tone?: "default" | "muted";
}) {
  const dependencyText = formatDependencies(
    draft.dependencies,
    steps,
    t("planning.route.confirm.no_dependencies"),
  );
  return (
    <div className="flex flex-col gap-4">
      <section
        className={`rounded-md border p-4 ${tone === "muted" ? "bg-bg-panel" : "bg-bg-panel2"}`}
      >
        <p className="text-xs font-semibold uppercase text-fg-muted">
          {label ?? t("planning.route.confirm.suggested_title")}
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
          <p className="mt-1 text-fg">{draft.parallelGroup ?? t("planning.route.confirm.none")}</p>
        </div>
      </div>

      {draft.acceptanceCriteria.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-fg-muted">
            {t("planning.route.confirm.acceptance_label")}
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-fg">
            {draft.acceptanceCriteria.map((item) => {
              const itemLabel = criterionLabel(item);
              return <li key={itemLabel}>{itemLabel}</li>;
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StepRefCard({
  target,
  label,
  tone = "default",
}: {
  target: StepRefPayload;
  label: string;
  tone?: "default" | "muted";
}) {
  return (
    <section
      className={`rounded-md border p-4 ${tone === "muted" ? "bg-bg-panel" : "bg-bg-panel2"}`}
    >
      <p className="text-xs font-semibold uppercase text-fg-muted">{label}</p>
      <h2 className="mt-1 text-base font-semibold text-fg">
        <span className="text-fg-muted">{target.stepId}</span> {target.title}
      </h2>
    </section>
  );
}

function headerTitle(decision: ConfirmableRouteDecision | null, t: Translate): string {
  switch (decision?.action) {
    case "remove_step":
      return t("planning.route.confirm.remove.title");
    case "supersede_step":
      return t("planning.route.confirm.supersede.title");
    case "duplicate":
      return t("planning.route.confirm.duplicate.title");
    case "clarify":
      return t("planning.route.confirm.clarify.title");
    case "multi_step":
      return t("planning.route.confirm.multi_step.title");
    default:
      return t("planning.route.confirm.title");
  }
}

function headerDescription(decision: ConfirmableRouteDecision | null, t: Translate): string {
  switch (decision?.action) {
    case "remove_step":
      return t("planning.route.confirm.remove.description");
    case "supersede_step":
      return t("planning.route.confirm.supersede.description");
    case "duplicate":
      return t("planning.route.confirm.duplicate.description");
    case "clarify":
      return t("planning.route.confirm.clarify.description");
    case "multi_step":
      return t("planning.route.confirm.multi_step.description");
    default:
      return t("planning.route.confirm.description");
  }
}

function primaryLabel(decision: ConfirmableRouteDecision | null, t: Translate): string {
  switch (decision?.action) {
    case "remove_step":
      return t("planning.route.confirm.remove.confirm_button");
    case "supersede_step":
      return t("planning.route.confirm.supersede.confirm_button");
    case "multi_step":
      return t("planning.route.confirm.multi_step.confirm_button");
    default:
      return t("planning.route.confirm.add_button");
  }
}

function primaryIcon(decision: ConfirmableRouteDecision | null) {
  switch (decision?.action) {
    case "remove_step":
      return <Trash2 className="h-4 w-4" />;
    case "supersede_step":
      return <Repeat className="h-4 w-4" />;
    case "multi_step":
      return <ListPlus className="h-4 w-4" />;
    default:
      return <ClipboardList className="h-4 w-4" />;
  }
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

function criterionLabel(item: AcceptanceCriterionInput): string {
  return typeof item === "string" ? item : `${item.criterionId} ${item.text}`;
}
