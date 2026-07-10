# Feature Specification: Conference Demo Readiness (Round 3)

**Feature Branch**: `011-conference-demo-readiness`

**Created**: 2026-07-10

**Status**: Approved (owner, 2026-07-10 — full scope tiers 1–3, Windows demo machine, spec-kit + wily loop)

**Input**: Conference-readiness comprehensive QA on the macOS arm64 release app +
current `main` (rc.8, post-010). Verdict: **unscripted new-user live demo NO-GO**;
the approved-project supervised loop (permission → edit → preview → review → 3/3
complete) passes live. Evidence:
[`docs/qa/conference-readiness-2026-07-10/report.md`](../../docs/qa/conference-readiness-2026-07-10/report.md)
(2 P0 / 5 P1 / 6 P2, 18 screenshots).

**Deadline anchor**: 2026-08-14 conference presentation (Busan). **The on-site demo
machine is Windows** (owner decision 2026-07-10), which promotes the Windows
installed-app smoke from release hygiene to demo-critical.

## Context And Why

010 (S-041–S-049) hardened beginner readiness and rc.8 shipped. The conference QA
adds a third lens: **can DIVE survive an unscripted live demo in front of an
academic audience?** The answer today is no, for two reasons that are narrower —
and therefore more fixable — than the 010 findings:

- **The new-user path is blocked at plan generation.** The plan quality gate
  rejects reasonable novice plans across 3 models and a PRD v2 rewrite, and the
  recovery guidance it shows does not itself pass the validator (P0-01). Upstream
  of that, the model the UI happily offers (`openrouter/anthropic/claude-sonnet-5`)
  is not executable by the Pi sidecar, and the failure is swallowed silently
  (P0-02). A new user cannot reach implementation at all.
- **Success is reported as failure.** After a fully successful supervised edit,
  a false stall-timeout error appears twice (P1-01); a detailed PRD interview
  answer silently fails to become a patch with no cause or recovery (P1-02); and
  manually-authored PRD fields are attributed to the AI (P1-03) — which for a
  research artifact that separates human editing from AI inference is a
  thesis-level data-integrity defect, not cosmetics.

Owner decisions (2026-07-10): full scope (report tiers 1–3), Windows on-site demo
machine, spec-kit + wily 정공법 (umbrella spec 011, stages continue from S-049).

## Requirements *(prioritized themes → proposed Stages)*

### Theme 1 — Plan-generation quality gate un-block → Stage **S-050** (P0-01, absorbs P2-05 recovery copy)

