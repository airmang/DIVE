# Data Model: Provocation Supervisor Agent

**Spec**: [spec.md](./spec.md)

## SupervisorMode

- `mode`: `work | guided`
- `sourceUiMode`: optional migration metadata, one of `guided | standard |
  expert` when the input was normalized.

Validation:

- `guided -> guided`
- `standard -> work`
- `expert -> work`
- Unknown input yields `invalid_mode` and no SupervisorAgent call.

## SupervisorEvent

- `ai_claimed_done`: records assistant completion claim as evidence only.
- `verify_entered`: evaluates the P1 card gate and is the only P1 render event.

Future events `plan_drafted`, `diff_ready`, and `retry_loop` are out of P1.

## ArtifactRef

- `kind`: `step` for P1; future-safe string enum for other artifacts.
- `id`: stable project/session-local artifact id.
- `label`: short human-readable artifact label.

Validation:

- `kind` and `id` are required for context construction.
- `label` is sanitized and bounded before logs/export.

## EvidenceRef

- `id`: stable within one `SupervisorContext`; dot-separated path-like id.
- `source`: `goal | plan | prompt | diff | verification | terminal | agent |
  workmap | history | ui_observation`
- `kind`: `assistant_claim | verify_log | test_result | diff_review |
  preview_observed | app_launched | manual_check | changed_file |
  terminal_error | plan_step | acceptance_criteria | retry_count`
- `label`: bounded display label.
- `valueSummary`: sanitized structured summary, never raw code/transcript.
- `verificationEvidence`: boolean; always `false` for `assistant_claim`.

Relationships:

- `SupervisorDecision.evidenceRefIds` must reference existing `EvidenceRef.id`
  values.
- `evidenceHash` is computed from sorted evidence ids and sanitized
  `valueSummary` values.

## VerificationState

- `aiSelfReport`: assistant or verify-log claim exists.
- `concreteEvidence`: true only when actual verification evidence exists.
- `testResult`: `pass | fail | skipped | null`.

Concrete evidence can come from explicit diff review, app launch observation,
preview observation, manual check, automated test pass, or external test
observation. Clicking a verify action is not evidence by itself. Preview/app
signals count only when the target is available, shown, and tied to criterion
confirmation.

## VerificationFeasibility

- `runnable`: a runnable app target is currently available.
- `previewable`: a preview target can actually be opened.
- `hasTests`: a test command/suite exists for the artifact.
- `diffAvailable`: changed files/diff can be inspected.

Validation:

- `allowedActionIds` must exclude actions whose preconditions are false.
- Questions must not instruct infeasible verification.
- The approval flow must remain passable when no concrete verification is
  currently feasible.

## DecisionGateProceedOutcome

- `approved`: normal approval with concrete verification evidence.
- `approved_with_concern`: risk-accepted proceed, equivalent to existing
  `continue_with_risk`, requiring a reason.
- `verification_deferred`: non-risk proceed when feasibility shows concrete
  verification is not currently possible.

Relationships:

- Proceed outcomes are owned by DIVE's DecisionGate, not SupervisorAgent.
- SupervisorAgent `suggestedActionIds` may contain only verification nudges:
  `open_diff`, `open_preview`, `run_tests`, or `run_app` after feasibility
  filtering.
- `verification_deferred` must be logged/exported distinctly from
  `continue_with_risk`.

## SupervisorContext

- `schemaVersion`: `1`
- `event`: `SupervisorEvent`
- `artifactRef`: `ArtifactRef`
- `contextHash`: sha256 over stable identifiers.
- `mode`: `SupervisorMode.mode`
- `locale`: `ko-KR` for P1 default.
- `allowedActionIds`: feasibility-filtered action IDs.
- `goalSummary`: bounded sanitized summary.
- `planSummary`: bounded sanitized plan metadata.
- `verificationState`: `VerificationState`
- `feasibility`: `VerificationFeasibility`
- `evidenceRefs`: `EvidenceRef[]`

Hash rules:

- `contextHash` includes event, artifact ref, sorted evidence ref ids, and
  verification/feasibility flags.
- `contextHash` excludes free-text summaries.
- `evidenceHash` includes sorted evidence ref ids and sanitized `valueSummary`.
- `evidenceHash` excludes event.

## SupervisorDecision

- `schemaVersion`: `1`
- `provoke`: boolean.
- `concern`: P1 must be `ai_self_report_only`.
- `severity`: advisory only in P1; rendered card severity is fixed `caution`.
- `question`: one criterion-linked student-facing question.
- `evidenceRefIds`: non-empty for `provoke=true`.
- `suggestedActionIds`: subset of `allowedActionIds` after stripping unknowns.
- `supervisionHabit`: optional one-line guided copy.
- `logRationale`: sanitized log/debug metadata only.

Validation:

- `provoke=false` logs `provoke_false` and yields no card.
- Non-question or over-cap question drops the decision.
- Unknown action IDs are stripped and logged, not a drop cause by themselves.
- Unknown evidence refs, empty evidence refs, wrong concern, malformed JSON, or
  unsupported schema version drop the decision.
- Proceed/approve actions are never accepted as SupervisorAgent suggestions.

## SupervisorValidationResult

- `validationOutcome`: `shown | none | dropped | error`
- `dropReason`: one of the stable drop reason ids from `spec.md`.
- `cardId`: present only for shown cards.
- `strippedActionIds`: optional list.
- `decisionSummary`: sanitized bounded summary.

## SupervisorEvaluationLog

- `schemaVersion`
- `event`
- `artifactRef`
- `contextHash`
- `mode`
- `sourceUiMode` when normalized
- `evidenceRefs`
- `supervisorModel`
- `latencyMs`
- `usage`
- `decisionSummary`
- `validationOutcome`
- `dropReason`
- `cardId`
- `userResponse` when available

Export validation:

- Raw code, raw diffs, raw terminal output, full transcripts, secrets, OAuth
  tokens, API keys, full environment dumps, and unmasked student PII are
  prohibited.

## ProvocationCard Mapping

Valid P1 decisions map to the existing UI-facing `ProvocationCard`:

- `type`: `ai_self_report_only`
- `stage`: `verify` or `finalApproval` depending on placement.
- `severity`: fixed `caution`.
- `prompt`: `SupervisorDecision.question`
- `evidence`: projected from referenced `EvidenceRef` values, capped to 3.
- `actions`: projected from allowed suggested actions, capped to 3.
- `primaryActionId`: first feasible evidence-seeking action.
- `metadata`: includes hashes, concern, validation metadata, and supervisor log
  correlation keys.

## State Transitions

```text
ai_claimed_done
  -> record assistant_claim EvidenceRef candidate
  -> no card render

verify_entered
  -> normalize mode
  -> compute evidence and feasibility
  -> if !(aiSelfReport && !concreteEvidence): log validationOutcome=none
  -> if gate fires: call SupervisorAgent with tools=[]
  -> parse SupervisorDecision
  -> validate evidence/action/question/dedup
  -> shown: map to ProvocationCard and log evaluation then exposure
  -> dropped/error: log evaluation only
```
