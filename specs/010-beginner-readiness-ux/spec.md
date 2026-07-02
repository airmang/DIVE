# Feature Specification: Beginner Readiness & UX Hardening (Round 2)

**Feature Branch**: `010-beginner-readiness-ux`

**Created**: 2026-06-29

**Status**: Draft (awaiting owner approval at the audit checkpoint)

**Input**: Round-2 finishing pass after rc.5. Round 1 (`009-e2e-quality-hardening`,
Stages S-029–S-040) closed 127 functional gaps from 50 E2E journeys. Round 2 adds a
new lens — **does DIVE actually work as an educational app that teaches a true-novice
Korean student to supervise AI coding?** — alongside a fresh UI/UX pass. Evidence:
[`docs/qa/round2-audit-findings.md`](../../docs/qa/round2-audit-findings.md)
(78 confirmed findings + a 14-dimension beginner-readiness rubric, adversarially verified;
audit workflow `wvqwvavfi`).

## Context And Why

rc.5 is release-solid: the supervised loop renders and functions, and the round-1
hardening landed. The audit found **0 P0** (no crashes/data-loss) but **38 P1 / 40 P2**
beginner-readiness and polish gaps. They cluster where they hurt a true novice most:

- **A real dead-end** in the PRD interview: the backend declares the draft "ready to
  confirm" at goal + 1 criterion and the AI tells the student to confirm, but the real
  Confirm gate needs 2 substantive criteria + intent + scope + non-goal — **and there is
  no manual "add criterion" affordance**. A beginner whose AI won't extend the criterion
  (round-1 S-035 observed `student_edit_conflict`) is trapped. (P1-09, P1-10, P1-30)
- **Anti-automation-bias holes**: the verify provocation ("AI said done ≠ verified") is
  the product's core teaching moment, yet it silently drops when the runtime is
  unavailable; Danger-tier delete/shell cards have zero read-gate; the plan-critique gate
  is one asymmetric click with no logging. (P1-14, P1-17, P1-21)
- **Korean-parity regressions**: the post-approval roadmap renders primary action buttons
  in English on the Korean locale (`Start/Resume/Done/Locked/Project Plan`), plus evidence
  chips, OAuth fields, preview reason codes, and raw Rust errors leak English. (P1-16/28,
  P1-20, P1-03, P1-37, P1-06)
- **Accessibility debt**: load-bearing supervision text (the AI's "why" at the approval
  gate, diff counts, review-card labels, first-run steps) fails WCAG AA contrast; `<html
  lang>` never updates on locale switch. (P1-02, P1-24, P1-27, P1-32, P1-33)
- **Beginner vocabulary/scaffolding**: API key, provider, `.dive/`, diff, `의도 요약`,
  `수락 기준`, and the Safe/Warn/Danger model all hit a zero-experience student with no
  plain-Korean gloss. (P1-04, P1-11, P1-19, P1-22)

Every proposed fix stays inside the constitution: real-workflow only, evidence-grounded,
**no quizzes/badges/decks/static-fallback/classroom theater**. The audit's adversarial
pass dropped 13 findings (false-positive or already-fixed) to keep this honest.

## Requirements *(prioritized themes → proposed Stages)*

Severity = impact on a true-novice run. Ordered by execution priority.

### Theme 1 — PRD interview honesty & criterion scaffolding → Stage **S-041** (highest impact: dead-end)
Findings: P1-09, P1-10, P1-12, P1-13, P1-30, P1-31, P2-26, P2-27, P2-28.
Reconcile the interview "ready" signal with the real Confirm gate (drive the interview
toward every gate field, or stop declaring ready early); add an explicit **Add criterion**
button + trailing empty row so a student can reach the 2-criterion minimum by hand; voice
each missing gate field as conversational guidance instead of a passive footer of
negations; render a factual DIVE reply on patch-only turns (no silent dead-air); run
QuickIntake through `validateConfirmableProjectSpec`; highlight AI-applied edits across all
6 PRD fields; per-field `aria-invalid` + Enter/IME guard on the interview textarea.

