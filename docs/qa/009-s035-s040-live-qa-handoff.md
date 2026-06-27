# 009 Hardening (S-035–S-040) — Live QA Handoff (for Codex)

**Status**: all six stages are **code-complete and merged to `main`** (PRs #48–#53).
Automated gates + multi-lens adversarial review were the merge bar; the one thing
**deferred for every stage** is the **built-`.app` ko/en live QA**. This doc is the
self-contained brief to run it.

## 0. Scope & ground truth
- Read `.specify/memory/constitution.md`, `AGENTS.md`, `docs/spec-status.md` first.
- Per-stage acceptance + journeys live in `specs/009-e2e-quality-hardening/s0{35..40}-*.md`.
- Journey definitions + gap IDs: `docs/qa/e2e-journeys.md` (50 journeys) and
  `docs/qa/e2e-gap-backlog.md` (127 gaps / 12 themes). The "Recommended live-run
  subset" in the gap backlog is the priority set.
- **Verify against source before logging any defect** — the visual-QA loop has
  produced false positives from harness flakiness, not real bugs.

## 1. Build & launch (do NOT use `tauri dev`)
- Build the **release app**: `cd dive && pnpm tauri build --bundles app` (dev mode
  has no sandboxed window / LaunchServices registration and re-prompts the keychain
  every build).
- **Keychain**: use the **file-secret backend** (launchctl + LaunchAgent) so the
  provider secret persists across launches instead of re-prompting per build
  (owner directive 2026-06-24). The connected-provider smoke needs a real
  provider key in that backend.
- Drive with computer-use on the built `.app`. **Run every check in BOTH `ko` and
  `en` locales** (switch locale in app settings / i18n).

## 2. QA harness gotchas (observed)
- Action buttons occasionally don't fire on the first click — retry via keyboard
  (Enter/Space) or a second click before concluding "doesn't work".
- If something looks broken, **diff it against the merged source** for that stage
  before recording a defect (avoid false positives).
- Record results under `docs/qa/` (extend the existing catalog / defect-log /
  run-log shape, e.g. a `009-live-qa-run-log.md`).

## 3. Per-stage live checks (ko + en each)

### S-035 — PRD/Socratic interview (PR #48) · spec: s035-prd-interview-scaffolding.md
- A vague PRD ("make it nice") is **blocked before insert** → routed to the
  recovery screen as `vague_criteria`, missing items listed; never accepted "ready".
- A UI goal missing responsive/persistence/a11y, and a data-fetch goal missing
  loading/empty/error, are blocked naming the missing classes/states.
- The "N more quick questions" chip + pending skeleton appear; chip never disables
  submit. English vague input surfaces ambiguity hints under `en`.
- A static front-end step gets `verification_type` preview/manual with **no** bogus
  command. (Quick-intake form ships **behind a default-OFF flag** — not visible by
  default; only verify if you flip `quickIntakeEnabled`.)

### S-036 — stepper honest-completion + verify/assist locale (PR #49) · s036-*
- Navigating the verify stepper with **no evidence** shows a neutral "visited"
  marker, **not** a green check; the green check appears only with real S-029
  evidence. Navigation stays free; approve stays blocked until `card.state==='verified'`.
- Under `en` locale, the **V-stage self-verify** and **D-stage decomposition** output
  is **English** (no forced Korean). The live SupervisorAgent provocation question
  also respects locale.

### S-037 — execution scope-drift / high-risk-file gate (PR #50) · s037-*
- During an approved step, edit a high-risk file (e.g. `.env`, a lockfile, a CI
  file) **outside** the step's expected files → a **non-blocking** written-risk
  reason (`high_risk_unexpected_files`) appears with the drifted paths. It must NOT
  hard-block Approve; a high-risk file **in** expected files must NOT fire it.

### S-038 — preview discoverability/onboarding/memory (PR #51) · s038-*
- A single-`index.html` project: the primary "Show my result" (auto) renders it
  (the old dev-server-only failure is gone). A non-blocking mode badge shows
  "Static file preview" vs "Dev-server preview" matching what actually rendered.
- First-run onboarding coachmark appears (tutorial mode), dismissible and stays
  dismissed. Reopening a project pre-fills the remembered preview mode + offers
  "Reopen last preview" — but **never auto-opens** and never marks a criterion verified.

### S-039 — refactor/rename safety + multi_replace (PR #52) · s039-*
- A cross-file rename via the agent uses **one** `multi_replace` approval card
  showing the full multi-file blast radius (per-file diffs); it applies atomically.
- A replacement that writes a secret into any file escalates the card to Danger.
  `multi_replace` is blocked in plan-first/build mode until an approved step exists.
- On a rename/refactor step, the agent prompt pushes "move verbatim"; a pure rename
  with no evidence yields the behavior-preserving DiffReady provocation (non-blocking).
- Search returns no vendor-dir (`node_modules` etc.) noise by default.

### S-040 — coach locale + deterministic fallback (PR #53) · s040-*
- Under `en`, live coach guidance is **English**. Force the coach **Unavailable**
  (sidecar down / no credentials): a clearly-labeled **"offline fallback — not the
  AI coach"** per-criterion checklist appears (resize-to-375px, reload, tab/ARIA,
  loading/empty/error, etc.). **Critical**: with only the fallback shown, **Approve
  stays disabled** (the fallback must never satisfy the S-029 observation gate).

## 4. Known deferred items — do NOT log as new bugs
- **S-038 STYLED-02**: no Tailwind-unbuilt warning yet (mode hint conveys static-vs-server).
- **S-038**: 2 pre-existing Korean preview "server reused" success logs (i18n follow-up; tracked).
- **S-039**: `multi_replace` glob-TOCTOU secret-scan escalation hardening (tracked task).
- **S-039**: zero-match `path_glob` shows an empty diff entry; no aggregate "Explain" on multi cards (cosmetic).

## 5. Output
For each stage × locale: PASS / FAIL (with a source-verified repro) / N-A. File real
defects as new gap entries; note any that reproduce in only one locale. The
hardening program is shipped — this pass is the live confirmation, not a gate to merge.
