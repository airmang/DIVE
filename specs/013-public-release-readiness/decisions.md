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
asserted `curl -o … https://x` was _allowed_ (guard.rs:498-499) was updated to
assert it is now blocked — this is the intended tightening, documented in the
S-063 report. Wrapper reach (`xargs curl …`) is bounded by the same wrapper
concern handled in F1's `detect_wrapper_shell_bypass` and the `env` block, and
is noted as a residual in the report.

`docs/spec-status.md` tracked follow-up updated to record the resolution.

## D-013-16 (S-070 resolution) — Flipped via a fresh repo, not GitHub Support

The PR-ref/cached-view blocker (D-013-13) was resolved without a GitHub
Support ticket by starting the public repository fresh. The old
`airmang/DIVE` (with the pre-rewrite history, 53 PR refs, and 8 old-history
tags still reachable) was **renamed to a private archive** — preserving the
copyrighted PDFs, PR/issue history, and published Releases privately for the
owner — and a **new empty `airmang/DIVE`** was created. The already-cleaned
history (main `24dd2f1` + the filter-repo-rewritten clean tags rc.2–rc.9) was
pushed to it. The new repo therefore never had any PR refs, cached old
commits, or PDF-bearing tags: final verification shows 0 PDFs, 0 omc/omx, 0
internalized-doc objects, and 0 `refs/pull/*` reachable. This supersedes the
"GitHub Support required" path in D-013-13 — the fresh-repo route is the
self-service, deadline-safe resolution.

Residual owner notes: GitHub Releases (installers) live on the renamed
private archive, not the fresh public repo — recreate them from the pushed
tags if public installers are wanted. The private archive retains everything
else for reference.

## D-013-13 (S-070) — Public flip WAS blocked on GitHub Support (superseded by D-013-16)

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

## D-013-14 (S-070 follow-up) — OMC/OMX tooling traces purged

Owner request (2026-07-20): erase all traces of the OMC/OMX interview
tooling before the public flip. Purged the two research files
(`docs/research/omc-deep-interview-*.md`, `omx-deep-interview-*.md`) from
tree and all history (`git filter-repo --invert-paths`), redacted their
string references from retained docs' history (thesis frontmatter, round2
audit source citations, DIVE_SPEC comparison, pacemaker-talk spec line,
ui-ux audit citation) via `--replace-text` with neutral phrasing, deleted
the local `.omc/` dir, and gitignored `.omc/`/`.omx/`. Code identifiers
that merely contain the substrings (`…FromConversation`, `…FromCards`,
`domcontentloaded`) were verified false-positives and left untouched.
`origin/main` was force-pushed (`ee6ce0e…d2e6c22`) — 0 omc/omx objects
and 0 PDFs remain reachable from main. Caveat: like the PDFs, the old
omc/omx content still lives in the `refs/pull/*` PR refs and is covered by
the same GitHub Support purge required before the public flip (D-013-13).

## D-013-15 (S-070 follow-up) — Minimal-public docs cut + verify:v4 repoint

Owner decision (2026-07-20): keep the public repo to genuinely-public
documentation. Internalized (untrack + gitignore + history purge; local
copies preserved): 46 QA screenshots, docs/internal/ progress/planning,
unpublished research (thesis / ai-era direction / reproduce),
docs/archive/superpowers/plans/ + docs/archive/internal/ agent-planning
notes and internal deck, and the pilot / release-gate / research-measure /
ablation process docs. Kept public (evidence chain intact): specs/,
spec-status, the QA text findings specs cite, promoted design docs
(superpowers/specs/), legacy-specs (code-referenced), audits, user/build
docs. All CI hard-reads (verify-version-sync, verify-product-flow) and
citations (README, dive-README, AGENTS, CHANGELOG, DIVE_DECISIONS,
round2-audit-findings) that pointed at internalized docs were fixed to
neutral "internal notes (not in the public repository)" phrasing; README
release-gate markers preserved. The history purge (a third filter-repo
pass) caught old pre-2026-07-03-cleanup paths too (docs/superpowers/plans/,
root DIVE_NEXT/PROGRESS). origin/main force-pushed (`e53300a…a6bff3d`) —
0 internalized-doc objects, 0 PDFs, 0 omc/omx remain reachable from main.

Separately, the verify:v4 static-wiring verifiers (verify-product-flow +
route-chat/track-d/e/audit/quality) had drifted from the S-066/067/068
refactors — they grepped files/symbols that moved. This was missed because
per-stage CI ran the standard gates (cargo/pnpm test) but not the verify:v4
static track. Fixed by repointing (readAll() over the split files; no
check deleted, no includesAll loosened) — verify:v4 green, 0 real
product-wiring regressions found.

Same caveat as D-013-13: the internalized docs, like the PDFs and omc/omx,
still live in the `refs/pull/*` PR refs and are covered by the one GitHub
Support purge required before the public flip.

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

## D-013-17 (post-cleanup review 2026-07-22) — Two verification claims corrected

The 2026-07-22 post-cleanup re-review (`docs/qa/post-cleanup-review-2026-07-22.md`)
found that two "clean" verifications recorded above were measured too narrowly:

