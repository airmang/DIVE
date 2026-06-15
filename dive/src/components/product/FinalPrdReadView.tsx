import { Edit3, History, ListChecks, Play } from "lucide-react";
import type { ProjectSpec } from "../../features/planning";
import { useT } from "../../i18n";
import { Button } from "../ui/button";

export interface FinalPrdReadViewProps {
  projectName: string;
  projectSpec: ProjectSpec;
  planActionLabel: string;
  onEdit: () => void;
  onCreatePlan: () => void;
  onOpenHistory?: () => void;
}

function compactList(values: string[], empty: string) {
  const items = values.filter((value) => value.trim().length > 0);
  return items.length > 0 ? items : [empty];
}

export function FinalPrdReadView({
  projectName,
  projectSpec,
  planActionLabel,
  onEdit,
  onCreatePlan,
  onOpenHistory,
}: FinalPrdReadViewProps) {
  const t = useT();
  const activeCriteria = projectSpec.acceptanceCriteria.filter(
    (criterion) => criterion.status === "active",
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-auto bg-bg px-6 py-5"
      data-testid="final-prd-read-view"
      aria-label={t("prd.read_view.title")}
    >
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-fg-muted">{projectName}</p>
          <h2 className="mt-1 text-xl font-semibold text-fg">{t("prd.read_view.title")}</h2>
          <p className="mt-1 text-xs text-fg-muted">PRD v{projectSpec.currentVersion}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onOpenHistory ? (
            <Button variant="outline" size="sm" onClick={onOpenHistory}>
              <History />
              {t("prd.authoring.history")}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onEdit} data-testid="final-prd-edit">
            <Edit3 />
            {t("prd.read_view.edit")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onCreatePlan}
            data-testid="final-prd-create-plan"
          >
            <Play />
            {planActionLabel}
          </Button>
        </div>
      </header>

      <div className="grid gap-5 py-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <main className="min-w-0 space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-fg">{t("prd.fields.goal")}</h3>
            <p className="mt-2 text-lg font-medium leading-relaxed text-fg">{projectSpec.goal}</p>
            {projectSpec.intentSummary ? (
              <p className="mt-2 text-sm text-fg-muted">{projectSpec.intentSummary}</p>
            ) : null}
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-accent" aria-hidden />
              <h3 className="text-sm font-semibold text-fg">
                {t("prd.fields.acceptance_criteria")}
              </h3>
            </div>
            <ol className="space-y-2">
              {activeCriteria.map((criterion) => (
                <li
                  key={criterion.criterionId}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-md border bg-bg-panel2 px-3 py-2"
                >
                  <span className="text-xs font-semibold text-accent">{criterion.criterionId}</span>
                  <span className="text-sm text-fg">{criterion.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </main>

        <aside className="space-y-5">
          <section>
            <h3 className="text-sm font-semibold text-fg">{t("prd.fields.scope")}</h3>
            <ul className="mt-2 space-y-1 text-sm text-fg-muted">
              {compactList(projectSpec.scope, t("prd.read_view.empty_scope")).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-fg">{t("prd.fields.non_goals")}</h3>
            <ul className="mt-2 space-y-1 text-sm text-fg-muted">
              {compactList(projectSpec.nonGoals, t("prd.read_view.empty_scope")).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-fg">{t("prd.fields.constraints")}</h3>
            <ul className="mt-2 space-y-1 text-sm text-fg-muted">
              {compactList(projectSpec.constraints, t("prd.read_view.empty_scope")).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
}

export default FinalPrdReadView;
