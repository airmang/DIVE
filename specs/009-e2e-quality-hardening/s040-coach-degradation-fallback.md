# S-040 — Coach locale-correct guidance + deterministic per-criterion fallback (009 theme 12) — stage spec/plan

**Wily Stage**: S-040 (`STG-f80fa2ec7d7c`, project `dive-2`). Status `draft` →
claimed by root. **Scope**: `dive/src-tauri/src/{dive,ipc}/**`,
`dive/src/{components/product,features/verification-coach}/**`, i18n. Root owns
the Wily lifecycle. **This is the final 009 hardening theme.**

**Spec**: [`spec.md`](spec.md) theme 12 — "Coach degradation & criterion-specific
fallback guidance."

## Context & why (source-grounded)

The LLM verification coach (specs/007) has two confirmed gaps:

1. **Locale gap (FRICTION-05 residual).** `build_verification_coach_prompt`
   (`dive/src-tauri/src/dive/verification_coach.rs:240-253`) injects locale only as
   a passive context-JSON field (`"locale": ...:245`) then concatenates FIXED
   English instruction strings with NO write-in-locale directive — strictly less
   locale-aware than `plan_interview.rs:45/64` ("Write every response ... in that
   language") and `assist.rs`/`verify.rs` (which branch on
   `prompt_locale_is_english`, S-036). Combined with the model's Korean-reply
   tendency, English-locale users get Korean coach guidance. JSON keys must stay
   English (parse_guide_json/validate_guide :255-303 unaffected).
2. **Fallback gap (theme-12 core).** When the coach degrades,
   `unavailable_response` (:305-325) returns `guide:None` + a single hardcoded-
   Korean message (:321 — itself a locale defect); the Dropped path
   (`ipc/verification_coach.rs:60-73`) is generic Korean. `VerificationCoachPanel`
   renders the guide only when `status==='shown'`; otherwise ONE muted reason
   line. **Zero per-criterion how-to-verify help.** The acceptance criteria are
   already client-side, so a deterministic, clearly-labeled fallback checklist can
   render without hanging (FRICTION-05 preserved by construction).

**Reuse truth**: the only per-class criterion classifier is Rust-private in
`workspace_plan.rs` (`MissingCriterionClass` :4479-4486; seven `*_MARKERS`
:4883-5047; `criterion_class_is_covered` :4634-4643), used at plan-validation on
JOINED text. The shared, already-pub `plan_quality_constants.rs` owns the keyword
sets and is imported by workspace_plan. S-040 **moves** the classifier there (no
duplication / no S-035 drift).

## Acceptance

1. Live coach guidance (`criterionSummary`, recommendedChecks label/instruction/
   expectedObservation, expectedObservations, evidencePrompts) is written in the
   **active UI locale** (English at `en`, Korean otherwise); JSON keys stay English.
2. When the coach is **Unavailable/Dropped**, a **deterministic per-criterion
   manual-verification checklist** renders — one hint per criterion, class-based
   (responsive → resize-to-375px; persistence → reload; a11y → tab/ARIA; loading/
   empty/error → force each state; generic otherwise) — **explicitly labeled an
   offline deterministic fallback, NOT the AI coach** (distinct `data-testid`
   `verification-coach-fallback`, separate from `verification-coach-guide`).
3. The fallback is **display-only**: it NEVER calls `recordVerificationObservation`,
   NEVER fills `observedCriterionIds`, and NEVER pre-satisfies the S-029
   action-backed evidence gate — `deriveDecisionGatePolicy` still reports
   `criteria_unobserved` and approve stays blocked until a real observation.
4. The hardcoded-Korean `unavailable_response` literal is removed — the i18n
   frontend reason key owns the displayed copy (locale-correct).
5. The criterion classifier is **moved** to `plan_quality_constants.rs` (single
   source of truth); `validate_criterion_quality` is byte-for-byte unchanged
   (existing tests prove it).
6. FRICTION-05 preserved (no new await/runtime call in the degradation path — no
   hang); all new prose i18n en+ko (S-030 ESLint green); S-029/S-030/S-036 reused,
   not re-done.
7. Full local CI green; adversarial review (the two non-negotiables: fallback is
   labeled deterministic/not-the-AI, and does not pre-satisfy S-029); live re-QA
   ko+en (deferred per live-QA caveat).

## Gaps closed

| Gap | Sev | Summary |
| --- | --- | --- |
| Coach guidance not in UI locale (FRICTION-05 residual) | P2 | `build_verification_coach_prompt` has no write-in-locale directive. Branch the system line on `prompt_locale_is_english(locale)` + append a write-in-{locale} clause naming the value fields; JSON keys stay English. |
| No per-criterion FALLBACK when coach Unavailable (theme-12 core) | P2 | `unavailable_response`/Dropped return `guide:None` + a generic line; panel shows ONE reason line. Add a per-criterion classifier (reuse the relocated table) → a labeled-deterministic checklist in the non-shown branch; never records / never pre-satisfies S-029. |
| Hardcoded-Korean unavailable message | P3 | `verification_coach.rs:321` hardcodes Hangul. Drop the backend literal; the i18n frontend reason key owns the copy. |
| Classifier source-of-truth Rust-private | P2 | MOVE `MissingCriterionClass` + `*_MARKERS` + `criterion_class_is_covered` to pub `plan_quality_constants.rs` + add `criterion_classes(text)->Vec<MissingCriterionClass>`; re-export → `validate_criterion_quality` unchanged. |

