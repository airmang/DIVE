import { useState } from "react";
import { AlertOctagon, Check, Globe2, X, Pencil } from "lucide-react";
import { useT } from "../../i18n";
import { Button } from "../ui/button";
import { ArgsEditor } from "./ArgsEditor";
import { CommandExplainer } from "./CommandExplainer";
import { explainTool } from "./explain";
import { McpProvenanceBadge } from "../mcp/McpProvenanceBadge";
import { PatchPreviewPanel } from "./PatchPreviewPanel";
import { PermissionSummary } from "./PermissionSummary";
import { RawDetails } from "./RawDetails";
import { summarizePatch } from "./summarize";
import type { PermissionCardProps } from "./types";

export function DangerCard({
  card,
  onApprove,
  onDeny,
  onDiffViewed,
  approvalRequirement,
}: PermissionCardProps) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [modifiedArgs, setModifiedArgs] = useState<unknown | null>(card.args);
  const [denyingWithReason, setDenyingWithReason] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [diffAcknowledged, setDiffAcknowledged] = useState(false);
  const explanation = explainTool(card.toolName, card.risk, card.args, t);
  const changeSummary = summarizePatch({
    toolName: card.toolName,
    diff: card.diffPreview,
    args: card.args,
    t,
  });

  if (explanation.webFetch) {
    return (
      <WebFetchDangerCard
        card={card}
        webFetch={explanation.webFetch}
        onApprove={onApprove}
        onDeny={onDeny}
      />
    );
  }

  const approvalBlocked =
    approvalRequirement?.required === true && approvalRequirement.satisfied !== true;
  const needsDiffAck = card.diffPreview !== null || (card.diffPreviews?.length ?? 0) > 0;
  // When the read gate is required but there is no diff to acknowledge (e.g. a
  // secret-flagged write whose diff preview was unavailable), fall back to a
  // checkbox-only confirm so Approve still can't be rubber-stamped.
  const needsReadConfirm =
    !needsDiffAck &&
    approvalRequirement?.required === true &&
    approvalRequirement.onConfirmChange !== undefined;
  const canApprove =
    (!editing || modifiedArgs !== null) && !approvalBlocked && (!needsDiffAck || diffAcknowledged);

  return (
    <div
      className="w-full overflow-hidden rounded-md border-2 border-danger/60 bg-danger/10"
      data-testid="permission-card"
      data-card-family="permission-card"
      data-risk="danger"
      data-tool-call-id={card.toolCallId}
    >
      <div className="flex items-start gap-2 border-b border-danger/40 bg-danger/20 px-3 py-2">
        <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-fg">{t("permission_card.danger.title")}</span>
            <McpProvenanceBadge name={card.toolName} />
          </div>
          <p className="text-xs text-danger">{t("permission_card.danger.description")}</p>
          {explanation.terminalScript ? (
            <p
              className="mt-1 text-xs font-medium text-danger"
              data-testid="terminal-script-risk-copy"
            >
              {t("runtime.actions.terminal_script_high_risk")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        <PermissionSummary
          toolName={card.toolName}
          risk={card.risk}
          explanation={explanation}
          actionContext={card.actionContext}
          changeSummary={changeSummary}
        />
        <CommandExplainer explanation={explanation} />
        <PatchPreviewPanel
          diff={card.diffPreview}
          diffPreviews={card.diffPreviews}
          expected={explanation.patchPreviewExpected}
          summary={changeSummary}
          approvalWarnings={card.approvalWarnings}
          onViewed={() => onDiffViewed?.(card.toolCallId)}
        />
        {needsDiffAck ? (
          <label
            className="flex items-start gap-2 rounded-sm border border-border bg-bg/60 px-2 py-2 text-xs text-fg"
            data-testid="danger-diff-ack"
          >
            <input
              type="checkbox"
              checked={diffAcknowledged}
              onChange={(e) => {
                setDiffAcknowledged(e.target.checked);
                approvalRequirement?.onConfirmChange?.(e.target.checked);
              }}
              className="mt-0.5 h-4 w-4 rounded border-border text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="danger-diff-ack-checkbox"
            />
            <span className="min-w-0">{t("permission_card.danger.diff_ack_label")}</span>
          </label>
        ) : null}
        <RawDetails value={{ preview: card.paramsPreview, args: card.args }} />
      </div>

      {editing ? (
        <div className="border-t px-3 py-2">
          <ArgsEditor initial={card.args} onChange={(parsed) => setModifiedArgs(parsed)} />
        </div>
      ) : null}

      {denyingWithReason ? (
        <div className="border-t px-3 py-2">
          <label className="text-xs text-fg-muted">
            {t("permission_card.actions.deny_reason_label")}
          </label>
          <textarea
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            rows={2}
            aria-label={t("permission_card.actions.deny_reason_aria")}
            data-testid="deny-reason"
            className="mt-1 w-full resize-y rounded-md border bg-bg-panel2 px-3 py-2 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
        </div>
      ) : null}

      {approvalRequirement?.required ? (
        <div
          className="space-y-2 border-t bg-danger/10 px-3 py-2 text-xs text-fg"
          data-testid="permission-approval-requirement"
          data-satisfied={approvalRequirement.satisfied ? "true" : "false"}
        >
          <p>{approvalRequirement.message}</p>
          {needsReadConfirm ? (
            <label
              className="flex items-start gap-2 rounded-sm border border-danger/30 bg-bg/70 px-2 py-2"
              data-testid="permission-read-confirm"
            >
              <input
                type="checkbox"
                checked={approvalRequirement.confirmed === true}
                onChange={(e) => approvalRequirement.onConfirmChange?.(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="permission-read-confirm-checkbox"
              />
              <span className="min-w-0">
                {approvalRequirement.confirmLabel ?? t("permission_card.read_gate.confirm_label")}
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t bg-bg-panel2/30 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label={
            editing
              ? t("permission_card.actions.stop_editing")
              : t("permission_card.actions.edit_request")
          }
          data-testid="card-edit"
          onClick={() => setEditing((v) => !v)}
        >
          <Pencil />
          {editing
            ? t("permission_card.actions.stop_editing")
            : t("permission_card.actions.edit_request")}
        </Button>
        <div className="flex flex-wrap gap-1">
          {denyingWithReason ? (
            <Button
              size="sm"
              variant="outline"
              aria-label={t("permission_card.actions.confirm_deny")}
              data-testid="card-deny-confirm"
              onClick={() => onDeny(card.toolCallId, denyReason.trim() || undefined)}
            >
              <X />
              {t("permission_card.actions.confirm_deny")}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("permission_card.actions.add_reason")}
                data-testid="card-deny-with-reason"
                onClick={() => setDenyingWithReason(true)}
              >
                {t("permission_card.actions.add_reason")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                aria-label={t("permission_card.actions.deny")}
                data-testid="card-deny"
                onClick={() => onDeny(card.toolCallId)}
              >
                <X />
                {t("permission_card.actions.deny")}
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={!canApprove}
            aria-label={t("permission_card.danger.approve")}
            data-testid="card-approve"
            onClick={() =>
              onApprove(card.toolCallId, editing ? (modifiedArgs ?? undefined) : undefined)
            }
          >
            <Check />
            {t("permission_card.danger.approve")}
          </Button>
        </div>
      </footer>
    </div>
  );
}

type WebFetchDetails = NonNullable<ReturnType<typeof explainTool>["webFetch"]>;

function argsWithReuse(args: unknown, reuseForSession: boolean): unknown {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return args;
  return { ...(args as Record<string, unknown>), reuse_for_session: reuseForSession };
}

function displayHost(host: string, port: number | null): string {
  if (port === null || port === 80 || port === 443) return host;
  return `${host}:${port}`;
}

function WebFetchDangerCard({
  card,
  webFetch,
  onApprove,
  onDeny,
}: {
  card: PermissionCardProps["card"];
  webFetch: WebFetchDetails;
  onApprove: PermissionCardProps["onApprove"];
  onDeny: PermissionCardProps["onDeny"];
}) {
  const t = useT();
  const [confirmed, setConfirmed] = useState(false);
  const [reuseForSession, setReuseForSession] = useState(false);

  return (
    <div
      className="w-full overflow-hidden rounded-md border-2 border-danger/60 bg-danger/10"
      data-testid="permission-card"
      data-card-family="permission-card"
      data-risk="danger"
      data-tool-call-id={card.toolCallId}
      data-tool-name="web_fetch"
    >
      <div className="flex items-start gap-2 border-b border-danger/40 bg-danger/20 px-3 py-2">
        <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-fg">{t("permission_card.web.title")}</span>
            <McpProvenanceBadge name={card.toolName} />
          </div>
          <p className="text-xs text-danger">{t("permission_card.web.frame")}</p>
        </div>
      </div>

      <div className="space-y-3 px-3 py-3 text-xs">
        <dl
          className="grid gap-2 rounded-md border border-danger/30 bg-bg/70 p-3 sm:grid-cols-2"
          data-testid="web-fetch-details"
        >
          <div>
            <dt className="font-semibold text-fg">{t("permission_card.web.host_label")}</dt>
            <dd className="mt-0.5 break-words font-mono text-fg-muted" data-testid="web-fetch-host">
              {displayHost(webFetch.host, webFetch.port)}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-fg">{t("permission_card.web.ip_label")}</dt>
            <dd className="mt-0.5 break-words font-mono text-fg-muted" data-testid="web-fetch-ip">
              {webFetch.resolvedIp ?? t("permission_card.command.not_provided")}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold text-fg">{t("permission_card.web.purpose_label")}</dt>
            <dd className="mt-0.5 break-words text-fg-muted" data-testid="web-fetch-purpose">
              {webFetch.purpose ?? t("permission_card.command.not_provided")}
            </dd>
          </div>
        </dl>

        <label
          className="flex items-start gap-2 rounded-sm border border-border bg-bg/60 px-2 py-2 text-fg"
          data-testid="web-fetch-confirm"
        >
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="web-fetch-confirm-checkbox"
          />
          <span className="min-w-0">{t("permission_card.web.confirm")}</span>
        </label>

        <label
          className="flex items-start gap-2 rounded-sm border border-border bg-bg/40 px-2 py-2 text-fg-muted"
          data-testid="web-fetch-reuse"
        >
          <input
            type="checkbox"
            checked={reuseForSession}
            onChange={(e) => setReuseForSession(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="web-fetch-reuse-checkbox"
          />
          <span className="min-w-0">{t("permission_card.web.reuse_optin")}</span>
        </label>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-1 border-t bg-bg-panel2/30 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("permission_card.web.deny")}
          data-testid="card-deny"
          onClick={() => onDeny(card.toolCallId)}
        >
          <X />
          {t("permission_card.web.deny")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!confirmed}
          aria-label={t("permission_card.web.allow")}
          data-testid="card-approve"
          onClick={() => onApprove(card.toolCallId, argsWithReuse(card.args, reuseForSession))}
        >
          <Check />
          {t("permission_card.web.allow")}
        </Button>
      </footer>
    </div>
  );
}
