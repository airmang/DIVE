# Feature Specification: Unrestricted Project Kinds + PRD Interview Editability (Round 5)

**Feature Branch**: `014-unrestricted-project-kinds`

**Created**: 2026-08-25

**Status**: Approved (owner, 2026-08-25 — "만들 수 있는 프로젝트 종류를 제한하지
않아야 해. 이거 정말 중요해"; staged via Wily S-072–S-074, implemented in stage
order by subagents under root verification; **implemented 2026-08-25** — commits
bb05d33c, 0766a7ac, dc65ef06, 6b4fea7d, 8939b24c, 5c118359; live re-QA on a
rebuilt release app pending)

**Input**: Team-member QA feedback on the rc.9-era PRD flow (2026-08-24, four
items) plus the owner principle that the feedback exposed:

1. 채팅에서 Enter로 전송이 안 되고 버튼을 눌러야 한다.
2. PRD를 쓴 뒤 고치려 하면 고친 내용이 아래에 추가로 쌓이고 원래 내용은 안 바뀐다.
3. 웹앱 **또는** API 둘 중 하나만 고를 수 있다 — "API까지 연결해야 하면?"
4. PRD 확정 버튼이 활성화되지 않는다.

Root causes were traced in code (see *Context*). Item 3 is not a bug in the
S-047 implementation; it is the S-047 design itself (bounded single-choice
`ArchitectureForm`, S-049 exclusionary per-form scaffolding and a form/step
contradiction check) contradicting an owner principle that had never been
written into canon. This spec records the principle (Constitution **VII**,
1.2.0) and re-decides S-047 under it, and fixes items 1, 2, 4.

## Context And Why

| Item | Root cause (code) | Verdict |
| --- | --- | --- |
| 1 Enter | `PrdAuthoringBoard.tsx` interview textarea has no `onKeyDown`; `SocraticInterviewPanel.tsx:123-128` sends only on Cmd/Ctrl+Enter. The main chat (`ChatInput.tsx:91-103`) has sent on Enter since rc.2. | Gap in two PRD-flow inputs |
| 2 Edits stack up | `prd_patch.rs` op vocabulary is append-only for scope / non-goals / constraints (`append_*` only, no revise/remove) and has no criterion retirement; the interview prompt (`prd_interview.rs:350`) allows exactly those 7 ops. An edit request can therefore only append. Student-edited fields additionally hold AI patches (`held_for_student`, Constitution VI — retained). | Missing operations |
| 3 One form only | `ArchitectureForm` is a bounded single-value enum (S-047 Q1, `design-s047.md:74`); per-form plan scaffolding says "avoid X" (`productShellControllerLogic.ts:16-31`, S-049); `plan_form_consistency.rs` annotates steps that "contradict" the form (S-049). No copy defines what each form includes. | Design contradicts owner principle → re-decide |
| 4 Confirm disabled | Seven-condition gate (`validateConfirmableProjectSpec`); the reasons are shown only as small footer text, the header button gives no reason. Item 2 makes the gate harder to clear. | Legibility gap |

The owner's principle — **DIVE does not restrict what kinds of projects a
student can build** — was stated in conversation before S-047 but is absent
from every canon document (constitution, specs, AGENTS.md, DIVE_DECISIONS.md,
spec-status). The implementing agents worked from a spec that pointed the
other way ("bounded", "consistent with that form"). Recording the principle
is the first deliverable; everything else follows from it.

## Non-Goals

- No change to the *mandatory* architecture decision itself (S-047's reason
  for existing — the student must decide how it is built before confirming —
  stands). What changes is that the decision can no longer narrow what is
  buildable.
- No change to the `held_for_student` protection (AI patches never overwrite a
  field the student edited by hand; Constitution VI).
- No change to confirm-gate *requirements* (goal, intent, ≥1 scope, ≥1
  non-goal, ≥2 criteria, architecture form + stack). Only their legibility.
- No Enter-to-submit on the Quick Intake form (multi-field form, not a chat).
- No new supervision surfaces, no new review-card types.

## Requirements *(themes → Stages, in execution order)*

### Theme 1 — Principle VII + unrestricted architecture decision → Stage **S-072**

