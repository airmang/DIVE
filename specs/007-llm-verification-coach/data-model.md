# Data Model: LLM Verification Coach

## VerificationCoachingEvent

Represents a request for step-specific verification guidance during review.

**Fields**

- `event_id`: Stable identifier for the coaching attempt.
- `session_id`: Session containing the reviewed step.
- `project_id`: Optional project identifier.
- `step_ref`: Step/card reference and student-facing title.
- `guide_version`: Monotonic version for the step review.
- `source_ui_mode`: `work` or `guided`.
- `evidence_summary`: Bounded summary of inputs supplied to the coach.
- `requested_at`: Local timestamp.

**Validation Rules**

- Must reference an active step or card in review/verifying context.
- Must include at least one of: acceptance criterion, step goal, changed-work
  summary, verification log, or available verification action.
- Must not include raw secrets or private environment dumps.

## VerificationGuide

Validated guidance shown to the student.

**Fields**

- `event_id`: Coaching event that produced this guide.
- `guide_version`: Version correlated to the reviewed step.
- `status`: `shown`, `unavailable`, or `dropped`.
- `criterion_summary`: The completion criterion the student should judge.
- `recommended_checks`: Ordered list of concrete checks.
- `expected_observations`: What the student should see, run, or inspect.
- `evidence_prompts`: Prompts for recording observations.
- `unsupported_reason`: Reason when guidance is unavailable or dropped.
- `model`: Model identity when generated.
- `latency_ms`: Optional generation latency.

**Validation Rules**

- A shown guide must mention a completion criterion or explicitly state that the
  criterion is missing.
- Each recommended check must be grounded in supplied evidence or an available
  safe inspection action.
- Guidance must not assert that the step is complete.
- Guidance must be concise enough for the review panel.

## ObservationEvidence

Student-authored evidence recorded from the review panel.

**Fields**

- `observation_id`: Stable identifier for the observation.
- `session_id`: Session containing the reviewed step.
- `step_ref`: Step/card reference.
- `guide_version`: Optional guide version the observation followed.
- `criterion_ids`: Completion criteria the student says were observed.
- `observation_text`: Short user-authored description of what was observed.
- `evidence_kind`: `manual_observation`, `preview_observation`,
  `app_run_observation`, `terminal_observation`, `file_observation`, or
  `test_observation`.
- `recorded_at`: Local timestamp.

**Validation Rules**

- Evidence-backed approval requires at least one criterion id or criterion text
  confirmation plus non-empty observation text, unless an automated test passed.
- Observation text must be bounded and redacted before export.
- Observation evidence must remain separate from AI guidance and AI self-report.

## GuidanceValidationResult

Deterministic result of validating generated guidance.

**Fields**

- `event_id`: Coaching event.
- `outcome`: `valid`, `dropped`, or `unavailable`.
- `reason_code`: `runtime_unavailable`, `timeout`, `malformed_output`,
  `generic_guidance`, `unsupported_evidence`, `unsafe_action`,
  `missing_criterion`, or `ok`.
- `evidence_refs`: Evidence ids accepted by validation.
- `created_at`: Local timestamp.

## EvidenceBackedDecision

Final approval decision summary for export and step mapping.

**Fields**

- `approval_outcome`: `approved`, `approved_with_concern`,
  `revision_requested`, or `verification_deferred`.
- `verification_state`: `verified_with_evidence`,
  `unverified_risk_accepted`, `failed_but_accepted`, or
  `verification_deferred`.
- `evidence_summary`: Concrete evidence flags and labels.
- `observation_ids`: User observations considered in the decision.
- `risk_reason`: Optional student reason.
- `decided_at`: Local timestamp.

**State Transitions**

- `shown guide` -> `observation recorded` -> `approved` can produce
  `verified_with_evidence`.
- `shown guide` -> no concrete observation -> `approved_with_concern` produces
  `unverified_risk_accepted`.
- `guidance unavailable` -> `verification_deferred` produces
  `verification_deferred`.
- `failed test` -> `approved_with_concern` produces `failed_but_accepted`.
