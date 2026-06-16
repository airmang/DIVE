# Contract: Expanded Supervisor Events

## Tauri Command

The existing command remains the public boundary:

```text
provocation_agent_evaluate({ request })
```

The command accepts the existing request variants plus expanded event variants.

## Request Shape

```ts
type ExpandedSupervisorEvent = "plan_drafted" | "diff_ready" | "retry_loop";

interface ExpandedSupervisorEvaluationRequest {
  sessionId: number;
  event: ExpandedSupervisorEvent;
  artifactRef: SupervisorArtifactRef;
  sourceUiMode?: SupervisorSourceUiMode;
  mode?: SupervisorMode;
  locale?: string;
  projectId?: number;
  planId?: number;
  contextHash?: string;
  evidenceHash?: string;
  uiState: SupervisorEvaluationUiState;
  allowedActionIds: SupervisorAllowedActionId[];
  evidenceRefs: SupervisorEvidenceRefContract[];
  planDraftAssessment?: PlanDraftReviewAssessment;
  diffReadyAssessment?: DiffReadyReviewAssessment;
  retryLoopAssessment?: RetryLoopReviewAssessment;
}
```

Rules:

- `planDraftAssessment` is required only for `plan_drafted`.
- `diffReadyAssessment` is required only for `diff_ready`.
- `retryLoopAssessment` is required only for `retry_loop`.
- Unknown, missing, empty, or mismatched assessments produce no card or a
  dropped outcome.
- Request evidence must be bounded summaries, not raw diffs or full terminal
  output.

## Response Shape

The response remains unchanged:

```ts
type SupervisorEvaluationResponse =
  | { status: "shown"; evaluationId: string; card: ProvocationCard }
  | { status: "none" | "dropped"; evaluationId: string; dropReason: SupervisorDropReason };
```

## Rust Validation Contract

Rust must validate:

- `SupervisorEvent` includes `PlanDrafted`, `DiffReady`, and `RetryLoop`.
- The event-specific assessment exists for the event.
- The deterministic gate is true before Pi is invoked.
- `SupervisorDecision.concern` matches the event.
- Every `evidenceRefId` exists in the DIVE-provided refs.
- The question is shaped as a question and within caps.
- Suggested actions are known and included in the event allowlist.
- Proceed/risk-approval actions are rejected for these cards.
- Duplicate/cooldown outcomes return no card or dropped outcome as today.
- Existing UI action kinds should be reused where possible:
  `add_verification_step`, `ask_ai_for_rationale`,
  `revert_unrelated_changes`, `create_repro_steps`, and
  `rollback_last_change` are valid candidates once Rust allowlists support
  them. `retry_with_ai` must not be the primary action for `retry_loop`.

## EventLog Payload

The existing `provocation.supervisor_evaluated` event is extended by payload
values, not by new EventLog event types.

Minimum payload:

```json
{
  "schemaVersion": 1,
  "event": "plan_drafted",
  "artifactRef": {
    "kind": "plan_draft",
    "id": "plan-42:draft",
    "label": "Plan draft"
  },
  "contextHash": "sha256:...",
  "evidenceHash": "sha256:...",
  "mode": "work",
  "validationOutcome": "shown",
  "dropReason": null,
  "cardId": "provocation:plan-42:plan_draft_review:...",
  "supervisorEvaluationId": "uuid",
  "decisionSummary": {
    "provoke": true,
    "concern": "plan_draft_weakness",
    "severity": "caution",
    "evidenceRefIds": ["plan.step.S-001", "plan.criteria.coverage"],
    "suggestedActionIds": ["link_criterion", "split_scope"],
    "strippedActionIds": []
  },
  "evidenceRefs": [],
  "assessmentSummary": {
    "reasonCodes": ["missing_verification"],
    "evidenceRefs": ["plan.step.S-001"]
  }
}
```

Export sanitization must remove raw code, raw diffs, raw terminal bodies,
secrets, tokens, credentials, student PII, and private environment dumps.

## UI Placement Contract

- `plan_drafted`: render within `PlanDraftApprovalScreen` beside the plan
  approval content, before or near the plan draft review area.
- `diff_ready`: render in `StepDetailSlideIn` beside changed-work or
  step-review details.
- `retry_loop`: render beside the verification failure, terminal failure, or
  recovery surface that owns the active step/session context. Do not render a
  global terminal heuristic card without active step evidence.
- Expanded cards must not render in ordinary chat messages.
- Existing `scope_expansion` and `verify_entered` behavior must not regress.