**Governance (lands first, own commit).**

- Constitution 1.1.0 → **1.2.0** (MINOR): new Principle **VII. Unrestricted
  Project Kinds**. ADR: `adr-unrestricted-project-kinds.md` (this directory).
  Plan template gains a matching Constitution Check gate.
- `design-s047.md` Q1 ("bounded form enum") and the S-049 Q2 follow-up
  (form scaffolding + `plan_form_consistency`) are **superseded** by this
  stage; the design note gets a pointer, not a rewrite.

**Data model — `ArchitectureDecision.forms` (multi-valued).**

- `form: ArchitectureForm` → `forms: ArchitectureForm[]` (TS + Rust), order =
  the student's pick order. `formOtherLabel` stays (free text, used when
  `forms` includes `other`). `stack`, `rationale`, `decisionSource`,
  `decidedInVersion` unchanged.
- Legacy rows/snapshots carrying `form` MUST deserialize: Rust folds a
  present `form` into `forms` when `forms` is absent/empty (serde
  `from`-style raw struct); TS normalizes the same shape defensively. No DB
  migration (specs are JSON blobs).
- Confirm gate (TS `validateConfirmableProjectSpec`, Rust
  `confirmable_draft_gaps` / `architecture_is_decided`): `forms.length ≥ 1`
  AND non-empty `stack`. Reason codes unchanged (`missing_architecture_form`,
  `missing_architecture_stack`). `other` needs no label to pass.
- `expected_architecture_proposal_kind` / focus text: "form" while `forms` is
  empty, "stack" while stack is empty; the focus prose lists the six forms as
  **examples**, says the student may pick several, and that "other" with the
  student's own words is always acceptable.

**UI — PRD Authoring Board architecture section.**

- Form buttons become multi-select toggles (`aria-pressed` per button;
  toggling the last one off leaves `forms: []` and keeps the stack text).
- Each form shows a one-line definition (new i18n
  `prd.architecture.form_help.{form}`, ko/en), e.g. web app = "브라우저에서
  쓰는 앱 — 필요하면 서버·DB·API 백엔드까지 포함", API service = "화면 없이 다른
  프로그램이 호출하는 백엔드", other = "위에 없으면 직접 적기 — 게임, 봇, 모바일
  앱, 하드웨어, 데이터 분석 등 무엇이든".
- Section help copy states: pick every form that applies, several are fine,
  "other" in your own words is fine, **forms guide the plan and never limit
  what you can build**.
- The stack input is enabled regardless of whether a form is picked (typing a
  stack first creates the decision with `forms: []`).
- AI form cards (`proposals.kind === "form"`) add a form on click (they clear
  once `forms` is non-empty, as today); stack cards unchanged.
