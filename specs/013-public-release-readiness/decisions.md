# 013 Public Release Readiness — Decision Log

Stage-scoped dispositions made while executing S-058–S-070. Each entry names
the stage, the decision, and the evidence. Canonical order: constitution >
specs > this log.

## D-013-01 (S-058) — Copyrighted PDFs leave the tree; local copies survive

`references-pdf/` (18 publisher PDFs, 30 MB) is untracked via `git rm --cached`
so the owner's local research copies stay on disk; `.gitignore` blocks
re-ingestion and `references.md` carries full citations (5 items have no DOI —
book chapter / arXiv preprints / whitepaper — each marked with its reason).
History still contains the blobs; purging is exclusively S-070's job so the
rewrite happens exactly once.

## D-013-02 (S-058) — Internal presentation material is ignored, not moved

The KACE-internal strategy docs and presentation working files stay physically
in the tree (deck build pipelines and the owner's local workflow reference
them) but are promoted from `.git/info/exclude` to the shared `.gitignore`.
`docs/product-extractions/` is deliberately NOT ignored — canonical status docs
reference it, so it is tracked.

## D-013-03 (S-059) — Historical records keep mentions of deleted scripts

CHANGELOG, DIVE_PROGRESS, DIVE_DECISIONS, and `docs/archive/**` retain
references to the 23 deleted one-shot scripts: they record what happened and
are not live usage docs. Only `docs/a11y-contrast.md` was edited, because it
falsely described a retired script as a currently-running gate.

## D-013-04 (S-059) — verify-version-sync keeps live checks only

The P10-09 `wilyChecks` block (frozen 2026-05-15 diffstats, SHAs, timestamps)
is retired; version-sync §1, ADR bundle §2, README markers §3, and the
workflow-structure checks §4 remain because they assert against live files.
Expected version now defaults to `package.json` (CLI arg = override only).

## D-013-05 (S-060) — OpenRouterProvisioning engine deleted

Deleting the three renderer-facing master-key IPC commands left
`auth::OpenRouterProvisioning` (206 lines + integration test) with zero
production callers, and no active spec claims classroom child-key
provisioning. Deleted; `SecretScope::OpenRouterChildKey` (independent keyring
scope with its own usage) is untouched. Revival path: git history.

## D-013-06 (S-061) — Rationale-challenge FE surface deleted; backend is 005 canon

`RationaleChallengePanel` (230 lines, zero importers), `RoadmapHost`, the
controller→layout→RoadmapRail prop chain, and the now-unreferenced usePlan
handlers are removed. The backend IPC
(`workspace_plan_challenge_step_rationale`,
`workspace_plan_respond_to_plan_adjustment_offer`), EventLog/export behavior,
and wire types stay — they are spec 005/S-019 assets, and the plan-adjustment
offer path is still live through `PlanAdjustmentReviewRequestDetail` used by
PlanAddStepPanel. Reviving the challenge-initiation UI is a spec-005-lineage
feature task, not a revert of this deletion.

## D-013-07 (S-061) — rules.ts is NOT dead; deletion refused on evidence

The review's "725-line rule engine always returns empty in production" holds
only for the gated engine entrypoints (`generateProvocationCards` behind the
DEV-only quarantine flag). Individual rule exports are live:
`buildPrdIntentCheckCard` is called ungated in production by
`PrdAuthoringBoard`, and two rules are directly unit-tested. rules.ts and its
test suite stay; only the dead `shouldShowProvocationCardInMode` stub was
inlined away and the orphaned `useProvocationCards.ts` wrapper (zero
importers) deleted. The per-render context-construction inefficiency remains
S-069 backlog.

## D-013-10 (S-062) — Failure surfacing sites and two verified non-changes

Silent-failure fixes route through a shared `runUserAction` helper at five
sites (settings connect/select, plan add-step, verification observation,
preview candidate) using the existing classifyError/toast patterns —
`classifyConnectError` was extracted from OnboardingDialog so the same failure
renders identically in onboarding and settings. Two review items were
verified as not needing change: `ProductShellLayout.handleOpenPlanStep` (both
upstream callers already catch — PlanStep try/catch→onActionError,
PlanView allSettled→failure banners; adding a toast would double-surface),
and the dead store `error` field (zero readers confirmed, but removal
cascades ~29 lines through runStoreAction/13 actions — deferred to backlog).
type-aware no-floating-promises lint was not added (config is not
type-aware; build-time cost).

## D-013-11 (S-068) — Two FE hook extractions deferred

The three god-hooks split into 11 modules (−34%), but two extractions the
spec named were deferred on evidence, not skipped: `usePrdAuthoring`
(startPlanGenerationFromPrd threads PRD state + plan-draft lifecycle + chat +
session + navigation; a clean hook would take ~30 inputs — a leaky
abstraction that risks behavior under pure-move) and `useCardActions`
(restoreCheckpoint mutates chat state via setState, coupling card/checkpoint
IPC to the session). Both are recorded for a future dedicated refactor with
proper interface design, not a public-release-gating item. The prdSurface
React.memo bailout that the element→data move would have lost was restored in
this stage (ConversationSurfaces wrappers), so S-068 is performance-neutral.

