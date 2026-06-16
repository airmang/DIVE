# Quickstart: LLM Verification Coach

## Prerequisites

- DIVE desktop app can run with a Pi-capable provider.
- Use a test project with an approved PRD-backed plan.
- Keep 006 Sarkar review-card expansion separate when comparing branches.

## Validation Scenario 1: CLI Step With No Preview

1. Open a project like `DIVE_TEST9` where Step 1 is a CLI/manual step.
2. Move the step into review/verifying state with changed files and no preview
   action.
3. Open `검토 열기`.
4. Verify the review panel shows verification coach guidance that names the
   completion criterion and suggests CLI/file checks.
5. Record a user observation linked to the criterion.
6. Confirm normal `승인` is enabled and completing the step records
   `verified_with_evidence`.

Expected result: the student is not left with an empty review surface, and AI
guidance is separate from observation evidence.

## Validation Scenario 2: No Observation, Risk Approval

1. Open a review step with guidance shown.
2. Do not record observation evidence or pass tests.
3. Attempt normal approval.
4. Confirm the decision gate explains missing evidence.
5. Enter a risk reason and choose risk approval.

Expected result: the step can complete only as `unverified_risk_accepted`, not
as verified with evidence.

## Validation Scenario 3: Automated Test Pass

1. Open a step with a valid verification command.
2. Run verification until the test result is pass.
3. Open review guidance.
4. Approve without manual observation.

Expected result: automated pass remains concrete evidence, and guidance does not
block approval.

## Validation Scenario 4: Guidance Unavailable

1. Simulate provider/Pi unavailability or malformed guidance output.
2. Open review.
3. Verify the panel shows a concise unavailable state with safe next actions.
4. Confirm request changes, risk approval, and deferral paths remain available
   according to existing evidence policy.

Expected result: no static provocation or generic warning fallback appears.

## Validation Scenario 5: Export Reconstruction

1. Complete one coached step with observation-backed approval.
2. Complete one coached step with risk approval.
3. Export the session.
4. Confirm exported records distinguish:
   - `verification_coach.requested`
   - `verification_coach.evaluated`
   - `verification_observation.recorded`
   - AI self-report from `verify_log`
   - final `approval_provenance`
   - step mapping `verification_evidence`

## Suggested Commands

```powershell
cd C:\Users\kokyu\Code\DIVE-2\dive
pnpm typecheck
pnpm test:unit -- StepDetailSlideIn.test.tsx DecisionGate.test.tsx verificationGrade.test.ts
cd src-tauri
cargo test verification_coach
cargo test export
```
