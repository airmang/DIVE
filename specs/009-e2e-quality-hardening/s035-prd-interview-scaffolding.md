# S-035 — PRD / Socratic interview friction & weak criterion scaffolding (009 theme 7) — stage spec/plan

> **Re-tuned by 011 S-050 (2026-07-10).** The concreteness gate this stage
> introduced blocked all new-project plan generation in the conference-readiness
> QA (P0-01). Its calibration — per-criterion veto, generic UI-noun goal
> classifiers, English-only numeric-marker contexts and recovery prose — was
> re-tuned to bundle/step-level verifiability with localized self-passing
> recovery examples. See `specs/011-conference-demo-readiness/decisions.md`
> D-011-01 and `design-s050.md`. The block-and-re-ask intent and the data-fetch
> loading/empty/error pedagogy remain in force.

**Wily Stage**: S-035 (`STG-5ad54e1456d5`, project `dive-2`). Status `draft` →
claimed by root. **Scope**: `dive/src/**` (planning/interview UI) +
`dive/src-tauri/src/{dive,ipc,workspace_plan,db}/**` (interview prompt, draft
validation, verification typing). Root owns the Wily lifecycle.

**Spec**: [`spec.md`](spec.md) theme 7 — "PRD/Socratic interview friction and
weak criterion scaffolding."

**Owner decision (2026-06-27)**: the quick-intake fast-path (STATIC-05) ships
**behind a classroom-tunable feasibility flag defaulting OFF** (P4-A), as an
alternate entry into the *same* PRD canvas fields that routes through the
identical concreteness gate — never a standalone wizard, never a rubber-stamp.

## Acceptance (from the Stage + design)

1. Between interview submit and the approval/recovery screen the user sees a
   pending **skeleton** + a deterministic **"N more quick questions"** chip; the
   chip never disables submit and the surface cannot hang (timeout fallback).
