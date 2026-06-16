# Contract: EventLog And Export

## Runtime Capability Events

Event: `runtime.capability_evaluated`

Required payload:

- `status`: `ready` or `unavailable`
- `provider_kind`
- `model`
- `reason_code`
- `setup_action`
- `message`
- `created_at`

Redaction:

- No API keys, OAuth tokens, raw auth files, or environment dumps.

## Scope Supervisor Events

Event: `provocation.supervisor_evaluated`

Existing supervisor evaluation payload is reused with:

- `event`: `scope_expansion`
- `artifact_ref`
- `context_hash`
- `evidence_hash`
- `evidence_refs`
- `validation_outcome`
- `drop_reason`
- `decision_summary`
- `model`
- `latency_ms`
- `usage`

Related UI events:

- Card exposure.
- Card action.
- Dismiss.
- Mark irrelevant.

Redaction:

- Evidence summaries are bounded and sanitized.
- Raw PRD text, raw diffs, full terminal logs, secrets, and student PII are not
  exported.

## Rationale Challenge Events

Event: `plan_step_rationale_challenged`

Required payload:

- `project_id`
- `plan_id`
- `step_id`
- `stable_step_id`
- `linked_criterion_ids`
- `objection_id`
- `objection_summary`
- `suggestion_status`

Event: `plan_adjustment_offered`

Required payload:

- `project_id`
- `plan_id`
- `step_id`
- `stable_step_id`
- `objection_id`
- `offer_id`
- `offer_kind`
- `offer_summary`

Events: `plan_adjustment_accepted`, `plan_adjustment_dismissed`

Required payload:

- `project_id`
- `plan_id`
- `step_id`
- `stable_step_id`
- `objection_id`
- `offer_id`
- `response`

## Spec Conformance Documentation

Status documents are not EventLog entries, but completion must update the
canonical spec index/status ledger so exports and future audits can be
interpreted against the correct product state.