## Design decisions (resolved)

1. **Classify the fallback in RUST** (reuse the relocated table), surface
   per-criterion class DATA on the response, render localized copy in TS via `t()`
   — single source of truth, classifier stays unit-testable, no Hangul in TS.
2. **MOVE** the enum + markers + coverage fn into `plan_quality_constants.rs`
   (pure relocation, covered by existing `validate_criterion_quality` tests) + add
   `criterion_classes` mapping ONE criterion's text to every matching class.
3. **Render the fallback as a distinctly-labeled deterministic checklist** in the
   panel's non-shown branch (testid `verification-coach-fallback`), visually
   separate from `GuideView`; keep the existing reason line above it (specs/002 —
   not masquerading as the AI coach).
4. **Display-only**: never records observations / never fills
   `observedCriterionIds` (specs/007 + S-029 — guidance, not evidence).
5. **Drop the backend hardcoded-Korean message**; the frontend
   `COACH_UNAVAILABLE_REASON_KEYS` already resolves locale-correct copy.

## Non-goals / boundary

- Do NOT regress FRICTION-05: the fallback renders synchronously from
  already-present criteria text — no new await/runtime call (no hang).
- The fallback must NOT pre-satisfy/auto-confirm the S-029 action-backed gate (no
  `recordVerificationObservation`, no `observedCriterionIds`) — that stays the sole
  evidence path (specs/007).
- The fallback must NOT masquerade as the AI coach (specs/002) — explicit
  deterministic/offline label, distinct testid, kept OUT of GuideView/Shown/
  validate_guide.
- Do NOT duplicate the criterion markers in TS — reuse the relocated Rust table via
  `criterion_classes`. Do NOT re-implement the en-check — reuse
  `prompt_locale_is_english` (S-036). Do NOT re-do S-029/S-030/S-036.
- **Out of scope**: DATA-02 bounded diff/comparator hint into the live coach
  context + Socratic-interview data-type hardening (owner-gated; the deterministic
  per-criterion hints already cover the degraded path). No new ProvocationCardType;
  no change to `validate_guide`/JSON return-shape.

## Regression guards

- Existing `validate_criterion_quality` tests (workspace_plan.rs ~5582-5806) stay
  green after the P2 relocation — proves zero behavior change / no drift.
- `prompt_context_includes_cli_manual_no_preview_evidence` (verification_coach.rs
  :507) still passes; JSON keys stay English (parse/validate + done-claim/unsafe
  filters keep working).
- **Anti-gate test (critical)**: rendering the fallback leaves `observedCriterionIds`
  unchanged and `deriveDecisionGatePolicy` still reports `criteria_unobserved`;
  `recordVerificationObservation` not called when only the fallback is shown.
- Fallback block uses a testid distinct from `verification-coach-guide` and never
  appears when `status==='shown'`.
- FRICTION-05: the degradation path adds no new await/runtime call.
- S-030 ESLint green; the hardcoded-Korean literal (:321) is removed.
- Locale clause fires for both en and ko (test asserts correct clause present,
  other-language absent). Every criterion always gets a hint (empty classes →
  generic branch).

## Phase plan (= Wily phases; Codex work orders)

| Phase | Scope | Gaps |
| --- | --- | --- |
| **P1 Coach locale** | `build_verification_coach_prompt` (verification_coach.rs:240-253): `prompt_locale_is_english(locale)` + append a write-in-{locale} clause naming the value fields; JSON keys English; guardrails verbatim. | locale |
| **P2 Classifier relocation** | MOVE `MissingCriterionClass`+`label()`+seven `*_MARKERS`+`criterion_class_is_covered` to pub `plan_quality_constants.rs`; add `criterion_classes(text)->Vec<MissingCriterionClass>`; re-export into workspace_plan so `validate_criterion_quality` is byte-for-byte unchanged. | classifier reuse |
| **P3 Fallback backend data** | `unavailable_response` takes `&request`; per criterion → `criterion_classes` → additive `fallback_guidance: Vec<{criterion_id, classes[]}>` (DATA only, no prose); guide stays None; never record; drop the hardcoded-Korean line :321; thread `&request` to the Err/Unavailable/Dropped sites. | fallback backend + i18n |
| **P4 Fallback UI + keys + anti-gate** | i18n `roadmap.step_detail.coach_fallback_title` + `coach_fallback.{responsive,persistence,accessibility,loading,empty,error,generic}` (en+ko); `VerificationCoachPanel` non-shown branch renders a labeled deterministic block (testid `verification-coach-fallback`), one row/criterion, read-only (no record). Anti-gate + render tests. | fallback UI |
| **P5 CI + review + live re-QA** | Full local CI; adversarial review (labeled-deterministic + no-S-029-pre-satisfy); live ko+en re-QA induced-unavailable (deferred per live-QA caveat). | verification |

## Validation loop / Codex handoff

Likely **2 Codex passes**: A=P1 (locale) + P2 (classifier relocation, backend),
B=P3 (fallback backend) + P4 (fallback UI). Root owns Wily lifecycle + verification
+ PR + merge; Codex implements per boundary (reuse prompt_locale + classifier,
display-only fallback, no S-029 pre-satisfy, no FRICTION-05 regression, i18n).
Per-phase: raw `codex exec --dangerously-bypass-approvals-and-sandbox` in primary
(no git) → root re-runs gates + commits → adversarial review → PR → merge → Wily
complete → **009 hardening batch (S-029–S-040) COMPLETE.**
