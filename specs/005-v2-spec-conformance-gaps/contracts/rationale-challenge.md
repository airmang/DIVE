# Contract: Rationale Challenge Offer

## Purpose

Ensure a student's objection to a decomposition rationale is logged and receives
a visible non-blocking next action without silently mutating the plan.

## Challenge Input

Required fields:

- `planId`
- `stepDbId`
- `text`
- `linkedCriterionIds`

Validation:

- `text` must be non-empty after trimming.
- `stepDbId` must belong to `planId`.
- Linked criteria are taken from the visible step context when the caller does
  not provide them.

## Challenge Output

Required fields:

- `objectionId`
- `suggestionStatus`: `offered`
- `offerId`
- `offerKind`: `redecompose_step` or `adjust_plan`
- `message`

The output may include a short seed for the dedicated plan-area proposal.

## Offer Behavior

- The offer appears near the rationale challenge result.
- Dismissing or ignoring the offer does not block current-step execution.
- Accepting the offer routes to a reviewable plan-area suggestion.
- Accepting the offer does not append, change, or retire a step without
  dedicated plan-area confirmation.

## Ledger

Required event records:

- `plan_step_rationale_challenged`
- `plan_adjustment_offered`
- `plan_adjustment_accepted` or `plan_adjustment_dismissed` when the student
  responds.

Records must include project, plan, step, linked criteria, objection ID, offer
ID when present, and redacted objection/offer summaries.