`workspace_plan.rs:4918-4945` escalates a single criterion's phrasing miss to a
whole-plan rejection; `plan_quality_constants.rs:176-189` classifies any goal
containing `화면`/`버튼` as a UI goal and demands responsive/persistence/
accessibility criteria; the error screen's own suggested fix (`CSS .done {
text-decoration: line-through }`) is not in `criterion_has_observable_marker`'s
allowed markers. Work:

- Evaluate the criterion *set* (global bundle sufficiency) instead of vetoing the
  whole plan on one criterion's marker miss; narrow the UI-goal keyword
  classification to real requirement categories.
- **Regression test: every recovery example the error screen offers must pass the
  validator it recovers from.** This is the self-consistency lock.
- Korean-locale recovery copy for Korean input (P2-05's plan-recovery half; the
  rest of P2-05 rides S-043's existing i18n machinery).
- **Governance first**: `plan_quality_constants.rs` carries no spec reference —
  S-050 design must identify which spec/decisions own this gate (009 quality
  iteration vs S-049 form-consistency lineage), and record the loosening as a
  decisions.md entry *before* implementation (AGENTS.md Rule For Agents). The
  gate is being re-tuned, not removed.

### Theme 2 — Provider+model ↔ Pi executability preflight → Stage **S-051** (P0-02, absorbs P2-02 curation)

Capability checks are provider-granular (`pi_sidecar/parity.rs:18-42`) while the
sidecar rejects unregistered models only at run time
(`pi-sidecar/src/index.mjs:163-167`); `ProviderModelSelector.tsx` surfaces the
whole live OpenRouter catalog with no Pi-executability signal. Work:

- Validate the `provider + model` pair at save time or in a run preflight; show
  unsupported models as `Pi 미지원` (or filter), with a one-click switch-to-
  compatible-model CTA on failure.
- Stop swallowing plan-generation launch errors: surface cause + recovery action
  instead of silently returning to the PRD screen.
- Beginner curation (P2-02): recommended/verified model group with cost/speed/Pi
  status, default recommendation on top; the raw catalog stays reachable.
- **Cross-check rc.7** (`4a97d10`, live OpenRouter catalog + Sonnet 5): Sonnet 5
  was supposedly registered "OR + native + frontend", yet the sidecar rejected
  `openrouter/anthropic/claude-sonnet-5` — establish whether this is a
  registration gap or a regression before designing the preflight. Note: sidecar
  model-registry parity checks are local; the provider `/models` catalog fetch is
  already ruled app-level connectivity, not agent egress (S-048 scope).

### Theme 3 — Post-success truthfulness: stall-timeout false errors → Stage **S-052** (P1-01)

`useChatSession.ts:720-730` clears the stall timer on some terminal events but
later events re-arm it; the 45 s timer at `:590-595` appends an error without
checking that the run already terminated successfully. Work: preserve per-run
terminal state; telemetry/progress arriving after a terminal event must never
re-arm the stall timer; dedupe error emission per run ID; unit tests for the
re-arm and duplicate paths. This is the single most visible trust defect for a
live audience.

### Theme 4 — PRD interview transparency + provenance integrity → Stage **S-053** (P1-02, P1-03)

Same surface, two defects. (a) `workspace_plan.rs:2474-2502` collapses
no-patch/JSON-parse-failure/policy-rejection into `patch: None`, and
`PrdAuthoringBoard.tsx:602-606` renders them all as the same rejection line —
distinguish the three causes, preserve the student's original answer, offer a
"다시 구조화" retry, and add a provider integration test that one detailed Korean
answer becomes a real patch. (b) Field-level provenance: record `student` /
`AI patch` / `AI suggestion accepted` per PRD field, reflect it in the review-card
copy and EventLog/export. Provenance is Constitution IV territory and directly
supports the conference paper's logging-architecture contribution — human edits
must never be exported as AI summarization.

### Theme 5 — Release gate restoration → Stage **S-054** (P1-04)

Five failing verifier items across three scripts: `verify:audit-fixes` (quota/
rate-limit → active step blocked transition; resume action), `verify:quality-
followup` (`DIVE_QA_APP_DATA_DIR` isolation unimplemented; initial chunk budget),
`verify:route-chat-cancel-quality` (initial chunk 500 KiB). Work: wire rate-limit
recovery state into the product; implement QA app-data isolation (also feeds
S-057's clean-app-data runs and P2-06's demo decluttering); route/code-split the
initial chunk from 535,278 B to < 500 KiB; fix the verifier copy/threshold
mismatch ("previous 534KB baseline" vs actual `520 * 1024`).

### Theme 6 — Windows installed-app demo readiness → Stage **S-055** (P1-05, **demo-critical**)

The on-site machine is Windows; nothing about the installed Windows app is
currently proven. Work: NSIS x64 (and ARM64 if the venue machine warrants)
install/run smoke on a Windows runner or real hardware — install, first launch,
WebView2/EdgeDriver, provider setup, new project, recovery/re-run — plus a
demo-condition pass (projector resolution, Korean locale, keyboard). Depends on
S-054 (release gate green unblocks `build-windows`/`release-gate`; see project
memory: the two env-dependent `verification_coach` tests were the historical
blocker). No security/egress posture may be weakened to make installs pass.

### Theme 7 — Demo UX polish → Stage **S-056** (P2-01, P2-03, P2-04, P2-06)

- P2-01: split "no session yet" empty-state copy from active-session
  history-loading state.
- P2-03: plan-step overlap — include expected changed files and non-duplicative
  acceptance criteria in plan validation. **Additive gate: lands only after
  S-050's loosening, with the same self-consistency lock (recovery guidance must
  pass its own validator) so it cannot recreate the P0-01 blocking pattern.**
- P2-04: allow linking one preview observation to multiple acceptance criteria
  ("이번 관찰을 관련 기준 모두에 적용") to cut review friction without weakening
  the evidence model.
- P2-06: sidebar decluttering for the demo — recent/pinned/archived or a clean
  demo workspace; QA projects hidden (rides S-054's app-data isolation).

### Theme 8 — GO judgment + presentation fallback package → Stage **S-057** (ops + exit gate)

- **Round exit gate (from the report)**: on a completely fresh app-data
  directory, new project → PRD → plan → 3-step implementation complete, **3
  consecutive runs, 0 false errors** — on the macOS release app and on the
  installed Windows demo build. Only then does the report verdict flip to GO.
- **Fallback regardless of GO**: an already-approved local project
  (`live-interactive-01` style) + Pi-verified pinned model + static HTML app;
  a short recording of the full journey; a run-of-show with network/model
  failure contingencies. The demo must survive even if P0 fixes slip.

## Non-Goals / Preserve (regression guards — do NOT "fix")

- Constitution guards stand: no static fallback, no quizzes/badges/decks, review
  cards non-blocking and evidence-grounded, AI self-report ≠ verification
  evidence, local-first logging/export.
- S-050 re-tunes the plan quality gate; it does not remove plan validation. The
  goal is that reasonable novice plans pass and blocked users always get
  recovery guidance that itself passes — not an ungated planner.
- Preserve 009/010 guarantees: offline verify-provocation, Danger read-gates,
  ko/en key parity, S-048 egress posture (`web_fetch` SSRF validation, GET/https
  only, bounded). S-051's preflight and S-055's smoke must not loosen any of it.
- The report's PASS journeys (permission gate, preview, review/approve, 3/3
  completion) are the demo's backbone — no behavioral regressions there.
- Do not re-open the 13 findings dropped by the 010 adversarial pass.

## Validation

Each Stage: design → implement → local CI gates (`cargo fmt --check`, `clippy
--all-targets --features dev-mock -- -D warnings`, `cargo test --all-targets
--features dev-mock`; frontend `format:check` / `typecheck` / `lint` /
`test:unit`) → rebuild → **live re-QA on the release `.app`** (macOS
computer-use; dev-mode is not acceptable for live QA per project memory).
S-055 additionally requires a Windows runner or real hardware. Deterministic
gates, preflight logic, timer state machines, provenance, and i18n copy get
unit/integration tests; the self-consistency lock (recovery examples pass their
validator) is a named regression suite.

**Open dependency**: the Windows smoke driver (GitHub `build-windows` runner
artifact vs. real hardware at the venue) must be resolved at S-055 design; CI
dispatch requires green CI first (S-054).

## Tracking

- wily project `dive-2`. Themes 1–8 map to Stages **S-050 – S-057**, registered
  2026-07-10 on owner approval, continuing the S-041–S-049 numbering from
  round 2 (010).
- Loop per Stage: design → plan → implement → local CI → rebuild → live re-QA →
  verify → complete.
- Absorbed P2s: P2-05 (plan-recovery Korean copy) → S-050; P2-02 (model
  curation) → S-051. All six report P2s are therefore covered by S-050/S-051/
  S-056.
