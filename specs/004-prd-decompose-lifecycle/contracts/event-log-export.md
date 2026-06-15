# Contract: EventLog And Export

004 must preserve local-first reconstruction of the PRD and plan lifecycle.

## Event Names

### `prd_patch_proposed`

Required payload fields:

- `project_id`
- `project_spec_id`
- `draft_id`
- `turn_id`
- `patch_id`
- `operation_kinds`
- `rationale_summary`

### `prd_patch_applied`

Required payload fields:

- `project_id`
- `project_spec_id`
- `draft_id`
- `turn_id`
- `patch_id`
- `applied_field_paths`
- `criterion_ids_assigned`
- `student_edited_fields_respected`

### `prd_patch_rejected`

Required payload fields:

- `project_id`
- `project_spec_id`
- `draft_id`
- `turn_id`
- `patch_id`
- `reason_codes`
- `held_for_student`

### `prd_authored`

Required payload fields:

- `project_id`
- `project_spec_id`
- `version`
- `source`: `interview`
- `criterion_ids`
- `summary`

### `prd_edited`

Required payload fields:

- `project_id`
- `project_spec_id`
- `from_version`
- `to_version`
- `reason`: `student_edit` | `ai_assist` | `plan_mutation`
- `changed_fields`
- `criterion_ids_added`
- `criterion_ids_retired`

### `prd_version_created`

Required payload fields:

- `project_id`
- `project_spec_id`
- `version`
- `previous_version`
- `delta_summary`

### `plan_generated`

Required payload fields:

- `project_id`
- `plan_id`
- `project_spec_id`
- `project_spec_version`
- `step_count`
- `criterion_coverage`
- `source`: `interview` | `student_edit` | `migration`

### `plan_step_rationale_challenged`

Required payload fields:

- `project_id`
- `plan_id`
- `step_id`
- `stable_step_id`
- `linked_criterion_ids`
- `objection_id`
- `objection_summary`
- `suggestion_status`

### `plan_step_appended`

Extends existing event.

Required additional payload fields:

- `mutation_id`
- `project_spec_id`
- `from_project_spec_version`
- `to_project_spec_version`
- `linked_criterion_ids`
- `scope_expansion`
- `prd_delta_summary`

### `plan_step_changed`

Required payload fields:

- `mutation_id`
- `project_id`
- `plan_id`
- `step_id`
- `stable_step_id`
- `changed_fields`
- `linked_criterion_ids`
- `from_project_spec_version`
- `to_project_spec_version`

## Export Expectations

An anonymized session export must be able to reconstruct:

- Current PRD.
- PRD version timeline.
- Interview-turn patch proposal/application/rejection timeline.
- Acceptance criteria with stable IDs and active/retired state.
- Each step's linked criterion IDs and rationale.
- Objections to step rationale and whether suggestions were offered.
- Mid-flow step additions and resulting PRD deltas.
- Scope-expansion review-card evaluation/exposure/action outcomes through the
  specs/002 event path.

## Redaction

- Reuse `dive::event_log::redact_value` and export redaction for all new events.
- Do not store raw secrets, OAuth tokens, private environment dumps, or raw
  terminal/source blobs inside PRD lifecycle event payloads.
- Store summaries and stable references where possible.
- Do not store raw interview answers when a sanitized summary is sufficient for
  reconstruction.
