import { History, Save, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  allocateCriterionId,
  markDraftStudentEdited,
  validateMinimalProjectSpec,
  type AcceptanceCriterion,
  type LiveProjectSpecDraft,
  type PrdPatchValidationOutcome,
} from "../../features/planning";
import { useT } from "../../i18n";
import { Button } from "../ui/button";
import { RuntimeModelSelector } from "../chat/RuntimeModelSelector";
import { cn } from "../../lib/utils";

export type PrdAuthoringState = "missing" | "draft" | "minimal" | "saved" | "editing";

export interface PrdPatchFeedback {
  validationOutcome: PrdPatchValidationOutcome;
  appliedFieldPaths: string[];
  rejectedReasons: string[];
}

export interface PrdInterviewSubmissionResult {
  assistantMessage?: string | null;
}

type PrdConversationTurnState = "pending" | "error";

interface PrdConversationTurn {
  id: string;
  role: "assistant" | "student";
  text: string;
  state?: PrdConversationTurnState;
}

const PRD_CONVERSATION_STORAGE_PREFIX = "dive:prd-authoring-conversation:";

export interface PrdAuthoringBoardProps {
  projectName: string;
  projectPath?: string | null;
  prdState: PrdAuthoringState;
  draft: LiveProjectSpecDraft;
  busy?: boolean;
  recentlyChangedFields?: string[];
  patchFeedback?: PrdPatchFeedback | null;
  onDraftChange: (draft: LiveProjectSpecDraft) => void;
  onSubmitAnswer: (
    answer: string,
  ) => PrdInterviewSubmissionResult | void | Promise<PrdInterviewSubmissionResult | void>;
  onSaveDraft?: (draft: LiveProjectSpecDraft) => void;
  onSavePrdAndCreatePlan: (draft: LiveProjectSpecDraft) => void;
  onOpenHistory?: () => void;
}

function normalizeCriteria(criteria: AcceptanceCriterion[]): AcceptanceCriterion[] {
  return criteria.length > 0
    ? criteria
    : [
        {
          criterionId: "",
          text: "",
          source: "student_edit",
          status: "active",
          createdInVersion: 1,
          retiredInVersion: null,
        },
      ];
}

function nextCriterion(
  criteria: AcceptanceCriterion[],
  text: string,
  version: number | undefined,
): AcceptanceCriterion {
  return {
    criterionId: allocateCriterionId(criteria),
    text,
    source: "student_edit",
    status: "active",
    createdInVersion: version ?? 1,
    retiredInVersion: null,
  };
}

function includesField(fields: string[], field: string) {
  return fields.some((path) => path === field || path.startsWith(`${field}.`));
}

function seedTurn(text: string): PrdConversationTurn {
  return {
    id: "prd-seed",
    role: "assistant",
    text,
  };
}

function conversationStorageKeyForDraft(draft: LiveProjectSpecDraft): string {
  return `${PRD_CONVERSATION_STORAGE_PREFIX}${draft.projectId}:${draft.draftId}:${
    draft.baseVersion ?? "new"
  }`;
}

function isStoredConversationTurn(value: unknown): value is PrdConversationTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  return (
    typeof turn.id === "string" &&
    (turn.role === "assistant" || turn.role === "student") &&
    typeof turn.text === "string" &&
    turn.text.trim().length > 0 &&
    (turn.state === undefined || turn.state === "error")
  );
}

function loadConversationTurns(key: string): PrdConversationTurn[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const turns = parsed.filter(isStoredConversationTurn);
    return turns.length > 0 ? turns : null;
  } catch {
    return null;
  }
}

function persistableConversationTurns(turns: PrdConversationTurn[]): PrdConversationTurn[] {
  return turns
    .filter((turn) => turn.state !== "pending")
    .map((turn) => (turn.state ? turn : { id: turn.id, role: turn.role, text: turn.text }));
}

