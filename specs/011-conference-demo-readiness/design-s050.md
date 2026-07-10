# S-050 Design — Plan-Quality Gate Re-Tune (011 Theme 1, P0-01 + P2-05 plan-recovery)

**Stage**: wily `dive-2` S-050 (STG-3616130bf523) · **Status**: Designed 2026-07-10
**Governing lineage**: the gate was introduced by 009 theme 7 / Stage S-035
(`specs/009-e2e-quality-hardening/s035-prd-interview-scaffolding.md`, commits
`79b6199` → `5b55b30` → `541b502`) and touched by S-040. This design re-tunes it
under 011; the decision record is `specs/011-conference-demo-readiness/decisions.md`
D-011-01, and the S-035 design doc gets a forward-pointer annotation.

## Verified root causes (all confirmed in code, 2026-07-10)

1. **Per-criterion veto.** `validate_criterion_quality`
   (`workspace_plan.rs:4906-4985`, called from
   `workspace_plan_generate_draft_impl:3047`) iterates every criterion (global +
   per-step); one criterion failing the substantive-length / vague-filler /
   observable-marker check rejects the whole plan as `vague_criteria`.
2. **Generic-word goal classifiers.** `ui_goal_keywords()`
   (`plan_quality_constants.rs:176-189`) includes `button(s)`, `page(s)`,
   `layout`, `버튼`, `화면` — any UI-ish goal is forced to carry
   responsive + persistence + accessibility criterion classes, else blocked as
   `missing_state_criteria`. `data_fetch_keywords()` includes bare
   `load/loads/loaded`, `request(s|ed)`.
3. **Korean numeric-marker hole.** `has_meaningful_numeric_marker`
   (`workspace_plan.rs:5037-5067`) only credits digit tokens whose neighbor is in
   the **English-only** `NUMERIC_CONTEXT_MARKERS` (or the token mixes digits with
   ASCII letters). A Korean quantity criterion like "할 일 3개를 추가하면 목록에
   나타난다" gets no numeric credit ("3개" has no ASCII letter; "개" is not in the
   context list). Korean plans systematically under-match markers.
