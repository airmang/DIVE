# S-036 — Verification-stepper false-completion & backend prompt locale debt (009 theme 8) — stage spec/plan

**Wily Stage**: S-036 (`STG-3f67838be4d3`, project `dive-2`). Status `draft` →
claimed by root. **Scope**: `dive/src/components/product/**` (stepper) +
`dive/src-tauri/src/{dive,ipc}/**` (verify.rs, assist.rs, supervisor.rs tests) +
`dive/src/hooks/**` (locale plumbing). Root owns the Wily lifecycle.

**Spec**: [`spec.md`](spec.md) theme 8 — "Verification stepper false-completion &
detection robustness (shares the supervisor.rs locale fix)."

**Key design correction (from canon-checked investigation)**: the `supervisor.rs`
Korean-question locale fix **already shipped** (commit 7436e8d, S-026/S-030) —
`build_supervisor_prompt` branches on `locale_is_english`, the Stage-C
deterministic fallback and `is_question()` are locale-robust. **S-036 must NOT
re-implement it — tests only.** The real residual backend locale debt is
**`verify.rs`** (V-stage self-verifier) and **`assist.rs`** (D-stage decomposer),
both still hardcoded Korean with forced Korean output.

**Owner-facing decision (adopted, render-only)**: the stepper false-completion is
fixed by making the green check **evidence-driven** (show green only when the
S-029 evidence is present; a neutral "visited" marker otherwise) rather than
**gating** the Next button. Render-only is the lower-friction, canon-aligned
choice (constitution V; the backlog explicitly offered "gate OR distinguish"),
and the roadmap step cannot advance regardless (DecisionGate is the authoritative
evidence gate). Flag if hard-gating is preferred.

## Acceptance

1. The verification stepper shows a green/"completed" check for a stage **only
   when that stage has real S-029 evidence** (code→diffViewed, observe/decision→
   acceptanceCriterionConfirmed, review-card→all provocation cards addressed); a
   stage merely **visited** by navigation shows a distinct neutral marker, never
   the green success check. Navigation stays free (Next/Previous never blocked).
2. The authoritative approve gate is unchanged: approve stays disabled until
   `card.state==='verified'` (DecisionGate); the stepper is presentation only.
3. `supervisor.rs` question-language localization is **locked by regression
   tests** (English for `en`, Korean otherwise) with **no behavior change**.
4. `verify.rs` (V-stage self-verifier) and `assist.rs` (D-stage decomposer)
   prompts + **output language** are locale-conditional (English at `en`,
   Korean otherwise), threaded via a `locale: Option<String>` param on the
   `card_verify` / `ai_assist_cards` commands from the frontend `useLocaleStore`.
5. All new user-facing strings via i18n en+ko (S-030 Hangul ESLint gate green);
   Rust prompt strings localized at the EN/KO branch level.
6. Full local CI green (cargo fmt + clippy --all-targets --features dev-mock -D
   warnings + test; pnpm format:check + typecheck + lint + test:unit) and theme-8
   journeys re-run live on the release `.app` in ko + en.

## Gaps closed

| Gap | Sev | Summary |
| --- | --- | --- |
| STATIC-04 / CROSS-verify | P1 | Stepper green check fires from navigation alone (`visitStage` adds the prior stage on every Next/Previous/title-click). Drive completion from S-029 evidence via an optional `evidenced` field; neutral "visited" marker otherwise. Reads the existing gate, never a parallel one; never blocks Next. |
| REFACTOR-02 (supervisor.rs) | P1 | Already localized (7436e8d). **Tests only** — assert English for `en`, Korean otherwise. Do NOT modify the locale branch / Stage-C fallback / is_question. |
| D-stage Korean prompt (assist.rs) | P1 | `build_system_prompt` (147) + user prompt (66) hardcoded Korean ("한국어로 20자 이내의 제목"). Thread locale into `AiAssistEngine.suggest_cards` + `ai_assist_cards` command; branch on `starts_with('en')`; localize output-language clauses. |
| V-stage Korean self-verifier (verify.rs) | P1 | `build_system_prompt` (344) + `build_user_prompt` (355) hardcoded Korean (forced "한국어 2~4문장" + 4 labels). Thread locale into `VerifyEngine.verify_card` + `card_verify` command; branch both prompts; localize output clause + labels. |

## Design decisions (resolved)

1. **Stepper completion is EVIDENCE-driven**: optional `evidenced?: boolean` on
   `VerificationReviewStage`; render the green `CheckCircle2` only when
   `(visited && evidenced)`, a distinct neutral `data-stage-state="visited"`
   otherwise. Reuses S-029's already-computed action-backed signals in
   `StepDetailSlideIn` — reads the real gate, never invents one.
