# S-038 — Preview discoverability, onboarding & per-project mode memory (009 theme 10) — stage spec/plan

**Wily Stage**: S-038 (`STG-5f97b428a8f1`, project `dive-2`). Status `draft` →
claimed by root. **Scope**: `dive/src/components/slide-in/**`,
`dive/src/stores/**`, `dive/src-tauri/src/ipc/preview.rs` (reason-codes only),
i18n. Root owns the Wily lifecycle.

**Spec**: [`spec.md`](spec.md) theme 10 — "Static-vs-server preview
discoverability & onboarding."

**Key finding (canon-checked design)**: pure UX layered on the DONE S-031 preview
engine — but it surfaced a **hidden P0**: the backend Auto heuristic
(index.html→static, else dev-server; preview.rs:327-396) is correct but
**unreachable** because `autoConnect()` hardcodes `openPreview("dev_server")`
(PreviewTab.tsx:219-233), so a single-index.html project always fails with raw
Korean `detect_package_info` strings. The static-vs-server mode is already a
deterministic post-resolution field (`PreviewOpenResponse.kind` crosses IPC) but
is never stored in `PreviewSessionState`, so the UI can't surface a hint
(zero-backend-logic projection). No per-project preview state persists; no
onboarding affordance exists.

**Adopted decisions** (design recommendations; no owner-blocking product call):
(1) STYLED-02: default **static + dismissible `warn_unbuilt_toolchain`** with
dev_server as a one-click affordance (lowest friction, non-blocking); (2)
coachmark **default ON** via `tutorialEnabled` (one-time, dismissible,
double-gated by classroom/expert mode); (3) per-project memory keyed by
**`currentProjectId`** (matches the established id-keyed idiom). Proceed
autonomously per the standing directive.

## Acceptance

1. A first-time student presses ONE primary action ("Show my result") that calls
   `openPreview('auto')`, exposing the existing backend Auto heuristic; the 3
   legacy mechanisms remain available but demoted under a collapsible "Other ways
   to preview" disclosure (existing data-testids preserved).
2. Empty-state copy is reworded plain, names both modes, states nothing runs
   until click (008 FR-014 — not implying preview proves a criterion); the 3 raw
   Korean `detect_package_info` errors become reason codes
   (`missing_package_json` / `missing_dev_or_start_script`) translated via
   `slide_in.preview.reason.*` (en+ko).
3. A non-blocking mode badge renders from `PreviewSessionState.kind` (threaded
   from `response.kind`, post-resolution): `static_file`→"Static file preview",
   `local_url|dev_server`→"Dev-server preview".
4. A first-run onboarding coachmark (anchored to the Preview empty state) renders
   only when `tutorialEnabled && !previewOnboardingDismissed`, explains
   static-vs-server, reinforces "DIVE shows the result; the **human** confirms it
   works, not the AI" (008 FR-013/014), is inline + dismissible
   (`preview-onboarding-dismiss`), persists the dismissal through the store, and
   is NOT a modal.
5. On successful `preview_open` the resolved `{kind,lastUrl}` is written keyed by
   `currentProjectId` into a persisted `previewModeByProject` map; on Preview tab
   mount the remembered entry pre-fills/pre-selects + offers a single "Reopen last
   preview" — **defaults-only, no auto-open, no pre-satisfied gate**, dev URLs
   re-probed.
6. All new strings via i18n en+ko under `slide_in.preview.*` (no hardcoded
   Hangul, S-030 ESLint green); existing `slide_in.preview.reason.*` reused.
7. The S-031 execution engine is untouched and Preview is never presented as
   verification evidence; full local CI green; INTERACTIVE-01 re-run live on the
   release `.app` in ko + en (deferred per live-QA caveat).

## Gaps closed

| Gap | Sev | Summary |
| --- | --- | --- |
| INTERACTIVE-01 (Auto unreachable) | **P0** | `autoConnect()` hardcodes `openPreview('dev_server')`; single-index.html projects always fail with raw Korean errors. Route the primary action to `openPreview('auto')` + add a plain "Show my result"; reason-code the 3 Korean strings. |
| INTERACTIVE-01 (wrong mental model) | P1 | Empty-state copy leads with dev-server framing. Reword static-first, name both modes, state nothing runs until click; add the mode-hint badge from `response.kind`. |
| INTERACTIVE-01 cross (no onboarding) | P2 | No first-run coachmark. Add a dismissible, `tutorialEnabled`-gated, persisted-once coachmark reinforcing 008 FR-013/014. |
| Per-project state forgotten | P2 | Mode/URL forgotten across restarts/switches. Add a defaults-only `previewModeByProject` map in ui-preferences keyed by `currentProjectId`. |
| STYLED-02 (Tailwind static no-op) | P2 | Previewing raw index.html for a React/Tailwind project serves unbuilt source so Tailwind/responsive classes silently no-op. Default static + dismissible `warn_unbuilt_toolchain`, dev_server one-click. |

## Confirmed touch points