4. **English-only issue strings.** The three issue templates
   (`workspace_plan.rs:4920-4939`) are hardcoded English; the recovery screen
   (`PlanDraftRecoveryScreen.tsx`) renders them verbatim (P2-05's plan half).
   Locale selection for the localized parts keys off `text_prefers_english(goal)`
   rather than the app locale.
5. **Non-converging retry.** `handleRetryPlanDraft`
   (`useProductShellController.ts:1930-1948`, S-041) does feed
   `unresolved_questions` back into the regeneration prompt — but the feedback
   names marker *categories* ("number, comparator, named UI element, or state")
   with no example that provably passes, and echoes the failing criterion text
   (which can itself be implementation-detail phrasing like
   `CSS .done { text-decoration: line-through }` — which matches no marker). Three
   models failed to converge in the 2026-07-10 QA.

## Decisions

### D1 — Bundle/step-level verifiability instead of per-criterion veto

Blocking conditions after this change (everything else becomes advisory):

- criteria set empty → block (unchanged);
- a criterion is *junk* — substantive length < 8 or pure vague filler → block
  (unchanged; this check is narrow and catches real garbage);
- **zero marker-bearing criteria in the whole plan** → block (the plan is not
  independently verifiable at all);
- **a step whose criteria contain no marker-bearing criterion** → block, naming
  the step (the verify loop is per-step; a step with no checkable criterion can
  never carry evidence later).

Non-junk criteria that merely lack an observable marker, where the plan and each
step still have at least one marker-bearing criterion, no longer block. They are
returned as **advisory improvement suggestions** on the accepted draft, logged to
the EventLog as a non-blocking `plan.criterion_quality_advisory` annotation
(S-049 `plan.form_consistency` precedent), with no card and no gate.

### D2 — Explicit-signal goal classifiers

- `ui_goal_keywords` shrinks to explicit responsive/mobile signals:
  `responsive`, `mobile`, `반응형`, `모바일`. Generic nouns (`button(s)`,
  `page(s)`, `layout`, `버튼`, `화면`) are removed — a noun that appears in
  virtually every beginner goal is not a requirement signal.
- Required-class blocking applies only to explicitly signaled classes
  (responsive signal → Responsive class). Persistence and accessibility demands
  on UI goals move from blocking to the same advisory channel as D1.
- `data_fetch_keywords` drops bare `load/loads/loaded` and `request(s|ed)`
  (they match "page loads", "user requests"); keeps `fetch*`, `api`,
  `endpoint`, `데이터`, `불러`, `요청`. Loading/empty/error stays **blocking**
  for clearly-signaled data-fetch goals — that trio is the core S-035 pedagogy
  and clearly signaled fetching is a narrow, high-precision trigger.
- Rule for curation: every keyword kept must indicate the *requirement domain*,
  not a generic UI noun, and must be justified by a unit-test case.

### D3 — Korean marker parity

- Add Korean counters/units to the numeric-context mechanism (개, 번, 개의,
  항목, 줄, 자, 초, 분, 이내 등) so Korean quantity criteria earn numeric credit;
  keep the digit requirement.
- Extend `STATE_MARKERS` with verification verbs observed in the QA journey
  (취소선, 체크, 클릭, 토글, 추가, 삭제 stems; `line-through`, `strikethrough`,
  `toggle`, `click`, `checked`, `added`, `removed`).
- Implementation must first verify `quality_marker_matches` boundary semantics
  for Korean stems (S-035 adversarial fix `541b502` made matching
  token-boundary-aware; Korean needles like `나타` rely on stem matching) and add
  stem forms consistent with those semantics.

### D4 — Machine-code issues + localized, self-passing recovery examples

- The backend gate stops emitting prose. `CriterionQualityError` carries
  structured issues: `{ code, criterion_preview, step_ref?, missing_class? }`
  with codes like `criterion_too_short`, `criterion_vague_filler`,
  `criterion_no_marker`, `step_unverifiable`, `missing_state_class`.
  EventLog/export keep the stable codes.
- The frontend renders codes through i18n (ko/en) and, per issue code, shows
  **concrete example rewrites** that provably pass the validator, e.g.
  "완료한 항목을 클릭하면 취소선이 표시된다", "할 일 3개를 추가하면 목록에 3개
  항목이 보인다". Examples live under
  `planning.interview.recovery.examples.*` in `ko.json`/`en.json`.
- **Self-pass regression lock** (the named suite for the 011 acceptance): a Rust
  test reads `dive/src/i18n/{ko,en}.json`, extracts every
  `planning.interview.recovery.examples.*` string, and asserts each passes
  `criterion_has_observable_marker` and, assembled into a minimal plan,
  `validate_criterion_quality`. Any future copy edit that breaks the validator
  fails CI. (Same repo-file-reading pattern as `spec_status_docs.rs`.)
- The S-041 retry prompt now carries the localized issue text **plus the passing
  examples**, so regeneration has a target to converge on.

### D5 — Locale follows the app, not the goal text

With D4 the backend emits codes only, so all human-facing recovery copy is
rendered by the frontend in the app locale. `text_prefers_english` remains only
for prompt-language scaffolding, not for recovery copy selection.

## Non-goals / preserve

- The gate is re-tuned, **not removed**: junk criteria, marker-less plans,
  unverifiable steps, and clearly-signaled data-fetch state gaps still block
  (S-035 FRICTION-03b intent: block-and-re-ask, never auto-fill, never
  rubber-stamp).
- No LLM inside the gate; the gate stays deterministic. No static provocation
  fallback anywhere near review cards (Constitution/002).
- S-041 behaviors preserved: retry keeps student answers; Edit-PRD escape route
  stays; QuickIntake keeps flowing through the same validator.
- `validate_generated_step_traceability` and PRD confirm gates are untouched.

## Acceptance mapping (stage acceptance → evidence)

1. QA reproduction scenario passes: a static-checklist PRD with 반응형·접근성·
   저장·취소선-style criteria generates a plan (new Rust test mirroring the
   report's journey + live re-QA).
2. Self-pass suite exists and runs in CI (D4).
3. Korean input yields Korean recovery guidance (D4/D5; Vitest + live).
4. Decision recorded: `decisions.md` D-011-01 + S-035 design annotation (this
   doc).
5. Local CI green + release-app live re-QA of new-project plan generation.

## Implementation phases (registered via plan_stage)

- **P1 (Rust gate)**: D1 + D2 + D3 in `workspace_plan.rs` /
  `plan_quality_constants.rs` with unit tests incl. the QA-reproduction case and
  marker-matcher semantics checks.
- **P2 (contract + frontend)**: D4 + D5 — structured issue payload, frontend
  decode/render, examples + i18n parity, retry-prompt feedback, self-pass suite.
- **P3 (advisory channel)**: EventLog `plan.criterion_quality_advisory`
  annotation + export coverage + tests.
- **P4 (verify)**: full local CI, release `.app` rebuild, live re-QA of the
  new-project plan-generation journey (ko), stage evidence note.
