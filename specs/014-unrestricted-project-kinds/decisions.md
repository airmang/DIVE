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