export function PrdAuthoringBoard({
  projectName,
  projectPath,
  prdState,
  draft,
  busy = false,
  recentlyChangedFields = [],
  patchFeedback = null,
  onDraftChange,
  onSubmitAnswer,
  onSaveDraft,
  onSavePrdAndCreatePlan,
  onOpenHistory,
}: PrdAuthoringBoardProps) {
  const t = useT();
  const [localDraft, setLocalDraft] = useState(draft);
  const [answer, setAnswer] = useState("");
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [conversationStorageKey, setConversationStorageKey] = useState(() =>
    conversationStorageKeyForDraft(draft),
  );
  const [conversationTurns, setConversationTurns] = useState<PrdConversationTurn[]>(() => [
    ...(loadConversationTurns(conversationStorageKeyForDraft(draft)) ?? [
      seedTurn(t("prd.authoring.interview_seed")),
    ]),
  ]);

  useEffect(() => {
    setLocalDraft(draft);
  }, [draft]);

  useEffect(() => {
    const nextKey = conversationStorageKeyForDraft(draft);
    if (conversationStorageKey === nextKey) return;
    setConversationStorageKey(nextKey);
    setConversationTurns(
      loadConversationTurns(nextKey) ?? [seedTurn(t("prd.authoring.interview_seed"))],
    );
  }, [conversationStorageKey, draft, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const turns = persistableConversationTurns(conversationTurns);
    if (turns.length === 0) return;
    window.localStorage.setItem(conversationStorageKey, JSON.stringify(turns));
  }, [conversationStorageKey, conversationTurns]);

  const validation = useMemo(() => validateMinimalProjectSpec(localDraft.spec), [localDraft.spec]);
  const criteria = normalizeCriteria(localDraft.spec.acceptanceCriteria);
  const isAnswerBusy = busy || submittingAnswer;

  const updateDraft = (next: LiveProjectSpecDraft, changedFields: string[]) => {
    const marked = markDraftStudentEdited(next, changedFields);
    setLocalDraft(marked);
    onDraftChange(marked);
  };

  const updateSpecField = <K extends keyof LiveProjectSpecDraft["spec"]>(
    field: K,
    value: LiveProjectSpecDraft["spec"][K],
    fieldPath: string,
  ) => {
    updateDraft(
      {
        ...localDraft,
        spec: {
          ...localDraft.spec,
          [field]: value,
        },
      },
      [fieldPath],
    );
  };

  const updateStringList = (
    field: "scope" | "nonGoals" | "constraints",
    value: string,
    fieldPath: string,
  ) => {
    const lines = value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    updateSpecField(field, lines, fieldPath);
  };

  const updateCriterion = (index: number, text: string) => {
    const current = localDraft.spec.acceptanceCriteria;
    const next = [...current];
    const existing = next[index];
    if (existing) {
      next[index] = { ...existing, text };
    } else if (text.trim()) {
      next[index] = nextCriterion(next, text, localDraft.spec.currentVersion);
    }
    updateSpecField("acceptanceCriteria", next, "acceptanceCriteria");
  };

  const submitAnswer = async () => {
    const trimmed = answer.trim();
    if (!trimmed || isAnswerBusy) return;
    const stamp = Date.now();
    const pendingId = `assistant-${stamp}`;
    setConversationTurns((turns) => [
      ...turns,
      {
        id: `student-${stamp}`,
        role: "student",
        text: trimmed,
      },
      {
        id: pendingId,
        role: "assistant",
        text: t("prd.authoring.turn_pending"),
        state: "pending",
      },
    ]);
    setAnswer("");
    setSubmittingAnswer(true);
    try {
      const result = await onSubmitAnswer(trimmed);
      const assistantText = result?.assistantMessage?.trim();
      setConversationTurns((turns) =>
        assistantText
          ? turns.map((turn) =>
              turn.id === pendingId ? { ...turn, text: assistantText, state: undefined } : turn,
            )
          : turns.filter((turn) => turn.id !== pendingId),
      );
    } catch {
      setConversationTurns((turns) =>
        turns.map((turn) =>
          turn.id === pendingId
            ? { ...turn, text: t("prd.authoring.turn_error_retryable"), state: "error" }
            : turn,
        ),
      );
    } finally {
      setSubmittingAnswer(false);
    }
  };

  const stateLabel =
    prdState === "minimal" || prdState === "saved"
      ? t("prd.authoring.state_minimal")
      : prdState === "missing"
        ? t("prd.authoring.state_missing")
        : t("prd.authoring.state_draft");

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-bg"
      data-testid="prd-authoring-board"
      aria-label={t("prd.authoring.title")}
    >
      <header
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-3"
        data-testid="prd-board-header"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{t("prd.authoring.title")}</p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span className="truncate">{projectName}</span>
            {projectPath ? <span className="truncate">{projectPath}</span> : null}
            <span className="rounded-sm border px-1.5 py-0.5">{stateLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RuntimeModelSelector disabled={busy} />
          {onOpenHistory ? (
            <Button variant="outline" size="sm" onClick={onOpenHistory}>
              <History />
              {t("prd.authoring.history")}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside
          className="flex min-h-0 flex-col border-b bg-bg-panel/60 lg:border-b-0 lg:border-r"
          data-testid="prd-interview-rail"
        >
          <div className="border-b px-4 py-3">
            <p className="text-sm font-semibold text-fg">{t("prd.authoring.interview_rail")}</p>
            <p className="mt-1 text-xs text-fg-muted">{t("prd.authoring.interview_prompt")}</p>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto px-4 py-3 text-sm">
            {conversationTurns.map((turn) => (
              <div
                key={turn.id}
                className={cn(
                  "rounded-md border p-3 text-fg",
                  turn.role === "assistant" ? "mr-5 bg-bg-panel2" : "ml-5 bg-accent-subtle",
                  turn.state === "pending" && "text-fg-muted",
                  turn.state === "error" && "border-warn/50 bg-warn/10",
                )}
                data-testid={`prd-interview-turn-${turn.role}`}
                data-state={turn.state ?? "ready"}
              >
                <p className="text-[11px] font-semibold uppercase tracking-normal text-fg-muted">
                  {turn.role === "assistant"
                    ? t("prd.authoring.assistant_label")
                    : t("prd.authoring.student_label")}
                </p>
                <p className="mt-1 whitespace-pre-wrap leading-relaxed">{turn.text}</p>
              </div>
            ))}
          </div>
          <div className="border-t p-3">
            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={isAnswerBusy}
              rows={3}
              className="w-full resize-none rounded-md border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              placeholder={t("prd.authoring.answer_placeholder")}
              data-testid="prd-interview-input"
            />
            <Button
              variant="primary"
              size="sm"
              className="mt-2 w-full"
              disabled={!answer.trim() || isAnswerBusy}
              onClick={() => void submitAnswer()}
              data-testid="prd-interview-send"
            >
              <Send />
              {t("prd.authoring.answer_send")}
            </Button>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto px-6 py-5" data-testid="prd-live-canvas">
          {patchFeedback ? (
            <div
              className={cn(
                "mb-4 rounded-md border px-3 py-2 text-xs",
                patchFeedback.validationOutcome === "applied" && "border-success/40 bg-success/10",
                patchFeedback.validationOutcome === "rejected" && "border-warn/40 bg-warn/10",
                patchFeedback.validationOutcome === "held_for_student" &&
                  "border-accent/40 bg-accent-subtle",
              )}
              data-testid="prd-patch-feedback"
              data-outcome={patchFeedback.validationOutcome}
              role="status"
            >
              {patchFeedback.validationOutcome === "applied"
                ? t("prd.authoring.patch_applied")
                : patchFeedback.validationOutcome === "held_for_student"
                  ? t("prd.authoring.patch_held")
                  : t("prd.authoring.patch_rejected")}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-2">
            <label
              className="flex flex-col gap-1 xl:col-span-2"
              data-testid="prd-field-goal"
              data-changed={includesField(recentlyChangedFields, "goal") ? "true" : "false"}
            >
              <span className="text-xs font-semibold text-fg-muted">{t("prd.fields.goal")}</span>
              <textarea
                value={localDraft.spec.goal}
                onChange={(event) => updateSpecField("goal", event.target.value, "goal")}
                rows={2}
                className="resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
                placeholder={t("prd.authoring.goal_placeholder")}
                data-testid="prd-goal-input"
              />
            </label>

            <label className="flex flex-col gap-1 xl:col-span-2">
              <span className="text-xs font-semibold text-fg-muted">
                {t("prd.fields.intent_summary")}
              </span>
              <textarea
                value={localDraft.spec.intentSummary ?? ""}
                onChange={(event) =>
                  updateSpecField(
                    "intentSummary",
                    event.target.value.trim() ? event.target.value : null,
                    "intentSummary",
                  )
                }
                rows={2}
                className="resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
                placeholder={t("prd.authoring.intent_placeholder")}
                data-testid="prd-intent-input"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-fg-muted">{t("prd.fields.scope")}</span>
              <textarea
                value={localDraft.spec.scope.join("\n")}
                onChange={(event) => updateStringList("scope", event.target.value, "scope")}
                rows={4}
                className="resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
                placeholder={t("prd.authoring.scope_placeholder")}
                data-testid="prd-scope-input"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-fg-muted">
                {t("prd.fields.non_goals")}
              </span>
              <textarea
                value={localDraft.spec.nonGoals.join("\n")}
                onChange={(event) => updateStringList("nonGoals", event.target.value, "nonGoals")}
                rows={4}
                className="resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
                placeholder={t("prd.authoring.non_goals_placeholder")}
                data-testid="prd-non-goals-input"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-fg-muted">
                {t("prd.fields.constraints")}
              </span>
              <textarea
                value={localDraft.spec.constraints.join("\n")}
                onChange={(event) =>
                  updateStringList("constraints", event.target.value, "constraints")
                }
                rows={4}
                className="resize-none rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
                placeholder={t("prd.authoring.constraints_placeholder")}
                data-testid="prd-constraints-input"
              />
            </label>

            <div
              className="flex flex-col gap-2"
              data-testid="prd-field-acceptanceCriteria"
              data-changed={
                includesField(recentlyChangedFields, "acceptanceCriteria") ? "true" : "false"
              }
            >
              <span className="text-xs font-semibold text-fg-muted">
                {t("prd.fields.acceptance_criteria")}
              </span>
              {criteria.map((criterion, index) => (
                <label key={criterion.criterionId || index} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-xs font-semibold text-accent">
                    {criterion.criterionId || `AC-${String(index + 1).padStart(3, "0")}`}
                  </span>
                  <input
                    value={criterion.text}
                    onChange={(event) => updateCriterion(index, event.target.value)}
                    className="min-w-0 flex-1 rounded-md border bg-bg-panel2 px-3 py-2 text-sm text-fg"
                    placeholder={t("prd.authoring.criterion_placeholder")}
                    data-testid={`prd-criterion-input-${index}`}
                  />
                </label>
              ))}
            </div>
          </div>
        </main>
      </div>

      <footer
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-bg-panel px-6 py-3"
        data-testid="prd-bottom-action-bar"
      >
        <div className="text-xs text-fg-muted" data-testid="prd-validation-hint">
          {validation.valid
            ? t("prd.authoring.validation_ready")
            : validation.reasonCodes
                .map((code) =>
                  code === "missing_goal"
                    ? t("prd.authoring.validation_goal_required")
                    : t("prd.authoring.validation_criterion_required"),
                )
                .join(" · ")}
        </div>
        <div className="flex items-center gap-2">
          {onSaveDraft ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSaveDraft(localDraft)}
              disabled={busy}
              data-testid="prd-save-draft"
            >
              <Save />
              {t("prd.authoring.save_draft")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSavePrdAndCreatePlan(localDraft)}
            disabled={!validation.valid || busy}
            data-testid="prd-save-create-plan"
          >
            <Save />
            {t("prd.authoring.save_create_plan")}
          </Button>
        </div>
      </footer>
    </section>
  );
}

export default PrdAuthoringBoard;
