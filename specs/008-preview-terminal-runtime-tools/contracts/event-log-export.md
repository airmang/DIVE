# Contract: EventLog And Export

## Event Types

### `runtime.routing_decision`

Logged when DIVE classifies an attempted runtime action.

Required payload fields:

- `decisionId`
- `sessionId`
- `cardId`
- `inputKind`
- `outcome`
- `reasonCode`
- `evidenceRefs`
- `createdAt`

### `preview.open_requested`

Logged when Preview is requested.

Required payload fields:

- `requestId`
- `sessionId`
- `cardId`
- `kind`
- `targetLabel`
- `source`
- `requestedAt`

### `preview.open_result`

Logged when Preview resolves.

Required payload fields:

- `requestId`
- `status`: `ready`, `failed`, or `unavailable`
- `targetLabel`
- `reasonCode`
- `message`
- `resolvedAt`

### `project_command.result`

Logged when a direct command completes, fails, is denied, or is blocked.

Required payload fields:

- `toolCallId`
- `sessionId`
- `cardId`
- `commandLabel`
- `status`
- `success`
- `exitCode`
- `summary`
- `stdoutSummary`
- `stderrSummary`
- `createdAt`

### `terminal_script.approval_requested`

Logged when DIVE asks for Terminal Script approval.

Required payload fields:

- `toolCallId`
- `sessionId`
- `cardId`
- `shellFamily`
- `scriptSummary`
- `reason`
- `expectedEffect`
- `riskFactors`
- `requestedAt`

### `terminal_script.result`

Logged when a Terminal Script is denied, blocked, completed, failed, or
cancelled.

Required payload fields:

- `toolCallId`
- `status`
- `success`
- `exitCode`
- `summary`
- `stdoutSummary`
- `stderrSummary`
- `truncated`
- `resolvedAt`

### `tool_approval.stale`

Logged when a visible approval request is no longer backed by a pending runtime
request.

Required payload fields:

- `toolCallId`
- `sessionId`
- `detectedBy`
- `message`
- `resolvedAt`

## Export Expectations

- EventLog rows are exported through the existing session export path.
- Export must distinguish Preview availability from user-observed verification
  evidence.
- Export must distinguish Project Command output from Terminal Script output.
- Export must distinguish AI self-report, user observation, automated command
  evidence, and final approval decision.
- Blocked, rerouted, denied, stale, and unavailable states must remain visible
  in export.

## Redaction Rules

- Raw secrets, OAuth tokens, API keys, private environment dumps, and full
  unbounded terminal output must not be exported.
- Script bodies may be summarized or redacted when they include sensitive
  values; the displayed approval still needs enough information for the user to
  decide.
- Project-relative file paths, local URL labels, bounded command labels, exit
  status, and bounded output summaries are allowed when needed to reconstruct
  supervision behavior.
