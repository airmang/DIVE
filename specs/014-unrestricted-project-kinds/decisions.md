# 014 Unrestricted Project Kinds — Decision Log

Stage-scoped dispositions made while executing S-072–S-074. Each entry names
the stage, the decision, and the evidence. Canonical order: constitution >
specs > this log.

## D-014-01 (S-072) — Principle VII is a new principle, not a clause of I

The owner's rule ("만들 수 있는 프로젝트 종류를 제한하지 않아야 해") could have been
appended to Principle I (Real Project Workflow Only). It is recorded as its own
Principle VII because the drift it guards against (S-047 Q1, S-049) passed
every existing gate — I through VI were all satisfied by a bounded enum. A
rule that must veto otherwise-compliant designs needs its own Constitution
Check gate. Version bump is MINOR (1.1.0 → 1.2.0): a new principle, no
redefinition of existing obligations.

## D-014-02 (S-072) — S-047 Q1 superseded: `forms[]` + free text, legacy `form` folded

`ArchitectureDecision.form` becomes `forms: ArchitectureForm[]`. The six enum
values are kept as *card-mappable options* (the AI's proposal must land on a
button the student can press), not as the universe of buildable things —
`other` + `formOtherLabel` is the always-available escape hatch and needs no
label to pass the gate. Legacy `form` is folded into `forms` on deserialize
(Rust raw-struct `From`, TS normalizer); no data migration because
`ProjectSpec` / drafts are JSON blobs with serde defaults. Gate reason codes
are unchanged so i18n and the interview focus routing stay stable.

## D-014-03 (S-072) — `plan_form_consistency` is removed, not kept log-only

The S-049 check annotates a step as *contradicting* the form. Even as a
non-blocking EventLog annotation it encodes exclusion semantics ("a web app
step must not look like a CLI"), which VII forbids outright. Keeping it as a
log-only signal would preserve a research ledger entry whose only meaning is
"this step is the wrong kind" — the concept VII rejects. The module, its
lifecycle hook, the `plan.form_consistency` event constant/payload, and its
IPC test are deleted. Historical exports that contain the event remain valid
JSON history; nothing reads the type.

## D-014-04 (S-072) — Scaffolding is an additive union with an explicit "not limits" line

`planScaffoldingForForms` emits one positive coverage line per chosen form
(deduplicated union) and always ends with: these are planning hints for the
chosen forms, not limits — include any other work the goal and criteria
require. "Avoid …" clauses are gone. `other` contributes the student's own
label verbatim so the planner plans for what the student actually said.

## D-014-05 (S-073) — Revise/remove address list items by normalized target text

Scope / non-goal / constraint items are plain strings with no ids, and the
model sees the draft as JSON, so `target` = the current item text is the
addressing scheme. Matching is trim + whitespace-collapse + case-insensitive
exact; fuzzy matching is deliberately not attempted (a wrong-item edit is
worse than a rejection). Not found → `item_not_found`, and the whole patch is
rejected — the same all-or-nothing rule 004 already applies to
`criterion_not_found`. The rejection reason renders in the existing patch
feedback strip.

## D-014-06 (S-073) — Criteria are retired, never deleted

`retire_acceptance_criterion` sets `status = retired` and stamps
`retiredInVersion`, reusing the 004 data-model field that had no writer.
Retired criteria stay in the snapshot (versioned PRD, decomposition history)
and are excluded from the active-count gate as they already were.

## D-014-07 (S-074) — Enter sends in the two PRD-flow chats; Quick Intake stays a form

The PRD interview rail and the Socratic panel are chat composers and adopt the
main chat's contract (Enter sends, Shift+Enter newline, IME-composing guard,
hint line). Quick Intake is a multi-field form with two-line textareas; Enter
there inserts a newline by design and the submit button remains the action.

## D-014-08 (S-074) — Gate legibility, not gate relaxation

The confirm gate's seven requirements are unchanged. The fix is a remaining-
count chip beside the header button, a tooltip listing the reasons, and
click-to-scroll to the first missing field. A disabled `<button>` cannot
reliably show a tooltip across WebKit/Chromium, so the chip (an enabled
element) carries the affordance.

## D-014-09 (S-073) — `held_for_student` retained

An AI patch that targets a field the student edited by hand is still held
(`student_edit_conflict`). Item 2 of the QA feedback is fully explained by the
append-only vocabulary; the hold is Constitution VI agency protection and is
out of scope. If it proves confusing in re-QA it gets its own decision.

## D-014-10 (S-073) — Partial application under `held_for_student` stays, but is audited

Review of 0766a7ac showed a mixed patch (one op on a student-edited root, the
rest elsewhere) applies the rest, persists it, and logs only the held
rejection — a `remove_scope` could delete an item with no applied record and
a "held" strip on screen. Holding the *whole* patch was rejected: once a
student hand-edits one field, every later AI patch that touches that field
would be dropped entirely and the interview would stall on the other fields.
Instead the applied event is also logged with `applied_field_paths` in the
held case, the response already carries them, and the board shows a distinct
"일부 반영·일부 보류" copy (`patch_held_partial`) when both are non-empty.

## D-014-11 (S-074) — Enter-to-send covers `isComposing` + keyCode 229; WebKit candidate-IME Enter is a known limitation

On macOS WebKit the Enter that confirms a candidate window (Japanese,
Chinese, Korean Hanja conversion) is dispatched after `compositionend` with
`isComposing=false`, so it sends. Korean 2-set input (the product's primary
locale) commits syllables without a candidate window and behaves correctly on
both WebKit and WebView2; the main chat has shipped the same check since
rc.2. A `compositionend`-timestamp guard is deferred until a report from a
candidate-based IME; the helper's comment states the limitation instead of
claiming JP/ZH safety.