- `dive/src/components/slide-in/PreviewTab.tsx` — `autoConnect()`→`openPreview('auto')`; "Show my result" primary; demote 3 legacy mechanisms under a disclosure (preserve testids `preview-static-candidate`/`preview-candidate`/`preview-static-path-input`/`preview-static-path-open`); thread `result.kind` into session + mode hint; mount coachmark + per-project pre-fill/reopen.
- `dive/src/components/slide-in/types.ts` — add `kind?: 'static_file'|'local_url'|'dev_server'` to `PreviewSessionState` (~27-36).
- `dive/src/stores/slideIn.ts` — carry `kind` through `setPreviewSession` (~105-109); store stays **non-persisted**.
- `dive/src/stores/ui-preferences.ts` — add persisted `previewModeByProject` map + `setProjectPreviewMode`, `previewOnboardingDismissed` (default false) + `dismissPreviewOnboarding`; normalize + **version 1→2 migrate**.
- `dive/src/stores/project-session.ts` — `currentProjectId` (~139), read-only.
- **NEW** `dive/src/components/slide-in/PreviewOnboardingCoachmark.tsx` — gated, dismiss testid `preview-onboarding-dismiss`.
- `dive/src-tauri/src/ipc/preview.rs` — reason-code the 3 Korean `detect_package_info` strings (~1022-1043; `failed_preview_response` ~871); owner-adopted Auto static-default refinement (~327). **Do NOT touch the static server / sandbox flags / viewport toolbar / reload.**
- `dive/src/i18n/{en,ko}.json` — reword `slide_in.preview.empty_*`; add `show_result`, mode-hint keys, `onboarding.*`, `reopen_last`, `other_ways` label, `reason.missing_package_json`, `reason.missing_dev_or_start_script`, `warn_unbuilt_toolchain`.
- Tests: `PreviewTab.test.tsx`, `ui-preferences.test.ts`, NEW `PreviewOnboardingCoachmark.test.tsx`, `preview.rs` unit tests.

## Non-goals / boundary

- Do NOT modify the **S-031 preview execution engine**: static loopback server,
  `allow-modals/allow-forms` sandbox flags, responsive viewport toolbar, reload.
  STYLED-02 is candidate-selection + a copy warning only.
- Do NOT present Preview as **verification evidence** (008 FR-013/014): the mode
  hint, coachmark, and per-project memory are inspection/defaulting surfaces —
  none may pre-mark evidence, auto-confirm a criterion, or auto-open a preview.
- Do NOT add a **Project DB column / migration** — client-side ui-preferences
  persistence only. Do NOT persist live `PreviewSessionState` (stale URLs/ports)
  or add persist middleware to `slideIn.ts`.
- Do NOT re-do S-029 / S-030. Onboarding is never a modal wall.

## Regression guards

- Existing demoted-mechanism testids remain; `PreviewTab.test.tsx` stays green;
  `applyPreviewResponse` keeps handling the Auto response generically off
  `result.status`/`result.kind`.
- Mode hint derives from `response.kind` (post-Auto-rewrite), never request kind
  — locked by a test (auto request → static_file → static hint).
- Coachmark dismissal persists through the store (not useState) and survives
  `persist.rehydrate()`; `tutorialEnabled=false` suppresses regardless (double-gate).
- ui-preferences version 1→2 migration: old payload rehydrates with defaults
  filled + existing fields surviving; malformed `previewModeByProject` entry
  dropped without throwing; two project ids independent.
- Per-project memory never auto-opens / never pre-satisfies a gate; remembered
  dev URLs re-probed. `slideIn.ts` stays non-persisted; S-029/S-030 + existing
  `slide_in.preview.reason.*` keys untouched.

## Phase plan (= Wily phases; Codex work orders)

| Phase | Scope | Gaps |
| --- | --- | --- |
| **P0 Foundation** | Read-only confirm seams (Auto arm correct+unreachable; `PreviewOpenResponse.kind` un-stored; ui-preferences migrate/merge seam; `currentProjectId` durable; S-031/S-029/S-030 intact). No behavior change. | seams |
| **P1 Correct preview defaults** *(load-bearing, P0 fix)* | `autoConnect()`→`openPreview('auto')` + "Show my result" primary; demote legacy under "Other ways to preview" disclosure (preserve testids); reword empty-state static-first; reason-code the 3 Korean `detect_package_info` errors (`missing_package_json`/`missing_dev_or_start_script`) → `failed_preview_response.reason_code` + `slide_in.preview.reason.*`. | INTERACTIVE-01 P0/P1 |
| **P2 Mode hint** | Add `kind` to `PreviewSessionState`; thread `response.kind` through `setPreviewSession`; pure `previewModeHint(kind)`; non-blocking badge + one-line empty-state explainer (reads post-resolution kind). | INTERACTIVE-01 P1 |
| **P3 Onboarding coachmark** | NEW `PreviewOnboardingCoachmark` gated on `tutorialEnabled && !previewOnboardingDismissed`; persisted `previewOnboardingDismissed` + `dismissPreviewOnboarding`; inline/dismissible, reuse LearningHint tokens; 008 FR-013/014 copy; en+ko. | onboarding |
| **P4 Per-project memory** | Persisted `previewModeByProject: Record<number,{kind,lastUrl?}>` + `setProjectPreviewMode` keyed by `currentProjectId`; write on successful `preview_open`; read on mount → pre-fill + "Reopen last preview"; version 1→2 migrate + normalize. Defaults-only, re-probe dev URLs, no auto-open. | theme-10 (c) |
| **P5 STYLED-02 + integration** | Auto refinement: index.html + Tailwind/framework signal ⇒ default static + dismissible `warn_unbuilt_toolchain` with one-click dev_server (candidate-selection only, no engine change). Full local CI + adversarial review; live INTERACTIVE-01 ko+en (deferred). | STYLED-02, integration |

## Validation loop / Codex handoff

Same as prior stages. Likely **2-3 Codex passes**: (A) P1+P2 (preview defaults +
mode hint, frontend + preview.rs reason-codes); (B) P3+P4 (coachmark +
per-project memory, ui-preferences + new component); (C) P5 (STYLED-02, optional/
lighter). Root owns Wily lifecycle + verification + PR + merge; Codex implements
per boundary (no S-031 engine change, no DB column, no evidence pre-marking,
non-blocking). Per-phase: raw `codex exec --dangerously-bypass-approvals-and-
sandbox` in primary (no git) → root re-runs gates + commits → adversarial review
→ PR → merge → Wily complete.
