# S-056 Design — Demo UX Polish (011 Theme 7, P2-01/03/04/06)

**Stage**: wily `dive-2` S-056 (STG-6046a7378a89) · **Status**: Designed 2026-07-11
**Evidence**: read-only investigation 2026-07-11 (refs inline). Owner scope is
full tiers 1–3, so the durable P2-06 archive feature is IN; search box /
separate-workspace concepts (L) are OUT.

## Decisions

### D1 (P2-01) — Honest "session starting" state — S

`deriveEmptyState` (`productShellConversationLogic.ts:138-161`) branches only
on project/session presence, so an active session with zero messages falls to
ChatArea's fallback "세션을 시작해 대화를 시작하세요" (`ChatArea.tsx:336`,
`chat.empty_default_title`). Fix: a dedicated "세션이 시작됐어요 — 첫
대화를 기다리는 중" variant when `currentSessionId !== null && messages.length
=== 0 && !loadingHistory` (new i18n key `chat.empty_session_starting.*`),
plus let the existing `MessageHistorySkeleton` branch (`ChatArea.tsx:322`)
cover the loading window. Frontend-only.

### D2 (P2-03) — Step-overlap advisories on the S-050 channel — M

Per D-011-01 (hard constraint): advisory-first + self-pass lock, never a new
blocking error. Two deterministic cross-step sub-checks appended inside
`validate_criterion_quality` just before the marker-less collection
(`workspace_plan.rs:~5268`), pushing onto the existing `advisories` vec:

- `step_expected_file_overlap` — the same normalized `expected_files` entry
  appears in ≥2 steps (preview = the path, step_ref = the later step).
- `step_criterion_duplicate` — near-duplicate acceptance criteria across
  different steps (normalized via the existing quality-text normalizer;
  exact-match after normalization only — no fuzzy scoring, to keep
  false-positive risk near zero for legitimate multi-touch steps).

Both ride `CriterionQualityAdvisory` → `plan.criterion_quality_advisory`
EventLog (no new IPC/event type). Self-pass lock: a named regression suite
asserting (a) the S-050 QA-repro plan and the recovery examples produce ZERO
overlap advisories, and (b) known-overlap fixtures produce exactly the
expected ones. i18n keys for the two advisory codes (frontend already renders
these annotations generically — verify and extend copy keys only).

### D3 (P2-04) — Explicit multi-criterion observation linking — S/M

The model/IPC/EventLog/decision-gate already accept `criterionIds: string[]`
end-to-end (`types.ts:122`, `verification_coach.rs:94-123`,
`StepDetailSlideIn.tsx:516-537`); only `VerificationCoachPanel` pins
`recordCriterionIds = [activeCriterionId]` (`:159-165`, deliberate S-029
guard). Change: replace the single `<select>` with an explicit checkbox list
of the step's criteria (default = current single selection, preserving the
S-029 default), plus an "이번 관찰을 관련 기준 모두에 적용" toggle that
checks all. The anti-automation-bias posture is preserved because linking is
an explicit student act per observation: action-backed requirement
(`observationActionBacked`) and `MIN_OBSERVATION_LENGTH` stay; clear-on-switch
relaxes only within an explicit multi-select session. EventLog already
records the full id list — no backend change.

### D4 (P2-06) — Project archive, mirroring the session pattern — M

S-054's `DIVE_QA_APP_DATA_DIR` isolation already empties the demo sidebar;
this is the durable returning-user feature. Mirror the existing session
archive exactly: `status` column on `Project` (migration v18, default
'active', CHECK ('active','archived') like `Session` at `schema.rs:19`),
`project_archive`/`project_unarchive` IPC + store actions
(`project-session.ts:545-565` pattern), sidebar splits into active list + a
collapsed "보관됨" section (dimmed, same visual language as archived
sessions, `Sidebar.tsx:169-178`). Archiving never deletes; archived projects
open normally from the section. No pinning, no search (cut).

## Non-goals / preserve

- D2 emits advisories only — a plan can never be blocked by overlap findings
  (D-011-01). The self-pass lock ships with the check.
- D3 must not create any blanket/anonymous approval: every observation still
  names its criteria explicitly and remains action-backed. S-029's evidence
  gate semantics unchanged.
- D4: no data deletion, no auto-archiving heuristics.
- No changes to S-054's files (vite config, i18n loader, verifiers) — that
  stage owns them.

## Acceptance mapping

1. Active-session-empty shows the session-starting copy, never the "start a
   session" fallback (component test + live).
2. Overlapping expected_files / duplicated criteria across steps yield
   advisories + EventLog annotations while the plan still generates; S-050
   repro fixtures stay advisory-clean (self-pass suite).
3. One observation can be explicitly linked to N criteria and clears exactly
   those in the decision gate (component + existing gate tests).
4. Projects can be archived/unarchived; archived ones render in a collapsed
   dimmed section; fresh-DB and upgrade migrations tested.
5. Local CI green; live check rides the next combined QA session.

## Phases

- **P1**: D1 + D3 (frontend pair).
- **P2**: D2 (backend advisories + self-pass suite + copy keys).
- **P3**: D4 (migration + IPC + store + sidebar).
- **P4**: local CI + rebuild; live verification rides the tier-1/tier-2
  combined QA session.