2. **English vague input** ("just make it nice", "something like other
   bakeries") surfaces non-blocking ambiguity hints under `en` locale; Korean
   detection unchanged.
3. A draft whose acceptance criteria are vague is **BLOCKED before insert**,
   routed to `PlanDraftRecoveryScreen` with reason `vague_criteria`, missing
   items listed in `unresolved_questions` — never accepted as "ready"; the gate
   **never auto-fills**.
4. A **UI/interactive** goal missing responsive/persistence/a11y criteria, and a
   **data-fetch** goal missing loading/empty/error states, are blocked with the
   missing classes/states named (route-back); a fully concrete PRD passes.
5. A static front-end step gets `verification_type` `preview|manual` with a
   **NULL** `verification_command` (no bogus command); `run|test` requires an
   envelope-safe command; legacy `command` migrates; `verification_type` does
   **NOT** set `concreteEvidence` (S-029 decoupling locked).
6. All new user-facing strings route through i18n in both `en` and `ko`;
   `supervisor.rs` is **untouched**; the S-030 ESLint Hangul gate and the
   `plan_interview.rs` pinned-substring tests stay green.
7. Full local CI green (rust `fmt` + `clippy --all-targets --features dev-mock
   -D warnings` + `test`; frontend `format:check` + `typecheck` + `lint` +
   unit) and theme-7 journeys re-run live on the release `.app` in `ko` + `en`.

## Context & why

The Socratic interview is DIVE's "spec before decompose" experience (specs/004),
but five real-user journeys exposed friction and a weak quality floor:

1. Between goal capture and the approval screen there is **no progress signal or
   skeleton** — the only busy hint is `chat.isStreaming` and a `useRef`
   (`expectingPlanDraftRef`) that does not drive re-render, so beginners see a
   dead chat with no momentum (STATIC-01).
2. Vague-answer detection is **duplicated three ways and Korean-biased**:
   `SocraticInterviewPanel.isVagueAnswer` (8-item array + a `length<=16` gate
   that lets a long vague English answer through), `ambiguity.ts RULES`
   (Korean-token regex only, no locale), and the Rust prompt phrase list — none
   shared (FRICTION-03a, APPS-02).
3. The draft schema only enforces **presence** of required fields;
   `validate_plan_draft` / `validate_step_envelope` check step-count/scope/
   uniqueness but never criterion concreteness — a model that caves to "you
   decide" emits a syntactically valid PRD with vague criteria and it is accepted
   as "ready" (FRICTION-03b). The system prompt has **no domain checklist**
   (neither branch instructs responsive/persistence/a11y for UI goals or
   loading/empty/error for data-fetch goals) (STYLED-03, ADDFEATURE-03/cross).
4. `verification_type` is a **free-form `Option<String>`** everywhere (schema
   `["string","null"]`, no enum); a static `index.html` step gets a bogus/null
   `verification_command` because nothing tells the model to pick a no-command
   path (INTERACTIVE-02).

The fix raises quality via locale-keyed prompt scaffolding **and** a
deterministic post-draft backstop that **blocks-and-re-asks (never auto-fills)**
— preserving DIVE's no-static-fallback ethos while making the quality floor real.

## Gaps closed (`docs/qa/e2e-gap-backlog.md` theme-7 cluster)

| Gap | Sev | Summary |
| --- | --- | --- |
| STATIC-01 | P1 | No visual reward before 3-6 Q → deterministic "N more quick questions" chip + skeleton goal-card. Advisory; never gates submit. |
| STATIC-05 | P1 | No fast path → quick-intake form **behind default-off feasibility flag**, alternate entry into the same PRD canvas through the same concreteness gate. |
| FRICTION-03a | P1 | `ambiguity.ts` RULES Korean-only → `RULES_BY_LOCALE` + `detectAmbiguity(text, locale)` English rule set; thread `useLocale()`. Hints stay non-blocking. |
| APPS-02 | P1 | Interview vague detection Korean + length-gated → drive hint off `unresolved_questions` count; consolidate phrase set; remove brittle 16-char gate. |
| FRICTION-03b | P1 | Premature acceptance → deterministic concreteness/independent-checkability gate before insert; failure → typed `vague_criteria` error → `PlanDraftRecoveryScreen`. Blocks-and-re-asks, never auto-fills. |
| STYLED-03 | P1 | No domain scaffolding → locale-keyed responsive/persistence/a11y elicitation checklist in both prompt branches + backstop requiring those classes for UI goals. |
| ADDFEATURE-03 / DATA-cross | P1 | Data-fetch goals must carry loading/empty/error criteria → locale-keyed prompt push + classifier-gated backstop; missing states named via route-back. |
| INTERACTIVE-02 | P1 | `verification_command` bogus/null for static steps → closed `verification_type` enum (run\|preview\|manual\|test); preview/manual ⇒ null command; **MUST NOT** feed `concreteEvidence`. |

## Confirmed touch points (verified source, 2026-06-27)

- `dive/src-tauri/src/dive/plan_interview.rs` — `build_system_prompt` EN (~28-45)
  + KO (~47-64) edited in lockstep (no shared template); `plan_draft_schema`
  `verification_type` enum (~120-122); pinned-substring tests (~172-233) updated
  with prompt changes.
- `dive/src-tauri/src/ipc/workspace_plan.rs` — `validate_plan_draft` (~4294) /
  new `validate_criterion_quality` called from `workspace_plan_generate_draft_impl`
  before insert; `verification_kind`/`verification_manual_check` mapping
  (~2806-2808, ~3271-3273); `sanitize_step_verification` invariant (~4391);
  `StepDraftInput` fields (~209-210).
- `dive/src-tauri/src/dive/plan_router.rs` — `verification_type` prompt
  grammar/examples (~82-83, 215/224/228) updated to the enum; decode path.
- `dive/src-tauri/src/dive/verification_coach.rs` — `VerificationEvidence`
  `verification_kind`/`manual_check` trio (~101-105) read-side awareness (no
  behavior change).
- `dive/src-tauri/src/db/models.rs` — `NewStep`/`StepRow`
  `verification_kind`/`command`/`manual_check` (~777-779, ~799-801) persist the
  enum string.
- `dive/src-tauri/src/workspace_plan/artifacts.rs` — `build_step_artifact`/
  `build_plan_markdown` read enum values (no bogus command for preview/manual).
- **NEW** shared-constants module under `dive/src-tauri/src/dive/` (e.g.
  `plan_quality_constants.rs`) — `VerificationType` enum + serde + `command`
  migration map; locale-keyed vague-term / data-fetch / UI-goal keyword sets
  reused by the gate.
- `dive/src/lib/ambiguity.ts` — `RULES` → `RULES_BY_LOCALE`;
  `detectAmbiguity(text, locale)`; English rule set.
- `dive/src/components/prompt-helper/AmbiguityHinter.tsx` (~20) +
  `dive/src/components/chat/ChatInput.tsx` (~147-149) — thread `useLocale()`.
- `dive/src/components/product/SocraticInterviewPanel.tsx` — consolidate
  `isVagueAnswer` (~22-38) onto shared set / remove brittle length gate; render
  skeleton + remaining-questions chip.
- **NEW** `dive/src/features/planning/remainingInterviewDimensions.ts` (pure
  helper) + companion controller state.
- `dive/src/components/product/useProductShellController.ts` — promote
  `expectingPlanDraftRef` to companion state (`planDraftPending`) (~574,
  ~1314-1338); render new pending/skeleton surface.
- **NEW** `dive/src/components/product/PlanDraftPendingScreen.tsx` — skeleton
  surface (reuse recovery-screen shell).
- `dive/src/features/planning/usePlanInterviewLLM.ts` — extend
  `PlanDraftLlmErrorReason` with `vague_criteria` (+ optional
  `missing_state_criteria`) (~13); decode plumbing.
- `dive/src/components/product/PlanDraftRecoveryScreen.tsx` (~13) — render new
  reason copy; preserve persisted interview answers on retry.
- `dive/src/features/planning/types.ts` — `StepDraftInput.verificationType`
  union (~232-233) tightened to enum.
- **NEW** `dive/src/components/product/QuickIntakePanel.tsx` — **behind
  default-off feasibility flag** (P4-A).
- `dive/src/i18n/{en,ko}.json` — `planning.interview.*` new keys (pending title,
  remaining-questions chip, `vague_criteria`/`missing_state` recovery copy,
  quick-intake labels) in lockstep; `submit_prompt`/`compact_retry_prompt`
  mirrored if verification vocabulary changes.

## Design decisions (resolved)

1. **Progress signal = deterministic, client-computed, advisory.** A "N more
   quick questions" chip from a pure `remainingInterviewDimensions(answers)`
   helper over the 6 dimensions {audience, done-signal, scope, non-goals, AC1,
   AC2}, plus a skeleton goal-card on first goal turn. Promote
   `expectingPlanDraftRef` to companion state (`planDraftPending`) so the
   pending surface re-renders; timeout/fallback so a silent `onPlanDraftError`
   early-return cannot hang it. *Count-of-remaining-questions only — no
   score/percentage/progress-bar/level/badge framing (specs/004 FR-013,
   constitution V).* Reviewed en+ko copy at P1.
2. **The concreteness gate is a PRD/plan VALIDATION gate** (specs/004 FR-020 +
   constitution VI), **not** a SupervisorAgent/review-card decision. One gate fn
   (`validate_criterion_quality`) called from `workspace_plan_generate_draft_impl`
   before insert returns typed errors that map to `PlanDraftRecoveryScreen`
   reasons and list missing items in `unresolved_questions`. It **never** emits a
   provocation/review card and **must not** touch `supervisor.rs`.
3. **All vague/keyword/state detection is a BACKSTOP** behind the LLM prompt
   push, locale-keyed; it **blocks-and-re-asks via `unresolved_questions`, never
   synthesizes/auto-fills criteria.** Shared vague-term + data-fetch + UI-goal
   constants live in ONE Rust module reused by the gate; the TS ambiguity rules
   become `RULES_BY_LOCALE` — kills the current 3-place drift.
4. **`verification_type` = closed enum `run|preview|manual|test`, STRICTLY
   decoupled from the S-029 `concreteEvidence` gate.** Schema enum nullable for
   back-compat; legacy `command` → `run`/`test`; sanitize/validate enforce
   `preview|manual ⇒ null command` and `run|test ⇒ envelope-safe command`. A unit
   test asserts `verification_type` does NOT set `concreteEvidence=true`.
5. **Quick-intake form (STATIC-05) ships behind a classroom-tunable feasibility
   flag defaulting OFF** (owner decision). Alternate entry into the same PRD
   canvas fields; one submit maps into `PlanDraftInput` and runs the IDENTICAL
   P2 concreteness gate; vague fields route back into the Socratic loop. No
   score/badge/quiz framing; lives inside the board, not a standalone wizard.

## Non-goals / boundary (do NOT pull in)

- **S-036 (theme 8)** — verification-stepper false-completion AND the shared
  `supervisor.rs` Korean-question locale fix. **S-035 MUST NOT modify
  `dive/src-tauri/src/dive/supervisor.rs` at all** (`ambiguity.ts` is an
  unrelated frontend hint layer; do not "also fix" the Korean-only supervisor
  question while here). Verify in the diff before completion.
- **S-038 (theme 10)** — static-vs-server preview discoverability/onboarding.
- **S-039 (theme 11)** — refactor/rename safety, multi-replace, quieter search.
- **S-029/S-031** — do not couple `verification_type` into the
  `concreteEvidence`/`verified_with_evidence` computation (`agencyStatus.ts`); a
  `preview`/`manual` type must still require an actual observation. Do not re-do
  the S-030 i18n work (done) — reuse it.

## Regression guards (preserve; add/keep tests)

- `read_file` / Safe-tier behavior unchanged; the progress chip and ambiguity
  hints stay **non-blocking** (never gate submit).
- Existing `PlanDraftRecoveryScreen` reasons (`length`|`invalid_json`|
  `invalid_plan_shape`) keep working; new reasons are additive.
- `PlanDraftRecoveryScreen` retry **preserves persisted interview answers** and
  is i18n-clean (spec Non-Goal FRICTION-05) — locked by test.
- Verification-coach sidecar unavailability **degrades cleanly without hanging**
  (spec Non-Goal) — locked by integration test.
- `verification_type`/`verification_kind` enum is **nullable + back-compat**:
  existing null-emitting and legacy `command` drafts must not break.
- `verification_type` MUST NOT set `concreteEvidence=true` — S-029 decoupling
  locked by a unit test asserting `agencyStatus` `verified_with_evidence` is
  unaffected by type.
- No hardcoded Hangul in supervised-flow dirs (S-030 ESLint gate stays green);
  `plan_interview.rs` pinned-substring tests updated in lockstep with EN+KO edits.
- `supervisor.rs` untouched (S-036 boundary).

## Phase plan (= Wily phases; each = one Codex work order)

| Phase | Scope | Gaps |
| --- | --- | --- |
| **P0 Foundation** | Typed seams, no behavior change. Rust: `VerificationType` enum + serde + `command`→Run/Test migration; schema enum (nullable); ONE shared-constants module (locale-keyed vague/data-fetch/UI-goal sets). TS: `ambiguity.ts` → `RULES_BY_LOCALE` + `detectAmbiguity(text, locale)` (callers default-unchanged); pure `remainingInterviewDimensions(answers)`; extend `PlanDraftLlmErrorReason` with `vague_criteria` (+ optional `missing_state_criteria`). | seams |
| **P1 Interview friction** | Promote `expectingPlanDraftRef` → `planDraftPending` state; `PlanDraftPendingScreen` skeleton (timeout fallback); "N more quick questions" chip (advisory); thread `useLocale()` into `AmbiguityHinter`/`ChatInput`; consolidate `isVagueAnswer`, drive APPS-02 hint off `unresolved_questions`, remove 16-char gate. i18n en+ko. | STATIC-01, FRICTION-03a, APPS-02 |
| **P2 Criterion-quality gate** | `validate_criterion_quality` before insert (uses P0 constants): reject vague/non-checkable criteria; UI goal ⇒ require responsive/persistence/a11y; data-fetch ⇒ require loading/empty/error; failure → typed `vague_criteria`/`missing_state_criteria` → `PlanDraftRecoveryScreen` with missing items in `unresolved_questions`. Add locale-keyed elicitation checklist to BOTH prompt branches (lockstep; update pinned tests). Never auto-fills, never a card, never touches `supervisor.rs`. | FRICTION-03b, STYLED-03, ADDFEATURE-03 |
| **P3 verification_type routing** | Constrain schema enum (nullable); prompt both branches to pick preview/manual (no command) for static; enforce invariant in `sanitize_step_verification`/validate (coerce inconsistent → manual); `plan_router.rs`/`artifacts.rs` read enum. Keep S-029 decoupling. | INTERACTIVE-02 |
| **P4 Quick-intake (flag-off) + integration** | (A) `QuickIntakePanel` behind classroom-tunable feasibility flag **defaulting OFF**, alternate entry into the same PRD canvas, runs the identical P2 gate, vague → route back. (B) Regression guards (FRICTION-05 retry-preserves + sidecar-degrades tests); full local CI; rebuild release `.app` + live re-run theme-7 journeys ko+en. | STATIC-05, FRICTION-05 guards, evidence trail |

## Dependency-ordered tasks

- **P0**: T001 Rust `VerificationType` enum + serde + migration map (NEW
  `plan_quality_constants.rs`); T002 schema `verification_type` enum (nullable)
  in `plan_interview.rs`; T003 shared locale-keyed keyword constants (same
  module); T004 [P] `ambiguity.ts` → `RULES_BY_LOCALE` + `detectAmbiguity(text,
  locale)` + English rules; T005 [P] pure `remainingInterviewDimensions.ts`;
  T006 [P] extend `PlanDraftLlmErrorReason` union. Tests: Rust serde round-trip
  + `command` migration; TS `detectAmbiguity` en/ko + dimension count.
- **P1** (deps P0): T007 `planDraftPending` companion state in controller; T008
  `PlanDraftPendingScreen` + render slot + timeout fallback; T009 remaining-
  questions chip + skeleton goal-card (advisory); T010 thread `useLocale()` into
  `AmbiguityHinter`/`ChatInput`; T011 consolidate `isVagueAnswer` + remove
  length gate; T012 [P] i18n en+ko keys. Component tests + S-030 ESLint green.
- **P2** (deps P0): T013 `validate_criterion_quality` (concreteness + UI/data-
  fetch coverage) before insert in `workspace_plan.rs`; T014 typed
  `vague_criteria`/`missing_state_criteria` error + `unresolved_questions`
  plumbing → `PlanDraftRecoveryScreen`; T015 locale-keyed elicitation checklist
  in BOTH prompt branches + update pinned-substring tests; T016 [P] i18n recovery
  copy en+ko. Rust gate unit tests + prompt tests + component recovery test.
- **P3** (deps P0): T017 constrain schema enum + prompt picks preview/manual for
  static; T018 enforce invariant in `sanitize_step_verification`/validate
  (coerce); T019 `plan_router.rs`/`artifacts.rs` read enum; T020 unit test
  `verification_type` does NOT set `concreteEvidence`. Rust gates.
- **P4** (deps P1-P3): T021 feasibility flag (default OFF) + `QuickIntakePanel`
  alternate entry → same PRD canvas + P2 gate; T022 [P] regression tests
  (FRICTION-05 retry-preserves + sidecar-degrades); T023 i18n quick-intake copy
  en+ko; T024 full local CI gates + verification receipt; T025 rebuild `.app` +
  live ko/en re-run (may be deferred per live-QA caveat).

## Validation loop (per 009)

spec/plan → **Codex implements per phase within boundary** → **local CI gates**
(rust `cargo fmt --check` + `clippy --all-targets --features dev-mock -D
warnings` + `cargo test`; frontend `format:check` + `typecheck` + `lint` + unit)
→ **adversarial verification workflow** → PR → CI green → merge → rebuild release
`.app` → **live re-run** theme-7 journeys (progress hint, English ambiguity,
vague-criteria route-back, static-step verification_type) in **ko and en** →
complete Wily Stage.

## Codex handoff (supervised) — who does what

- **Root (Claude, this session)**: owns the Wily lifecycle (claim → plan →
  complete), authored this doc, hands each phase's task block to **Codex** as a
  bounded work order, then **verifies** (local CI gates + adversarial review),
  opens the PR, merges on green CI, completes the Wily Stage.
- **Codex**: implements each phase **within the work-order boundary only** — does
  not widen scope, cross the phase boundary, touch `supervisor.rs`, or
  self-complete Wily state.
