# Contract: EventLog And Export

## Event Types

### `verification_coach.requested`

Logged when the review panel requests guidance.

Required payload fields:

- `eventId`
- `sessionId`
- `cardId`
- `planStepId`
- `guideVersion`
- `sourceUiMode`
- `evidenceSummary`
- `requestedAt`

### `verification_coach.evaluated`

Logged after guidance generation and validation.

Required payload fields:

- `eventId`
- `status`: `shown`, `unavailable`, or `dropped`
- `validationOutcome`
- `reasonCode`
- `evidenceRefs`
- `model`
- `latencyMs`
- `guideSummary`

### `verification_observation.recorded`

Logged when a student records observation evidence.

Required payload fields:

- `observationId`
- `sessionId`
- `cardId`
- `planStepId`
- `guideVersion`
- `evidenceKind`
- `criterionIds`
- `observationText`
- `recordedAt`

### `verification_observation.cleared`

Logged if the student removes or replaces observation evidence.

Required payload fields:

- `observationId`
- `sessionId`
- `cardId`
- `planStepId`
- `clearedAt`

## Export Expectations

- EventLog rows are exported with existing session export.
- Card export continues to include `approval_provenance` and
  `verification_evidence_summary`.
- Step mapping export continues to include `verification_status`,
  `verification_evidence`, and `user_decision`.
- Export must distinguish AI guidance, AI self-report, student observation,
  automated test result, risk acceptance, and verification deferral.

## Redaction Rules

- Observation text may be hashed when user-text hashing is enabled.
- Raw code bodies, OAuth tokens, API keys, private environment dumps, and
  unnecessary terminal bodies must not be exported.
- File paths and bounded command labels are allowed when needed to reconstruct
  verification behavior.
