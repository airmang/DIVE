# Feature Specification: E2E Quality Hardening (Journey-Driven)

**Feature Branch**: `009-e2e-quality-hardening`

**Created**: 2026-06-24

**Status**: Draft

**Input**: Finishing-stage quality push. 50 real-user end-to-end journeys (goal → PRD design → plan → implement → verify → done) were designed and gap-analyzed against the codebase to surface "what's lacking, where it breaks, and what to build to raise quality." Full evidence: [`docs/qa/e2e-journeys.md`](../../docs/qa/e2e-journeys.md) (50 journeys) and [`docs/qa/e2e-gap-backlog.md`](../../docs/qa/e2e-gap-backlog.md) (127 gaps, 12 themes). Live QA harness + first confirmed defect (DEF-01) in [`docs/qa/`](../../docs/qa/).

## Context And Why

DIVE works (the supervised loop — provocation/review cards, tool-approval cards, verification stepper, recovery — renders and functions; live-validated). But running 50 realistic E2E journeys exposed that **the experience falls short exactly where DIVE is supposed to be strongest: the verify stage holds 67 of 127 gaps (~half)**, and several P0s independently break a credible English-locale run.

This spec frames the program of work to close the highest-value gaps. It is journey-driven: every requirement traces to one or more journeys and a code-confirmed root cause. Per-theme detailed plans/tasks live in their own follow-up specs (or this spec's `plan.md`/`tasks.md`) when each theme is picked up.

### Confirmed roots (spot-verified in source)

- `dive/src-tauri/src/dive/supervisor.rs` — the supervisor prompt hardcodes *"Ask one criterion-linked **Korean** question"*, so the trust-critical provocation/review-card question is always Korean regardless of UI locale.
- `dive/src/features/roadmap/agencyStatus.ts` — `AGENCY_STATE_META` hardcodes all 12 status-badge labels in Korean (no i18n).
- `dive/src/components/slide-in/PreviewTab.tsx:247` — iframe `sandbox="allow-scripts allow-same-origin"` (no `allow-modals`/`allow-forms`), fixed width, and CSP block external fetch — so the preview can't run modals/forms, show responsive breakpoints, or fetch real data.

## Requirements *(prioritized themes)*

Severity reflects impact on a credible E2E experience. P0 = independently breaks a believable run.

### P0

1. **i18n localization debt** — Korean leaks at English locale across trust-critical supervised UI. → Stage **S-026**. (themes/gaps: i18n cluster, DEF-01)
2. **Verification evidence is hollow** — opening a diff or typing free text can clear the decision gate without real per-criterion observation; defeats the anti-rubber-stamp promise (002/003 FR-030~033: click ≠ evidence). → Stage **S-028** (depends on S-027).
3. **In-app preview can't exercise the behavior under test** — sandbox suppresses modals/forms, fixed-width iframe hides responsive behavior, CSP blocks fetch. The preview is where "observe" must happen, so this gates theme 2. → Stage **S-027**.

### P1 (next specs/Stages)

4. **Recovery anchors** — file-only restore; no pre-edit / pre-pivot / pre-DIVE checkpoints; chat/plan state can desync from reverted files.
5. **Plan-edit routing** — add-only; no clarify / remove / genuine multi-step; multi-step asks get crammed into one step or dropped to chat.
6. **Beginner approval-card legibility** — no plain-language change summary, no read gate, weak secret/scope warnings (automation-bias risk).
7. **PRD / Socratic interview friction & weak criterion scaffolding.**
8. **Verification stepper false-completion & detection robustness** (shares the supervisor.rs locale fix).
9. **Production scope-drift / high-risk-file gate appears to be dead code.**

### P2 (polish)

10. Static-vs-server preview discoverability & onboarding.
11. Refactor/rename safety (behavior-preserving guidance, multi-replace, quieter search).
12. Coach degradation & criterion-specific fallback guidance.

## Non-Goals / Preserve (regression guards — do NOT "fix")

- Verification-coach **sidecar unavailability degrades cleanly** without hanging (APPS-05 / FRICTION-05). Add an integration test to lock this.
- **PlanDraftRecoveryScreen retry preserves** persisted interview answers and is i18n-clean (FRICTION-05). Add a test to lock this.

## Validation

The 12 highest-signal journeys in `e2e-gap-backlog.md` ("Recommended live-run subset") are run on the real built `.app` to confirm each P0/P1 gap before and after the fix. Each theme's acceptance criteria are written in its wily Stage and re-checked live in both `ko` and `en` locales.

## Tracking

- wily project `dive-2`: S-026 (i18n), S-027 (preview), S-028 (evidence gate) created; remaining themes become S-029+ as they are picked up.
- Implementation follows the loop: spec/plan a theme → implement → local CI gates → rebuild → live re-run the relevant journeys → verify.