1. **D-013-15 "all verify:v4 hard-reads fixed" was incomplete.**
   `verify-product-flow.mjs` still hard-read an internalized conference-poster
   doc (`04-Wily-Stage-실행계획.md`), so `pnpm verify:v4` ENOENT-crashed on every
   clean checkout — red CI in `build.yml` and release-gate Gate A on the public
   repo, undetected because the owner's untracked local copy masked it. **Already
   fixed on main by `98c19db`** (removed the two conference-poster checks). No
   further code action; this entry records that the D-013-15 claim held only on
   a machine with the local copies present.

2. **D-013-14/15/16 "0 omc/omx / 0 internalized-doc objects reachable" was a
   filename check, not a directory-object check — and is FALSE for three internal
   tooling directories.** The purges targeted specific paths (`docs/research/omc-*.md`,
   PDFs, conference-poster, minimal-public docs) and those are genuinely gone
   (verified 0). But `.omc/` (25 objects incl. `project-memory.json` with the
   owner home path and the KACE interview playbook under `.omc/specs/`),
   `.sisyphus/` (13), and `.wily/` (228) were **never in any of the three
   filter-repo path lists**. All 266 objects remain reachable from the now-PUBLIC
   `origin/main` history (commit `45df0c7` tree) and from every shipped tag
   rc.2–rc.9 — reproduced with `git rev-list origin/main --objects | grep`.
   **Pending action:** the final (4th) `git filter-repo` pass MUST add
   `.omc .omx .sisyphus .wily` to its `--invert-paths` set, rewrite the tags, and
   force-push; the public force-push remains the owner's to execute. Do not
   re-trust a "0 reachable" claim that greps filenames rather than enumerating
   directory objects across all refs+tags. **Resolved by D-013-18.**

## D-013-18 (2026-07-22) — 4th filter-repo pass executed; internal dirs purged

The D-013-17(2) exposure is closed. After the post-cleanup fixes merged to
`main` (fast-forward, incl. the S-071 macOS commits), a single
`git filter-repo --invert-paths --path .omc --path .omx --path .sisyphus
--path .wily` was run on a fresh public clone (full backup bundle taken first)
and force-pushed with owner authorization:

- `origin/main` rewritten `9d4bdd5 → a5801b3`; all eight tags rc.2-internal..rc.9
  rewritten; the stale already-merged `071-macos-distribution` branch (which
  still carried pre-rewrite history) deleted from origin.
- Verified from a fresh `git clone`: **0 objects** for each of
  `.omc`/`.omx`/`.sisyphus`/`.wily` across `main` + all tags; prior purges
  (references-pdf, omc/omx research) still 0; `refs/pull/*` = 0 (fresh repo, so
  no GitHub Support ticket was needed — the D-013-13/16 PR-ref caveat does not
  apply here); `.git` 44M → 7.6M. HEAD tree hash unchanged (`7b8cc3d…`) — no
  current content was lost, only history objects removed.
- The working clone was re-synced (`reset --hard origin/main`, stale local
  branches/tags force-updated). Backup: scratchpad
  `dive-pre-omc-purge-backup.bundle` (all refs, pre-rewrite).

Residual (accepted, same as every prior rewrite): GitHub may keep unreachable
old objects server-side until it GCs; they are not clone/PR-reachable. This was
the last public-exposure blocker from the 2026-07-22 re-review.

## D-013-19 (2026-07-22) — P2 backlog sweep + dead-code dispositions

The 45-item P2 backlog from the re-review (`docs/qa/post-cleanup-review-2026-07-22.md`)
was swept: 2 were already resolved by the P1 verify-panel fix
(reopen-refires-eval, stepper-remount), 43 were fixed across 11 file-disjoint
groups (correctness/race guards, locale threading, transactions, security
defense-in-depth, dead-struct deletion, verifier hardening), and the full gate
is green (cargo fmt/clippy/test + FE typecheck/lint/616 tests + verify:v4 46).
Notable dispositions (kept, not changed, with rationale):

- **Two cross-cutting dead-code items were NOT removed.** `caller-less
registered IPC commands` (ai_assist_cards, card_list, codex_oauth_refresh,
  mcp_server_list_tools, mcp_server_set_enabled, preview_start, project_get) and
  `emitted events without a current listener` (checkpoint_created,
  verify_started/done, codex://oauth-complete/error) are **kept**: deleting a
  registered command or an emit is spread across lib.rs + several impl files and
  risks a non-obvious caller, an audit/EventLog record, or a future listener,
  for near-zero external-perception value. Recorded here as a deliberate
  keep-and-disposition rather than a risky release-branch deletion.
- **ToolCall table (no production writers)** — kept; a `//!` doc note now marks
  the DAO as legacy/reserved (approvals are already recorded in EventLog +
  Message.tool_calls; the export's structured tool_call section is simply empty).
  A future decision can make the runtime write ToolCall rows or retire the table.
- **plan-events-null-session** — fixed forward (events now stamp the project's
  session id so the session-scoped export reaches them); already-persisted
  NULL-session rows are not retroactively migrated (would need a data migration).
- **Residuals flagged for later, not release-gating**: `looks_secret_like` now
  duplicates the EventLog `SECRET_RE` pattern in prd_patch.rs (a shared helper
  across the module boundary is the eventual cleanup); `verify-product-flow.mjs`'s
  judgment-gate check still matches "ApprovalJudgment" via the surviving
  type-only import after the dead component body was removed (pre-existing static
  tautology, same class as D-013-15); the `.mjs` ESLint block is a curated
  definite-bug subset, widenable toward `js.configs.recommended` once
  no-empty/no-undef/no-unused-vars are cleaned across the .mjs tree.
