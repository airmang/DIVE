# 011 Conference Demo Readiness — Decision Log

## D-011-01 (2026-07-10) — Re-tune the S-035 plan-quality gate to bundle/step-level verifiability

**Context.** The deterministic plan-quality gate introduced by 009 theme 7 /
S-035 (`validate_criterion_quality`) blocked every new-project plan generation in
the 2026-07-10 conference-readiness QA (P0-01): a single criterion's phrasing
vetoed the whole plan, generic goal nouns (`화면`, `버튼`, `page`, `button`)
forced responsive/persistence/accessibility criterion classes, the numeric-marker
context list was English-only (Korean quantity criteria earned no credit), and
the recovery guidance was English-only category prose whose echoed examples did
not themselves pass the validator — so retries could not converge (3 models, PRD
v2 rewrite, all blocked).

**Decision.** Keep the gate deterministic and blocking for real junk and
unverifiable plans, but move the observable-marker requirement from
per-criterion veto to bundle/step-level: block only on empty criteria, junk
criteria, a plan with zero marker-bearing criteria, a step with no
marker-bearing criterion, or a clearly-signaled data-fetch goal missing
loading/empty/error. Everything else becomes a non-blocking advisory
(`plan.criterion_quality_advisory` EventLog annotation, S-049 precedent). Goal
classifiers shrink to explicit requirement signals. Backend emits machine-coded
issues; the frontend renders app-locale recovery copy with concrete example
rewrites that are regression-locked to pass the validator (self-pass suite).
Full design: `design-s050.md`.

**Why not remove the gate?** S-035's teaching intent (block-and-re-ask on
unverifiable plans; loading/empty/error for data-fetch goals) is core
anti-automation-bias pedagogy and stays. The QA showed a calibration failure,
not a concept failure.

**Consequences.** `specs/009-e2e-quality-hardening/s035-prd-interview-scaffolding.md`
gets a forward-pointer annotation to this decision. Any future criterion-class
or keyword addition must ship with a unit-test justification and keep the
self-pass suite green. S-056's step-overlap validation (P2-03) must use the same
advisory-first pattern and self-pass lock.
