# Data Model: Sarkar Provocation Expansion

## ExpandedSupervisorEvent

Lifecycle event evaluated by the SupervisorAgent path.

| Field | Type | Notes |
| --- | --- | --- |
| `event` | enum | `plan_drafted`, `diff_ready`, or `retry_loop`. Existing `verify_entered` and `scope_expansion` remain valid. |
| `sessionId` | number | Current session for EventLog correlation and dedup state. |
| `projectId` | number? | Present when the surface has project context. |
| `planId` | number? | Present for plan and step-related events. |
| `artifactRef` | SupervisorArtifactRef | The plan draft, step, diff set, terminal failure, or recovery artifact where a card can render. |
| `sourceUiMode` | enum | Existing UI mode input; normalized to `work` or `guided` before supervisor validation/logging. |
| `locale` | string? | Defaults to Korean locale when omitted. |
| `uiState` | SupervisorEvaluationUiState | Existing bounded goal/plan/verification/feasibility state. |
| `allowedActionIds` | string[] | Event-specific action allowlist. |
| `evidenceRefs` | SupervisorEvidenceRefContract[] | Bounded evidence refs DIVE owns and validates. |
| `planDraftAssessment` | PlanDraftReviewAssessment? | Required for `plan_drafted`. |
| `diffReadyAssessment` | DiffReadyReviewAssessment? | Required for `diff_ready`. |
| `retryLoopAssessment` | RetryLoopReviewAssessment? | Required for `retry_loop`. |

Validation:

- Event-specific assessment must match `event`.
- Evidence ref ids referenced by an assessment must exist in `evidenceRefs`.
- Unknown event/assessment combinations drop with no card.

## SupervisorArtifactRef

Artifact identity used by the UI, supervisor context, card metadata, dedup, and
export.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | enum string | Existing `step`, `add_step_draft`, `plan_mutation`; add `plan_draft`, `diff`, `failure`. Prefer `step` for retry-loop artifacts when the active step is known. |
| `id` | string | Stable within the current project/session. |
| `label` | string | Bounded human-readable artifact label. |

## PlanDraftReviewAssessment

Deterministic plan approval assessment.

| Field | Type | Notes |
| --- | --- | --- |
| `eligible` | boolean | True only while draft awaits approval/revision. |
| `reasonCodes` | string[] | Examples: `missing_verification`, `unlinked_criteria`, `broad_step`, `unresolved_question`. |
| `evidenceRefs` | string[] | Plan, criteria, step, verification coverage, and revision-history refs. |
| `stepCount` | number | Number of draft steps considered. |
| `criteriaCount` | number | Number of acceptance criteria considered. |
| `unverifiedStepIds` | string[] | Capped stable step ids missing feasible verification evidence. |
| `unlinkedStepIds` | string[] | Capped stable step ids missing criterion linkage. |

State transitions:

- Draft opened -> assessment may be eligible.
- Draft revised -> recompute evidence/dedup identity.
- Draft approved/discarded -> assessment becomes ineligible.

## DiffReadyReviewAssessment

Deterministic changed-work assessment.

| Field | Type | Notes |
| --- | --- | --- |
| `eligible` | boolean | True only when changed files exist for the active step. |
| `reasonCodes` | string[] | Examples: `unexpected_file`, `outside_expected_files`, `high_risk_area`, `outside_prd_scope`. |
| `evidenceRefs` | string[] | Changed-file, expected-file, step-scope, PRD-scope, and diff-view refs. |
| `changedFileCount` | number | Count after generated/noisy entries are filtered or summarized. |
| `unexpectedFiles` | string[] | Capped, optionally hashed by export policy. |
| `highRiskFiles` | string[] | Capped paths or categories such as config/auth/package. |
| `diffViewed` | boolean | Whether the user has opened/reviewed the diff for this step. |

Validation:

- `eligible=false` or empty `reasonCodes` produces no card.
- A changed file count by itself is not a valid reason.

## RetryLoopReviewAssessment

Deterministic repeated-failure assessment.

| Field | Type | Notes |
| --- | --- | --- |
| `eligible` | boolean | True only after the same normalized failure recurs at least twice for one active step. |
| `reasonCodes` | string[] | Examples: `same_failure_repeated`, `blind_retry_risk`, `recovery_available`. |
| `evidenceRefs` | string[] | Terminal failure, verification failure, retry count, last action, and recovery refs. |
| `failureFingerprint` | string | Hash/stable normalized failure identity; raw body is not exported. |
| `failureCount` | number | Must be at least 2 for eligibility. |
| `lastFailureAt` | number/string | Timestamp or logical order marker. |
| `lastActionSummary` | string? | Bounded summary such as `asked_ai_to_fix` or `reran_tests`. |
| `recoveryAvailable` | boolean | Whether rollback/recovery is available. |

Reset rules:

- Successful verification resets the active failure loop.
- Recovery, rollback, or plan adjustment resets or changes the fingerprint.
- A materially different failure fingerprint starts a new loop.

## SupervisorDecision

Existing Pi output schema. Expanded events do not change the schema; they add
event-specific accepted `concern` values and action allowlists.

Expanded concern mapping:

- `plan_draft_weakness` for `plan_drafted`
- `diff_scope_drift` for `diff_ready`
- `retry_loop` for `retry_loop`

## ExpandedReviewCard

Existing `ProvocationCard` response with event-specific card type/stage.

| Event | Card Type | Stage | Allowed action examples |
| --- | --- | --- | --- |
| `plan_drafted` | `plan_draft_review` | `instruct` | `add_verification_step`, `link_criterion`, `split_scope`, `edit_prd`, `dismiss_review` |
| `diff_ready` | `diff_scope_review` | `verify` | `open_diff`, `ask_ai_for_rationale`, `revert_unrelated_changes`, `run_tests`, `dismiss_review` |
| `retry_loop` | `retry_loop_review` | `verify` | `create_repro_steps`, `rollback_last_change`, `open_diff`, `run_tests`, `split_scope`, `dismiss_review` |

## SupervisorEvaluationLog

Existing EventLog payload extended by event value and assessment metadata.

Required export fields for expanded events:

- `event`
- `artifactRef`
- `contextHash`
- `evidenceHash`
- `mode`
- `validationOutcome`
- `dropReason`
- `cardId`
- `supervisorEvaluationId`
- `decisionSummary`
- `evidenceRefs`
- event-specific bounded assessment summary