2. **`completedStageIds` → `visitedStageIds`** (visited marker only);
   `isCompleted = (stage.evidenced ?? visitedStageIds.has(stage.id)) && !isActive`
   — `evidenced` falls back to legacy visited-completion when undefined, so the
   change is additive/back-compat.
3. **`supervisor.rs`: tests only, no behavior change** (already shipped).
4. **`verify.rs` + `assist.rs` thread locale via a new `locale: Option<String>`
   command param** (`card_verify`, `ai_assist_cards`), default empty/None → 'ko',
   mirroring `plan_interview.rs` (`starts_with('en')`); frontend invoke sites pass
   `useLocaleStore.getState().locale`. Matches the codebase locale-plumbing
   pattern (chat.rs:567, provocation_agent.rs:53).
5. **Replace forced Korean OUTPUT constraints** ("한국어 2~4문장", "한국어로 20자
   이내의 제목") with locale-conditional "in English"/"in Korean" instructions —
   the bug is the forced output language, not just the framing.

## Non-goals / boundary

- Do NOT re-do the S-029 per-criterion evidence gate (decisionGatePolicy.ts) or
  S-030 i18n — reuse them. Do NOT modify the `supervisor.rs` locale branch /
  Stage-C fallback / is_question (tests only).
- Do NOT GATE the Next button (render-only per the adopted decision).
- Do NOT touch other stages' scope. Stepper changes are presentation-only; the
  authoritative approve gate (DecisionGate / card.state==='verified') is unchanged.

## Regression guards

- Approve stays disabled until `card.state==='verified'` (StepDetailSlideIn test
  ~866) — keep.
- Navigation (Next/Previous/title-click) stays free — never gated by evidence.
- `evidenced` is additive/optional — consumers that don't pass it fall back to
  legacy visited-completion.
- `supervisor.rs` behavior unchanged (locked by the two new tests).
- `verify.rs` `#[cfg(test)]` Korean fixtures (~461) untouched; `card_verify` /
  `ai_assist_cards` default to 'ko' when locale absent (back-compat).
- No hardcoded Hangul in supervised-flow dirs (S-030 ESLint gate green).

## Phase plan (= Wily phases; each = one Codex work order)

| Phase | Scope | Gaps |
| --- | --- | --- |
| **P0 Foundation** | Confirm S-029/S-030 intact (read-only); confirm supervisor.rs locale branch present (tests-only). Add a shared `prompt_locale_is_english(&str)` helper (or reuse supervisor.rs `locale_is_english` via a small shared module) so verify.rs/assist.rs branch identically to plan_interview.rs. No behavior/UI change. | seams |
| **P1 Stepper honest-completion** | `evidenced?: boolean` on VerificationReviewStage; rename completedStageIds→visitedStageIds; `isCompleted = (evidenced ?? visited) && !isActive`; neutral `visited` stageState; populate `evidenced` per stage in StepDetailSlideIn from S-029 signals; navigation free; i18n en+ko. | STATIC-04 |
| **P2 supervisor.rs regression tests** | Two additive unit tests near supervisor.rs:3131: `en-US` ⇒ contains "written in English"; `ko-KR`/empty ⇒ Korean. NO other supervisor.rs edits. | REFACTOR-02 guard |
| **P3 verify.rs locale** | `build_system_prompt(locale)` + `build_user_prompt(...,locale)` branch on `starts_with('en')`; localize the forced-Korean output clause + 4 labels; `VerifyEngine.verify_card` + `card_verify` command gain `locale: Option<String>`; frontend invoke (useWorkmap.ts:305, useChatSession.ts:941) passes locale. Tests. | V-stage |
| **P4 assist.rs locale + integration** | `build_system_prompt(locale)` + user prompt branch; localize "한국어로 N자" output constraints; `AiAssistEngine.suggest_cards` + `ai_assist_cards` command gain `locale`; thread frontend invoke. Then full local CI + adversarial review; live ko/en re-run (deferred per live-QA caveat). | D-stage, integration |

## Validation loop / Codex handoff

Same as S-035: root owns Wily lifecycle + this doc + verification + PR + merge;
Codex implements each phase within boundary (no supervisor.rs behavior change, no
S-029/S-030 re-do, render-only stepper). Per-phase: Codex (raw `codex exec
--dangerously-bypass-approvals-and-sandbox` in the primary checkout, no git) →
root re-runs gates + commits → adversarial review at stage end → PR → merge →
Wily complete.