### Theme 2 — Anti-automation-bias hardening (core pedagogy) → Stage **S-042**
Findings: P1-14, P1-15, P1-17, P1-18, P1-21, P1-25, P1-26, P2-09, P2-13, P2-14, P2-30.
Wire the existing deterministic verify-provocation decision so the "AI said done ≠
verified" card still appears when the runtime is unavailable; extend the read-gate to
Danger-tier `delete_file`/`run_process`/`bash`/`run_terminal_script` (checkbox confirm,
no diff required); surface plan-vs-actual file divergence on the visible card body; hoist
the secret/whole-file-overwrite callout out of `DiffViewer` so it shows without a diff;
make the read-gate copy conditional on diff presence; log plan-critique provenance to the
EventLog (Constitution IV) + add tests; render the existing trust-calibration hint near
the review card; distinguish "engaged" from "dismissed" for the stepper signal; replace the
green-check "mark irrelevant" icon with a neutral glyph.

### Theme 3 — i18n Korean-parity sweep → Stage **S-043**
Findings: P1-03, P1-06, P1-16, P1-20, P1-22, P1-28, P1-37, P2-01, P2-08, P2-11, P2-15,
P2-18, P2-22, P2-24, P2-33, P2-38.
Translate the 11 English `plan_view` values in `ko.json`; localize evidence chips
(`Test result`, `Diff`), Codex OAuth field labels, preview reason codes; add a deterministic
plain-Korean classifier for `project_create` Rust errors; rewrite coach-fallback copy in
beginner Korean; drop the `§9.2` spec reference from the blocked-command card; bilingual
startup error boundary; move backend human-facing log sentences to machine codes; add a
build/unit assertion locking en/ko key-set parity.

### Theme 4 — Accessibility / WCAG AA contrast + semantics → Stage **S-044**
Findings: P1-02, P1-24, P1-27, P1-32, P1-33, P1-34, P1-35, P1-38, P2-23, P2-25, P2-29,
P2-31, P2-34, P2-35, P2-36, P2-37.
Raise `--color-fg-subtle` / `warn` / `success` / `accent` tokens (light + dark) to ≥4.5:1
for load-bearing small text; stop dimming first-run step text via container opacity; set
`document.documentElement.lang` on locale change; `aria-label` the guided-help checkbox;
give SVG minimap nodes a paint-order focus indicator; bump sub-12px load-bearing micro-text;
add a deterministic supervisor-eval pending state.

### Theme 5 — Beginner vocabulary & first-run framing → Stage **S-045**
Findings: P1-04, P1-07, P1-11, P1-19, P2-03, P2-04, P2-05, P2-06, P2-07, P2-10, P2-21.
Plain-Korean glosses + storage reassurance for API key / provider; empty-folder hint;
canvas field glosses for `의도 요약` / `수락 기준`; a one-time, near-card primer the first
time a permission card appears (Guided-Mode explanation on the real artifact, not a lesson
track); a purpose line on first launch (what DIVE is for); `.dive/` gloss; align checklist
labels with the flow they trigger; honest 3-tier Safe/Warn/Danger model in quickstart + UI;
beginner-facing "provider unavailable" reasons.

### Theme 6 — Error/recovery legibility, loading states & composer gating → Stage **S-046**
Findings: P1-01, P1-05, P1-23, P1-36, P2-02, P2-17, P2-19, P2-20, P2-32, P2-39, P2-40.
Gate the composer when the runtime is `unavailable` (reuse the concrete reason + setup
action); render classified onboarding-error hints (suppress raw English tail); reassure
that restore is itself reversible (grounded in the auto pre-restore checkpoint); replace
false-empty states with loading skeletons (sidebar, recovery); surface recovery contextually
near a failed artifact; Enter-to-send composer hint; suppress the coach observation form when
a step has no criteria; reconcile the quickstart's "green dots/checkpoint timeline" with the
actual live recovery affordance.

