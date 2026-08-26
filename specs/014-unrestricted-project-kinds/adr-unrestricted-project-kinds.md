# ADR — Amendment: Unrestricted Project Kinds (new Principle VII)

**Status**: Accepted (2026-08-25 — owner-directed; affected-template review: plan-template.md gains a VII gate line, spec-template.md and tasks-template.md reviewed with no change required. Constitution amended to 1.2.0 in the same commit.)
**Constitution version**: 1.1.0 → **1.2.0** (MINOR — one new principle; no existing obligation redefined)
**Driver**: spec `specs/014-unrestricted-project-kinds/spec.md`, Stage **S-072**
**Affected principles**: new **VII**; cross-refs I (real workflow), V (low friction), VI (typed seams, student agency)
**Supersedes**: `specs/010-beginner-readiness-ux/design-s047.md` resolved decision **Q1** ("Form taxonomy = bounded enum") and the **Q2 follow-up closed in S-049** (per-form scaffolding block + `plan_form_consistency` annotation)
**Date**: 2026-08-25

---

## 1. Context — why this ADR exists

The owner's product rule that DIVE must not restrict what kinds of projects a
student can build was stated in conversation before round 2 but never entered
canon. On 2026-06-29 the owner asked for a *mandatory* architecture decision
in the PRD interview ("반드시 어느 아키텍처로 만들건지 정해야 할 것 같은데 그걸 안
정하고 넘어가네"). The resulting spec text (010 Theme 7, 2026-06-30) and design
(`design-s047.md`, 2026-07-01) translated "decide the architecture" into a
**bounded single-value form enum** with the rationale that a bounded set makes
"a stack consistent with that form" checkable and keeps the picker small. The
S-049 tail closeout (2026-07-02) then added per-form planner scaffolding that
says "avoid X" and a deterministic `plan_form_consistency` check that flags
steps *contradicting* the form.

Every one of those steps passed the Constitution Check: nothing in I–VI
forbids a taxonomy. Team QA on 2026-08-24 surfaced the consequence ("웹앱 또는
API 둘 중 하나만 선택할 수 있음 — API까지 연결해야 하면?"), and the owner
re-stated the rule as non-negotiable on 2026-08-25. Governance requires an
explicit ADR + rationale + template review + owner approval for a new
principle; this is that record.

## 2. Decision

### Old decision (S-047 Q1 + S-049 Q2 follow-up)
- `ArchitectureDecision.form` is one of six enum values (`other` + label as
  escape hatch). One form per PRD.
- The planner prompt injects a per-form block that both prescribes coverage
  and *excludes* other kinds of work ("avoid CLI-only deliverables", "avoid
  UI/DOM/browser-page steps").
- A deterministic check annotates plan steps whose text "contradicts" the form
  into the EventLog (`plan.form_consistency`, non-blocking).

### New decision (Principle VII, 1.2.0)
DIVE MUST NOT restrict what kinds of projects a student can build. Any
classification exists to help the student decide and to give the planner
context; it MUST NEVER function as an exclusion rule. Concretely, taxonomies
are multi-valued with a free-text escape hatch; classification-derived
scaffolding is additive only and says so; no deterministic check may flag a
step or field as contradicting the project's kind; no copy presents kinds as
"one of these only"; a mandatory decision is compatible only while every
option (including combinations and the student's own words) remains
selectable and unpenalised downstream.

### Migration consequence (S-072)
- `form` → `forms: ArchitectureForm[]`; legacy `form` folds into `forms` on
  deserialize (no data migration).
- Scaffolding rewritten as a positive union with a closing "not limits" line.
- `plan_form_consistency` module, lifecycle hook, event constant/payload and
  test removed; the event type is retired (historical exports untouched).
- Per-form definitions and "several forms are fine" copy added to the board
  and the interview prompt.

## 3. Alternatives considered

- **Keep the enum, add copy explaining that "web app" includes its backend.**
  Fixes the reported confusion but leaves the exclusion machinery (single
  choice, "avoid" scaffolds, contradiction check) in place — the next taxonomy
  would drift the same way. Rejected.
- **Add composite values (`fullstack_web_app`).** Multiplies the enum, keeps
  single choice, duplicates meaning with `web_app`. Rejected.
- **Keep `plan_form_consistency` as log-only under union semantics.** Its
  only meaning is "this step is the wrong kind", which VII rejects (D-014-03).
  Rejected.
- **Put the rule inside Principle I.** A rule that must veto designs that
  satisfy I–VI needs its own gate (D-014-01). Rejected.

## 4. Template review

- `.specify/templates/plan-template.md` — Constitution Check gains
  "**Unrestricted project kinds (VII)**".
- `.specify/templates/spec-template.md`, `tasks-template.md` — reviewed, no
  change (they do not enumerate principles).

## 5. Consequences

- Positive: the product identity ("DIVE supervises whatever you build") is
  now enforceable at plan review; the specific QA item is resolved at the
  root; a student can record "웹 앱 + API 서비스" and get a plan that covers
  both.
- Cost: a cross-language model change (TS + Rust + tests), removal of one
  S-049 research-ledger annotation, i18n additions in ko/en.
- Follow-up: any future classification (domain, size, audience) must be
  designed against VII from the start.

## 6. Post-script (2026-08-26, S-075)

The multi-valued `forms[]` in §2 was itself superseded one day later: the
owner judged the form taxonomy an unnecessary step, and D-014-16 removed it
in favour of a single stack confirmation. Principle VII is unchanged — with
no project-kind taxonomy left, VII is satisfied trivially and remains the
guard against reintroducing one.
