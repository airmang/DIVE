# Data Model: Preview And Terminal Runtime Tools

## PreviewRequest

Represents a request to inspect a local project result through DIVE's Preview
surface.

**Fields**

- `request_id`: Stable identifier for the preview attempt.
- `session_id`: Session containing the request.
- `card_id`: Optional active step/card reference.
- `kind`: `static_file`, `local_url`, `dev_server`, or `auto`.
- `target`: Project-relative file path, local URL, or empty for auto/dev-server
  discovery.
- `source`: `student_action`, `ai_tool`, `review_action`, or `reroute`.
- `requested_at`: Local timestamp.

**Validation Rules**

- `static_file` must resolve inside the selected project and must be `.html` or
  `.htm`.
- `local_url` must use a supported scheme and loopback host.
- `dev_server` must use project preview metadata or configured scripts rather
  than arbitrary shell text.
- Requests without a selected project must be unavailable, not silently ignored.

## PreviewSession

Represents the active preview target and connection state.

**Fields**

- `request_id`: Preview request that created or updated the session.
- `status`: `opening`, `ready`, `unavailable`, or `failed`.
- `preview_url`: Local URL or app-safe file preview URL.
- `target_label`: Student-facing description of what is being previewed.
- `command_summary`: Optional bounded summary when a dev server was started or
  reused.
- `error_reason`: Optional unavailable or failure reason.
- `updated_at`: Local timestamp.

**State Transitions**

- `opening` -> `ready` when the preview target is reachable.
- `opening` -> `failed` when startup or loading fails.
- `opening` -> `unavailable` when validation rejects the target before any
  process starts.
- `ready` -> `unavailable` when the project changes or the target is no longer
  valid.

## ProjectCommandRequest

Represents a direct executable request for tests, builds, and simple checks.

**Fields**

- `tool_call_id`: Tool call identifier.
- `session_id`: Session containing the command request.
- `card_id`: Optional active step/card reference.
- `command`: Executable name or project-relative executable path.
- `args`: Ordered explicit arguments.
- `timeout_sec`: Bounded timeout.
- `reason`: Concise reason for running the command.
- `risk`: `safe`, `warn`, or `danger`.

**Validation Rules**

- Command must not be a platform shell wrapper.
- Command and args must not require shell interpretation.
- Path-like args must not escape the selected project.
- Known destructive patterns must be blocked before approval.
- If the request is clearly a local preview-open attempt, it should be blocked
  or rerouted rather than executed as Project Command.

## TerminalScriptRequest

Represents a high-risk shell-style verification request.

**Fields**

- `tool_call_id`: Tool call identifier.
- `session_id`: Session containing the script request.
- `card_id`: Optional active step/card reference.
- `script`: Full script text shown before approval.
- `shell_family`: `powershell`, `cmd`, `posix`, or `unknown`.
- `reason`: Why shell syntax is necessary.
- `expected_effect`: Expected project inspection or verification effect.
- `timeout_sec`: Bounded timeout.
- `output_limit`: Bounded output capture limit.
- `risk_factors`: Detected risk labels shown to the student.
- `approval_state`: `pending`, `approved`, `denied`, `blocked`, `stale`, or
  `completed`.

**Validation Rules**

- Always requires explicit high-risk approval.
- Approval is one-shot and must not be reused automatically.
- Known destructive, remote-execution, credential-exposure,
  privilege-escalation, and project-root escape patterns are blocked before
  execution.
- Script must remain bounded to the selected project.
- Output must be truncated and redacted before export.

## RuntimeRoutingDecision

Represents DIVE's classification of a requested runtime action.

**Fields**

- `decision_id`: Stable identifier.
- `session_id`: Session containing the decision.
- `input_kind`: `preview`, `project_command`, `terminal_script`, or `unknown`.
- `outcome`: `preview`, `project_command`, `terminal_script`, `blocked`,
  `rerouted`, `unavailable`, or `stale`.
- `reason_code`: Deterministic reason such as `static_html_preview`,
  `direct_command`, `shell_syntax_required`, `unsafe_pattern`,
  `external_url`, `project_escape`, `stale_approval`, or `missing_project`.
- `evidence_refs`: Bounded references to command text, target path, URL, active
  step, validation rule, or prior pending state.
- `created_at`: Local timestamp.

## ExecutionEvidence

Represents bounded evidence produced by Preview, Project Command, or Terminal
Script actions.

**Fields**

- `evidence_id`: Stable identifier.
- `session_id`: Session containing the evidence.
- `card_id`: Optional active step/card reference.
- `source`: `preview`, `project_command`, or `terminal_script`.
- `status`: `ready`, `passed`, `failed`, `blocked`, `unavailable`, or
  `cancelled`.
- `summary`: Concise student-facing result.
- `stdout_summary`: Optional bounded stdout summary.
- `stderr_summary`: Optional bounded stderr summary.
- `exit_code`: Optional process exit code.
- `preview_target`: Optional preview target label.
- `recorded_at`: Local timestamp.

**Validation Rules**

- Evidence must not include raw secrets, credentials, private environment dumps,
  or unnecessary raw file bodies.
- Preview readiness is not final verification evidence unless the student later
  records an observation or the verification policy accepts a related automated
  result.
- AI self-report must not populate this entity.

## StaleApprovalState

Represents an approval UI item whose backend request is no longer pending.

**Fields**

- `tool_call_id`: Original tool call identifier.
- `session_id`: Session containing the stale card.
- `detected_by`: `approval_click`, `deny_click`, `result_event`,
  `pending_refresh`, or `session_reload`.
- `message`: Student-facing explanation.
- `resolved_at`: Local timestamp.

**State Transitions**

- `pending` -> `stale` when backend resolution returns no active request.
- `pending` -> `denied` when validation failure is represented as a failed or
  denied command result.
- `pending` -> `blocked` when deterministic validation blocks the request.