## D-014-12 (S-073 / S-074) — Retired criteria are visible as retired, restorable, never editable in place

S-073 made `retire_acceptance_criterion` reachable from the interview, but the
board rendered every criterion — retired included — as an identical editable
row, reproducing the "내용이 수정 안 됨" symptom for criteria and letting an
edit keep `status: retired` while the active-count gate ignored it. Active
criteria are the editable rows; retired ones render as a compact read-only
list with a "되살리기 / Restore" action (student-edit path, `status: active`,
`retiredInVersion: null`). The interview prompt tells the model that retired
rows are already dropped and must never be revised or retired again;
`revise_acceptance_criterion_text` rejects non-active criteria.

## D-014-13 (S-073) — Target matching: exact > unique normalized > unique loose; never first-of-many

D-014-05's "a wrong-item edit is worse than a rejection" was violated by
first-match-wins over case/whitespace-normalized text (`["Login page",
"login page"]`). Matching is now: exact trimmed match first; else the
normalized (whitespace-collapsed, case-folded) match only when unique; else a
loose pass (all whitespace stripped, trailing `.`/`,`/`。` dropped, curly
quotes straightened; no Unicode NFC — the crate has no normalization
dependency, so decomposed-jamo input must match byte-for-byte) only when
unique; otherwise `item_not_found`. A
`revise_*` whose new value already exists elsewhere merges (drops the target,
keeps the existing item) instead of creating the duplicate that
`compact_unique_strings` would silently collapse on the next turn. Validation
simulates the op sequence so a later op cannot target an item an earlier op
in the same patch consumed. `remove_*` targets are exempt from the secret-like
gate (the target is never persisted; a pasted secret must stay removable).
The parser accepts the paraphrases a model plausibly emits
(`delete_*`, `remove_acceptance_criterion`, `new`/`to`, target-less
`remove_*` with `value`).

## D-014-14 (S-073) — `retiredInVersion` follows the `createdInVersion` convention

Both stamp the draft's `currentVersion` (the last confirmed base version), so
a criterion retired while drafting v3 on top of v2 records `retiredInVersion:
2`, exactly as one created then records `createdInVersion: 2`. Nothing reads
either field functionally today; the spec table's "= currentVersion" wording
is accurate and the convention is documented in code rather than changed.

## D-014-15 (S-072) — Multi-form decision provenance and the "other" label

With `forms[]`, `decisionSource` is `student_changed` whenever a non-empty
set changes (adding a second form counts as a change, not only replacing
one) and `student_confirmed` on the first pick; ledger consumers reading
`decisionSource` should treat it as "the student revisited the decision",
not "the form was swapped". `formOtherLabel` is retained when `other` is
untoggled so an accidental click does not lose the student's own words, and
read contexts (Final PRD Read View, comma-joined labels) fall back to a plain
"기타 / Other" — never the picker's "(직접 적기) / (describe it)" hint. AI form
proposal cards stay visible while any proposed form is still unchosen, so
"여러 개 가능" is true from the cards as well as the toggles. The plan
generation directive binds the model to the chosen *stack* only; form
guidance lives solely in the additive scaffolding block.

## D-014-16 (S-075) — The architecture decision is one stack confirmation; the form taxonomy is removed

Owner question (2026-08-26): is the web-app / API-service picker a necessary
step at all? Fresh look: the 2026-06-29 requirement was student agency over
*how it is built* — the stack the AI will use — not a classification of the
product. The form layer (S-047 Q1) restates what the goal already says, is
the only reason the picker needs six buttons and definitions, and after
Constitution VII performs no downstream work (its scaffolding and
consistency check are gone). It is removed entirely, superseding S-072's
`forms[]` re-model one day after it landed; the S-072 work that survives is
Principle VII itself, the removal of the exclusionary machinery, and the
legacy-tolerant deserialization. The mandatory decision remains but is
reframed for a novice as confirmation — "AI가 이렇게 만들 계획이에요: <stack>
(<one-line why>) — 괜찮으면 확정, 아니면 고쳐 쓰세요" — because the value of
the step is transparency and consent, not a choice a beginner cannot
evaluate. Legacy `form` / `forms` / `formOtherLabel` keys are ignored on
load; no migration. `decisionSource` keeps its meaning: `student_confirmed`
on the first accepted/typed stack, `student_changed` when it is edited
afterwards.

## D-014-17 (S-075) — Stack confirmation provenance and the chat-agreement path

Review of 17346c5c: `decisionSource` bookkeeping in the board mis-stamped two
sequences (`student_confirmed` after an async same-id draft restore, and
after clear → blur → retype). The board now re-seeds its committed-stack
reference whenever an external draft arrives and never downgrades a
committed value to empty, so "edited afterwards" reliably records
`student_changed`; Rust mirrors the TS normalizer's defaults
(`decisionSource` → migration, `decidedInVersion` → 1) for rows missing
them. Because the AI cannot record the stack (Constitution VI), the prompt
now tells the model what to do when the student agrees in chat — point them
at the card or the input — instead of re-proposing every turn. Proposal
cards stay visible after a tap (the accepted one marked) until the next turn
so switching is discoverable, and the section says "아직 제안이 없어요 …
직접 적어도 됩니다" when nothing has been proposed yet, so the copy never
promises a proposal the student cannot see. Read view section title is
"만드는 방법 / How it's built" to avoid "기술 스택 / 기술 스택".