- `FinalPrdReadView` renders all forms (comma-joined labels; `other` shows
  the student's label).

**Planner context — additive only.**

- `planScaffoldingForForm` → `planScaffoldingForForms(forms, otherLabel)`:
  union of **positive** coverage lines per form (no "avoid …" clause
  anywhere), plus a fixed closing line: these are planning hints for the
  chosen forms, not limits — include any other work the goal and criteria
  require. `other` contributes "the student described the form as '<label>'".
- Interview system prompt: form definitions + "the student may pick several
  forms or describe their own"; the `propose_architecture_form` line keeps the
  six enum values as card-mappable options.
- **Remove** `dive/src-tauri/src/dive/plan_form_consistency.rs`,
  `log_form_consistency_annotations`, `PLAN_FORM_CONSISTENCY_EVENT` +
  payload, `architecture_form_code` (if orphaned), and the
  `generate_draft_logs_form_consistency_annotation_without_blocking` test.
  The `plan.form_consistency` event type is retired (old exports keep it as
  history; nothing reads it).

**Tests.** TS: `projectSpec.test.ts` (gate on `forms`, legacy `form`
normalization), `PrdAuthoringBoard.test.tsx` (multi-toggle, stack without
form, form card adds), `FinalPrdReadView.test.tsx` (multi-form row),
`productShellControllerLogic` scaffolding (union, no "avoid", closing line,
other label). Rust: models deserialize legacy `form`, `confirmable_draft_gaps`
on `forms`, `into_sanitized` unchanged, lifecycle/artifacts tests updated,
`spec_status_docs` doc gate green.

### Theme 2 — PRD interview edits in place → Stage **S-073**

**New `PrdPatch` operations (Rust apply + validate, prompt, TS types):**

| op | fields | effect |
| --- | --- | --- |
| `revise_scope` / `revise_non_goal` / `revise_constraint` | `target` (current item text), `value` (new text) | replace the matching item in place |
| `remove_scope` / `remove_non_goal` / `remove_constraint` | `target` | delete the matching item |
| `retire_acceptance_criterion` | `criterionId` | `status = retired`, `retiredInVersion = currentVersion` (never deleted — 004 versioning) |

- Target matching: trim + collapse whitespace + case-insensitive exact match
  against the current list; no match → new rejected reason `item_not_found`
  (whole patch rejected, matching the existing `criterion_not_found`
  all-or-nothing semantics). `retire_acceptance_criterion` on an unknown or
  already-retired criterion → `criterion_not_found`.
- `PrdPatchOperation` gains `target: Option<String>` (Rust; `#[serde(alias)]`
  tolerant parse in `RawPrdPatchOperation`) and TS union members for the new
  ops. `field_path_for_prd_operation` maps revise/remove to their list root
  (`scope` / `nonGoals` / `constraints`), so `held_for_student` and the
  `data-changed` highlight keep working unchanged.
- Validation per op: `set_*`/`append_*`/`revise_*` require non-empty text
  (`value`/`text`); `remove_*` require non-empty `target`; `retire_*` require
  `criterionId`. Size/secret checks apply to every text field carried.
- Interview system prompt: list the new ops; instruct: "When the student asks
  to change or drop something already in the draft, edit it in place with
  `revise_*` / `remove_*` / `retire_acceptance_criterion` — copy `target`
  exactly from the draft JSON — never append a corrected duplicate."
- i18n: `prd.authoring.rejected_reasons.item_not_found` (ko/en);
  `PRD_REJECTED_REASON_CODES` updated.

**Tests.** Rust unit tests in `prd_patch.rs` for each op (apply, not-found
rejection, normalized match, retire sets version, held-for-student on a
student-edited list), `into_prd_operation` parse of `target`. TS: rejected
reason rendering, type coverage.

### Theme 3 — Interview input & confirm-gate legibility → Stage **S-074**

- Shared helper `dive/src/lib/composerKeys.ts` — `shouldSendOnEnter(event)`:
  `Enter` without Shift, not IME-composing (`nativeEvent.isComposing` or
  `keyCode === 229`). `ChatInput` adopts it (behavior unchanged).
- PRD interview rail textarea (`prd-interview-input`): Enter sends,
  Shift+Enter newline; hint line reuses `chat.input.enter_hint`.
- `SocraticInterviewPanel`: Enter sends (Cmd/Ctrl+Enter still works),
  Shift+Enter newline; same hint line.
- Confirm-gate legibility on the board: a remaining-count chip next to the
  header confirm button ("확정까지 N개 남음" / "N to go"), `title` tooltip
  listing the reasons, `aria-describedby` → the footer hint (`id`,
  `role="status"`); clicking the chip scrolls to and focuses the first
  missing field (reason code → field container mapping). Gate requirements
  untouched.

**Tests.** `composerKeys.test.ts` (Enter / Shift+Enter / composing / 229),
board test: Enter submits, Shift+Enter does not, chip count + scroll target;
Socratic panel test: Enter submits.

### Theme 4 — Architecture decision = one stack confirmation, no form taxonomy → Stage **S-075** (owner-added 2026-08-26)

Owner, looking at the S-072 result: "웹 앱 / API 서비스 고르는 게 꼭 필요한 단계인가?
굳이 저렇게 해야 하나?" Fresh-look verdict (D-014-16): the 2026-06-29 ask was
that the AI must not pick how the project is built without the student —
that is the **stack**. The form taxonomy was an agent-introduced middle layer
(S-047 Q1) that restates the goal, adds friction before any code (V), and
after VII no longer does any downstream work. It is removed; the mandatory
decision stays, reframed as a confirmation.

- **Data model**: `ArchitectureDecision { stack, rationale?, decisionSource,
  decidedInVersion }`. `forms`, `form`, `formOtherLabel` and the
  `ArchitectureForm` enum are gone from TS and Rust; legacy JSON keys are
  ignored on deserialize (no migration; serde ignores unknown fields, TS
  normalizer strips them). Wire shape of `architectureProposals` stays
  `{ kind: "stack", options: [{ value, rationale }] }` — `kind` is always
  `"stack"`; a `"form"` proposal is dropped by the sanitizer.
- **Gate**: `missing_architecture_stack` only (TS + Rust
  `architecture_is_decided` = non-empty trimmed stack). The
  `missing_architecture_form` reason code, its i18n, the S-074 chip's hidden-
  stack count adjustment, and the form focus mapping are removed (blank draft
  = 6 remaining).
- **Interview**: one architecture gap/focus — `propose_architecture_stack`:
  recommend ≤2 concrete stacks that fit the goal; each rationale is one plain
  line that says what the finished thing is (a browser app, a command-line
  tool, a bot…) and why this stack; then ask the student to confirm or change
  — never decide for them. Form definitions and "may combine several forms"
  prompt lines go; "never put the architecture in the patch" stays (VI).
- **Board**: the section is titled "AI가 이렇게 만들 계획이에요" — help copy
  says the AI proposes a stack from the goal, confirm it or rewrite it, and
  nothing you build is restricted. ≤2 stack cards (stack + reason) fill the
  stack input on click; the stack input is always editable; rationale stays
  optional. No form toggles, definitions, or "other" input. Test ids kept:
  `prd-field-architecture`, `prd-architecture-stack-input`,
  `prd-architecture-stack-proposal-{i}`, `prd-architecture-rationale-input`.
- **Read view**: "기술 스택" row (+ rationale); no form row.
- **Planner**: prompt architecture context = `{ stack }`; directive binds to
  the stack only ("do not switch to a different framework or stack"); the
  S-072 `planScaffoldingForForms` block and `architectureLabels.ts` are
  deleted. Nothing in the planner mentions a form.
- **Copy**: remove `prd.architecture.form.*`, `form_help.*`, `form_other_plain`,
  `form_label`, `proposals_heading_form`, `architecture_other_placeholder`,
  `validation_architecture_form_required`; rewrite `prd.fields.architecture`,
  `architecture_help`, `prd.architecture.title`, `proposals_heading_stack`,
  `validation_architecture_stack_required`, `architecture_stack_placeholder`
  (ko/en, parity).
- **Tests**: Rust models (legacy `form`/`forms` keys ignored, stack kept),
  gaps (stack-only), sanitizer drops `kind: "form"`, IPC save backstop
  (None / blank stack rejected); TS gate, normalizer, board (cards fill the
  stack, edit after card, chip count 6, stack focus), read view, planner
  prompt context.

## Constraints (all stages)

- Constitution I–VII binding. VII is the reason this spec exists: no stage may
  introduce a single-choice taxonomy, an "avoid X" scaffold, or a form/step
  contradiction check anywhere. After S-075 there is no project-kind
  taxonomy at all — the simplest compliance.
- Architecture is still authored only by the student's click/typing (no
  `set_architecture` patch op; Constitution VI).
- ko/en key parity (`src/i18n/parity.test.ts`) must stay green.
- Existing PRDs with a single `form` must open, confirm, and decompose
  without any student action beyond what the gate already asked for.

## Validation

Each stage: implement → local CI gates (`cargo fmt` / `clippy -D warnings` /
`test --all-targets --features dev-mock`; frontend `format:check` /
`typecheck` / `lint` / `test:unit`) → root adversarial review (worktree
isolated, read-only git) → docs. Live re-QA on the rebuilt release app is the
owner's / team's follow-up (the team member who reported the four items is
the natural re-tester); the acceptance script is the four items above plus:
"pick 웹 앱 **and** API 서비스, type a stack, confirm, generate a plan — the
plan covers both and nothing is annotated as contradicting the form."