### Owner addenda (2026-06-29) — owner feedback during live use, beyond the round-2 audit

These items came directly from the owner while using the app, not from the
78-finding audit. They are tracked as two new themes (the trivial placeholder fix
is folded into Theme 7). Constitution alignment is preserved throughout.

### Theme 7 — PRD interview: mandatory architecture decision + unbiased input → Stage **S-047** (owner-added 2026-06-29; not from the round-2 audit)

Two PRD-interview gaps the audit did not cover, on the same surface as Theme 1
(S-041):

(a) **Mandatory architecture decision.** The `ProjectSpec`/PRD captures goal,
intent, scope, non-goals, constraints, and acceptance criteria but has *no* concept
of architecture/stack, and the interview never raises it — the student reaches
confirmation and decomposition without ever deciding (or recording) *how* the
project is built (owner: "반드시 어느 아키텍처로 만들건지 정해야 할 것 같은데 그걸
안 정하고 넘어가네"). Add an explicit, **mandatory** architecture decision to the
interview: DIVE's AI proposes ≤2 suitable options with short, plain-language novice
rationale, and the student must **explicitly confirm or change** it (proposal only;
no AI auto-finalize — human agency, no automation bias). The decision is
**two-stage — application form (web app / static page / CLI tool / desktop, …) then
a concrete stack consistent with that form** — recorded as a first-class, versioned,
exportable `ArchitectureDecision` (form + stack + rationale + decision source) on the
PRD via the existing validated `PrdPatch` model (DIVE authoritative, not the LLM). It
becomes a new `validateConfirmableProjectSpec` requirement (the PRD is not
confirmable until form + stack are decided) with a localized "architecture not
decided yet" message, is shown in the Final PRD Read View and editable by reopening
the board, and flows into decomposition/plan so steps match the chosen form+stack.
Constitution: real-workflow only, **no jargon quiz / long wizard / score / badge**
(I/V); LLM proposes, DIVE records (VI). Pre-010 PRDs without an architecture stay
openable and must decide one at their next confirm/edit.

(b) **Unbiased interview input.** The answer-input placeholder hardcoded a specific
teacher/grading example (`prd.authoring.answer_placeholder` = "예: 선생님이 학생
과제를 확인할 때 누락된 제출물을 바로 보고 싶어", `PrdAuthoringBoard.tsx:478`) that
nudged every novice toward the same project; the open interview seed already supplies
guidance (owner: "이거 지워줘. 마음에 안들어"). Neutralize the placeholder — no
domain-specific example — consistently in ko/en. *Trivial value-only change applied
immediately on 2026-06-29 ahead of the Stage (now "여기에 답을 입력하세요" / "Type your
answer here"); preserves en/ko key parity (Theme 3).*

Surfaces: `PrdAuthoringBoard.tsx`, `projectSpec.ts` (`validateConfirmableProjectSpec`),
`workspace_plan.rs` (`build_prd_interview_system_prompt` / `prd_interview_next_focus`,
`PrdPatch` ops + validation), `ko.json` / `en.json`. Reuses specs/004 PRD
patch/validation/versioning + Final PRD Read View.

### Theme 8 — Supervised agent web access → Stage **S-048** (owner-added 2026-06-29; not from the round-2 audit)

Owner: *the agent must be able to access the internet* during a build ("에이전트가
인터넷 접속이 가능해야 하고"). Today, per Constitution III, Pi built-in tools and
resource discovery are disabled and only DIVE-owned tools are model-visible — and
there is **no** DIVE-owned web/fetch tool, so the supervised agent cannot retrieve
live data, current library docs, or web examples a real beginner project needs;
separately, provider connectivity is an implicit assumption with no distinct
"network unavailable" state, so a dropped connection can hang a turn silently. Add a
**DIVE-owned, model-visible web-access tool** (fetch an HTTP(S) URL / query a
documented API / retrieve reference docs) whose egress **crosses DIVE's Rust-owned
validation, permission, guard, and logging path** — no Pi built-in web tool, no
Node-side direct egress (Constitution III). Network egress is high-risk: gate it with
an explicit permission surface (destination host/URL + purpose, allow/deny) consistent
with the specs/003 review-vs-permission distinction; enforce a **safe egress policy**
(https-by-default; block dangerous schemes and a denylist of internal/loopback/
link-local SSRF targets) and **bounds** (connect/read timeouts, max response size) so
it fails clearly instead of hanging or exhausting memory. All activity (host/URL,
purpose, decision, outcome, bytes, errors) is **local-first logged/exportable with
secrets/tokens and full response bodies masked or bounded** (Constitution IV).
Web-fetched content is **agent input, not verification evidence** — it must not
satisfy a criterion or pre-approve a step (Constitution II). When the network is
unavailable or egress is denied, surface a **distinct localized state** (not a generic
failure or silent hang) and continue the loop. Model on the specs/008 runtime-tool
boundary (DIVE-owned tool, Rust-validated, approval, bounded output, logging/export)
extended with a network egress tool; register/bound it in the Pi sidecar tool path and
`tauri.conf.json` CSP `connect-src`, and add a distinct network/web-unavailable
capability/error state alongside `RuntimeUnavailableReason` / `RuntimeBadge`. This is
the **agent's** web tool — distinct from the in-app preview runtime's fetch posture
(009 theme 3 / S-031).

*Owner decision (2026-06-29):* "internet access" = give the agent an active web tool,
**not** merely guarantee provider reachability. Open design detail for `plan`/
`decisions`: per-request vs per-host approval reuse, and whether non-GET methods are
allowed.

## Non-Goals / Preserve (regression guards — do NOT "fix")

- Do not add quizzes, badges, scores, standalone card decks, forced long-form reflection,
  generic warning banners, static provocation fallback, or legacy-runtime fallback. All new
  scaffolding is contextual help on real project artifacts (Constitution I/II/V).
- Preserve the round-1 guarantees: coach sidecar-unavailable degrades cleanly; review cards
  stay non-blocking/sparse/deduped; PlanDraftRecoveryScreen retry preserves answers.
- 13 audit findings were dropped as false-positive/already-handled — do not re-open them
  (e.g. `RuntimeBadge` already shows which AI is answering).
- Agent web access (Theme 8) is a DIVE-owned, Rust-validated tool only — no Pi built-in
  web/fetch/discovery tool, no Node-side direct egress, and web-fetched content is never
  verification evidence (Constitution II/III).
- The mandatory architecture decision (Theme 7) is a recommend-then-confirm step, not a
  quiz/wizard/score/badge, and the AI never auto-finalizes the student's choice.

## Validation

Each Stage: design → implement → local CI gates (`cargo fmt`/`clippy -D warnings`/`test
--all-targets --features dev-mock`; frontend `format:check`/`typecheck`/`lint`/`test:unit`)
→ rebuild → **live re-QA on the real app in ko + en**. Deterministic triggers, gates,
logging, and i18n parity get unit/integration tests. The PRD dead-end (S-041), the offline
verify-provocation (S-042), and the Korean-roadmap leak (S-043) are the must-confirm-live
journeys.

**Open dependency (checkpoint decision)**: round-1 live QA used *macOS* computer-use on the
local `.app`; this session's computer-use targets a *Windows* host without DIVE installed.
The live-QA driver for Phase 3 must be resolved before the live re-QA loop.

## Tracking

- wily project `dive-2`. Round-2 audit themes map to Stages **S-041 – S-046**; owner-added
  Themes 7–8 (2026-06-29) map to **S-047 – S-048** (all to be registered on approval).
  Continues the S-029–S-040 numbering from round 1.
- Loop per Stage: spec/plan → implement → local CI → rebuild → live re-run the relevant
  journeys → verify → complete.