## D-013-12 (S-069) — Per-card stats command kept; migration test hardened

G1 optimized `count_by_card` (single JOIN COUNT, no full scan / N+1), which
backs the per-card `card_tool_call_stats` IPC command. The P2 batch
(`card_tool_call_stats_batch` via `counts_by_session`) became the workmap's
production path, so adversarial review (M4) flagged the per-card command as now
caller-less. It is **kept**, not removed: it is the sole consumer of the
G1-optimized `count_by_card` stack and its equivalence test
(`count_by_card_matches_reference_scan_across_message_shapes`) is valuable
regression coverage on the canonical count semantics; removing a tested,
working single-card API in a performance stage on the release branch is more
risk than the Minor warrants. Review M2 (expression-index build path unexercised
on non-empty ledgers) was closed with a defensive migration test seeding real
EventLog rows before v19. M1/M3 are invariant-protected (plan_id is always an
integer; cards never leave their session) and non-actionable.

## D-013-08 (S-063) — S-048 6b plain-GET egress: absorbed (option a)

**Decision: option (a) — absorb the hardening now.** The process-tool plain-GET
egress hole (S-048 locked decision 6b — `curl -o … https://x` / `wget …` passing
`classify_bash_command`, tracked in `docs/spec-status.md`) is closed in S-063
rather than left as a standing follow-up.

Rationale: Constitution III(1.1.0) already requires that "the same safe-egress
policy MUST also govern any outbound network reachable through the process tool"
and that the plain-GET allowance "MUST be tightened or filed as a tracked
egress-hardening follow-up." S-063 is the security-hardening stage whose whole
premise is making the process tools symmetric with the SSRF-guarded `web_fetch`,
so tightening here is the constitutionally-preferred branch — deferring again
would leave `web_fetch` un-truthfully describable as the "only sanctioned egress"
(the exact wording the ADR forbids until this lands).

Implementation: a command-anchored `curl`/`wget` rule was added to the shared
`classify_bash_command` blocklist (guard.rs), so both `run_process` and
`run_terminal_script` now block plain outbound fetch with a beginner-facing
reason ("network fetch via process tool") that steers to DIVE's checked
`web_fetch` (public docs, SSRF-validated) or Preview (local dev servers). The
rule is anchored to command position (`^`/after a separator) so a source file
merely named `curl_helper.js` is not blocked. The pre-existing guard test that
asserted `curl -o … https://x` was *allowed* (guard.rs:498-499) was updated to
assert it is now blocked — this is the intended tightening, documented in the
S-063 report. Wrapper reach (`xargs curl …`) is bounded by the same wrapper
concern handled in F1's `detect_wrapper_shell_bypass` and the `env` block, and
is noted as a residual in the report.

`docs/spec-status.md` tracked follow-up updated to record the resolution.

## D-013-13 (S-070) — Public flip is BLOCKED on GitHub Support (PR-ref purge)

The history rewrite is complete and clean: `git filter-repo` purged the 18
copyrighted PDFs and the internal conference-poster tree (references.md kept)
from all of `main`'s history; `.git` shrank 160 MB → 12 MB; `origin/main`
was force-pushed and carries **zero** PDF/references-pdf objects; the stale
`010`/`011` branches were deleted from origin. Owner decisions applied: email
left as-is, home paths scrubbed in-tree, conference material made internal.

**Blocker — do NOT flip the repo public yet.** 19 references-pdf objects
remain reachable on origin through `refs/pull/*/head` (the ~30 closed/merged
pull-request head refs GitHub maintains). These refs are GitHub-managed and
**cannot be deleted with `git push`**; rewriting `main` does not touch them.
On a public repo the copyrighted PDFs would still be served through the PR
"Files changed" views and by fetching the PR refs — i.e. the DMCA exposure
the whole round exists to remove would survive.

**Required before flip (owner action):** open a GitHub Support request to
purge cached views and the pull-request references for this repository after
the history rewrite (GitHub's documented "Removing sensitive data" remedy —
only Support can drop `refs/pull/*` content), and confirm completion. Also
review the scratch branch `claude/angry-margulis-e16424` still on origin.
Only after Support confirms the PR-ref/cached PDF exposure is gone should the
repository be toggled private → public. That toggle and the Support ticket
are the owner's to execute.

## D-013-09 (owner) — History-rewrite pass decisions (resolved)

Resolved 2026-07-20: (a) commit-author email `kokyuhyun@hotmail.com` left
as-is across history per owner; (b) personal home paths scrubbed in the
working tree (18 docs → `~/DIVE-2`, `~`), history left as-is (non-sensitive).
The single `git filter-repo` rewrite pass (run as two continuations on the
same working repo) purged the copyrighted PDFs and the internal
conference-poster tree; a full bundle backup was taken first
(scratchpad `dive-pre-filter-repo-backup.bundle`, 153 MB) for recoverability.

S-070 executes exactly one `git filter-repo` pass. Owner decisions pending:
commit-author personal email exposure, and personal home paths in 15 tracked
docs. To be asked at S-070 kickoff, not before.
