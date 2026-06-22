import { useState } from "react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import {
  requestPlanAdjustmentReview,
  type ChallengeStepRationaleInput,
  type ChallengeStepRationaleResult,
  type RationaleChallengeOfferActionInput,
} from "../../features/planning";

export interface RationaleChallengeLinkedCriterion {
  criterionId: string;
  text: string;
}

export interface RationaleChallengeConfig {
  projectId: number;
  planId: number;
  stepDbId: number;
  onChallenge: (input: ChallengeStepRationaleInput) => Promise<ChallengeStepRationaleResult>;
  onAcceptOffer: (input: RationaleChallengeOfferActionInput) => Promise<unknown>;
  onDismissOffer: (input: RationaleChallengeOfferActionInput) => Promise<unknown>;
}

export interface RationaleChallengePanelProps {
  linkedCriteria: RationaleChallengeLinkedCriterion[];
  rationale: string;
  challenge: RationaleChallengeConfig;
  className?: string;
}

export function RationaleChallengePanel({
  linkedCriteria,
  rationale,
  challenge,
  className,
}: RationaleChallengePanelProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChallengeStepRationaleResult | null>(null);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const next = await challenge.onChallenge({
        planId: challenge.planId,
        stepDbId: challenge.stepDbId,
        text: trimmed,
        linkedCriterionIds: linkedCriteria.map((criterion) => criterion.criterionId),
      });
      setResult(next);
      setText("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const offerInput = (): RationaleChallengeOfferActionInput | null => {
    if (!result?.objectionId || !result.offerId) return null;
    return {
      planId: challenge.planId,
      stepDbId: challenge.stepDbId,
      objectionId: result.objectionId,
      offerId: result.offerId,
    };
  };

  const handleAcceptOffer = async () => {
    const input = offerInput();
    if (!input || !result) return;
    setBusy(true);
    setError(null);
    try {
      await challenge.onAcceptOffer(input);
      requestPlanAdjustmentReview({
        projectId: challenge.projectId,
        planId: challenge.planId,
        stepDbId: challenge.stepDbId,
        objectionId: result.objectionId,
        offerId: result.offerId,
        offerKind: result.offerKind,
        message: result.message || t("prd.decomposition.offer_message"),
        suggestedSeed: result.suggestedSeed ?? null,
      });
      setResult({ ...result, suggestionStatus: "accepted" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDismissOffer = async () => {
    const input = offerInput();
    if (!input || !result) return;
    setBusy(true);
    setError(null);
    try {
      await challenge.onDismissOffer(input);
      setResult({ ...result, suggestionStatus: "dismissed" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const hasOfferedAdjustment = result?.suggestionStatus === "offered";

  return (
    <section
      className={cn("rounded-md border border-border bg-bg-panel2/60 px-3 py-2 text-xs", className)}
      data-testid="step-detail-rationale"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-fg">{t("prd.decomposition.rationale")}</p>
          {rationale ? <p className="mt-1 whitespace-pre-wrap text-fg-muted">{rationale}</p> : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((current) => !current)}
          disabled={busy}
          data-testid="step-rationale-challenge-toggle"
        >
          {t("prd.decomposition.challenge")}
        </Button>
      </div>
      {linkedCriteria.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="step-detail-linked-criteria">
          {linkedCriteria.map((criterion) => (
            <span
              key={criterion.criterionId}
              className="inline-flex max-w-full items-center gap-1 rounded-sm border border-border bg-bg px-1.5 py-0.5 text-fg"
            >
              <span className="shrink-0 font-semibold text-accent">{criterion.criterionId}</span>
              <span className="truncate">{criterion.text}</span>
            </span>
          ))}
        </div>
      ) : null}
      {open ? (
        <div className="mt-2">
          <textarea
            className="min-h-20 w-full resize-none rounded-md border bg-bg px-2 py-1.5 text-xs text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("prd.decomposition.challenge")}
            disabled={busy}
            data-testid="step-rationale-challenge-input"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSubmit}
              disabled={busy || text.trim().length === 0}
              data-testid="step-rationale-challenge-submit"
            >
              {t("prd.decomposition.challenge")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen((current) => !current)}
              disabled={busy}
              data-testid="step-rationale-challenge-cancel"
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      {result ? (
        <p className="mt-2 text-info" data-testid="step-rationale-challenge-status">
          {t("prd.decomposition.objection_logged")}
        </p>
      ) : null}
      {hasOfferedAdjustment ? (
        <div
          className="mt-2 rounded-md border border-info/40 bg-info/5 px-2 py-1.5"
          data-testid="step-rationale-challenge-offer"
        >
          <p className="font-semibold text-info">{t("prd.decomposition.offer_title")}</p>
          <p className="mt-1 text-fg-muted">
            {result?.message || t("prd.decomposition.offer_message")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAcceptOffer}
              disabled={busy}
              data-testid="step-rationale-offer-accept"
            >
              {t("prd.decomposition.offer_accept")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismissOffer}
              disabled={busy}
              data-testid="step-rationale-offer-dismiss"
            >
              {t("prd.decomposition.offer_dismiss")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-danger" data-testid="step-rationale-challenge-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default RationaleChallengePanel;
