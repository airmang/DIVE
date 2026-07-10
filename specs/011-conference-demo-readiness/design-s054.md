# S-054 Design — Release Gate Restoration (011 Theme 5, P1-04)

**Stage**: wily `dive-2` S-054 (STG-34678ea2f4b6) · **Status**: Designed 2026-07-11
**Evidence**: read-only investigation 2026-07-11 (agent report; key refs inline
below). Headline: of the five failing verifier items, **four are verifier
false-negatives** (scripts grep files that became re-export shells/thin
wrappers after refactors), one is a genuine product gap (no resume affordance
on rate-limit-blocked steps), and the initial-chunk budget failure is a real
regression shared by two verifiers. **None of the three verifiers run in CI**
— they were manual-only, which is how the drift went unnoticed.

## Decisions

### D1 — Repoint stale verifier targets (no product change)

- `verify-audit-fixes.mjs:34` `ipc` target: `src-tauri/src/ipc/mod.rs` (a
  re-export shell) → `ipc/chat.rs`, where
  `mark_step_blocked_after_recoverable_error` actually lives (defined
  chat.rs:809, wired :801, detects 429/quota/rate-limit :815-820, persists
  blocked :833, logs :840-853).
- `verify-quality-followup.mjs:46` `ipc` target → `ipc/state.rs`
  (`DIVE_QA_APP_DATA_DIR` override at state.rs:383; telemetry half at
  telemetry.rs:36 already passes). **QA app-data isolation is already
  implemented** — set `DIVE_QA_APP_DATA_DIR` and both state and logs
  redirect; S-057's clean-E2E runs use exactly this.
- `verify-audit-fixes.mjs:33` `roadmapRail` target: `RoadmapRail.tsx` (now a
  thin wrapper) → `src/components/plan/PlanStepActions.tsx` where step
  actions actually render.

### D2 — Product fix: resume affordance for rate-limit-blocked steps

`PlanStepActions.tsx` has no `blocked` branch — a rate-limit-blocked step
falls through to the disabled "locked" button and `PlanStep.tsx:88` makes the
row non-clickable. **Complication**: `blocked` is overloaded —
dependency-locked steps (no mapping) vs rate-limit-blocked steps (mapping
with session, `usePlanRoadmap.ts:104`). Discriminator:
`item.mapping?.session_id != null` → render a resume/retry button wired to
the existing `onResume(sessionId)` path; no mapping → keep the locked
rendering. Row actionability in `PlanStep.tsx` follows the same
discriminator. Live-event push for the blocked transition stays out of scope
(state already surfaces on roadmap refresh); note as future polish.

### D3 — Initial chunk under budget, one canonical number

- Real regression: `dist/assets/index-*.js` = 548,686 B against gates of
  512,000 B (`route-chat-cancel`:190) and 532,480 B
  (`quality-followup`:139-144, mislabeled "534KB baseline").
- Primary lever: **stop statically importing both locale JSONs**
  (`src/i18n/index.ts:14-15` pulls ko.json 109 KB + en.json 97 KB into the
  entry). Eagerly load only the detected locale, dynamic-import the other on
  first use/switch (async hydration into the zustand store; startup stays
  synchronous for the active locale). Sheds ~97-100 KB — clears both gates
  with margin.
- Secondary: investigate why the intended `vendor-icons` manualChunk
  (vite.config.ts:18) emits nothing while 67 lucide-react import sites land
  in index; fix if cheap, else record findings.
- **Canonical budget = 500 KiB (512,000 B)** in BOTH verifiers, labels
  matching the constant exactly (fixes the "534KB baseline" copy mismatch).

### D4 — The verifiers join CI

Extend `scripts/verify-v4-all.mjs` (already run by release-gate.yml:53-54 and
build.yml:40) to chain `verify:audit-fixes`, `verify:quality-followup`, and
`verify:route-chat-cancel-quality`. No workflow-file changes needed (avoids
the workflow-scope push restriction); the three verifiers become release-
gating so target drift like this fails CI instead of rotting silently.

## Non-goals / preserve

- No weakening of any verifier check: targets are repointed to where the
  behavior moved, never deleted. The two chunk gates converge to the stricter
  number.
- Locale switch behavior must stay correct offline (both locales are still
  bundled — the non-active one becomes an async chunk, not a network fetch).
- No workflow YAML edits. No new blocking UI. Dependency-locked steps keep
  their current locked rendering.

## Acceptance mapping

1. `verify:audit-fixes` 19/19, `verify:quality-followup` 23/23,
   `verify:route-chat-cancel-quality` 31/31 — run locally, outputs quoted.
2. Production build initial chunk < 512,000 B (raw bytes, index-*.js).
3. Rate-limit-blocked step (mapping present) shows a working resume action;
   dependency-locked step unchanged — component tests.
4. `DIVE_QA_APP_DATA_DIR` isolation proven by the repointed verifier + the
   existing implementation (state.rs:383, telemetry.rs:36).
5. verify-v4-all chains the three verifiers; full local CI green.

## Phases

- **P1**: D1 + D2 + D4 (verifier repoints, blocked-resume branch, CI chain).
- **P2**: D3 (locale lazy-split + vendor-icons investigation + budget
  unification) — separate phase so the chunk work can't mask a P1 failure.
- **P3**: local CI + verifier runs + rebuild; live re-QA rides the tier-1
  combined session (resume affordance is checkable in QA if a rate-limit
  occurs; otherwise component tests + verifier evidence suffice per report).
