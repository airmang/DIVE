# Contract: Project Command Routing

## Purpose

Keep ordinary verification commands narrow, explainable, and distinct from
preview and shell-style terminal scripts.

## Request

`run_process`

```json
{
  "toolCallId": "call-123",
  "sessionId": 42,
  "cardId": 7,
  "command": "pnpm",
  "args": ["test"],
  "timeoutSec": 60,
  "reason": "Run the step verification command."
}
```

## Approval Surface

The approval card must show:

- executable name;
- explicit argument list;
- timeout;
- expected project effect;
- active step or criterion context when available;
- why DIVE wants to run the command.

## Result

```json
{
  "toolCallId": "call-123",
  "status": "completed",
  "success": true,
  "exitCode": 0,
  "summary": "exit 0 - tests passed",
  "stdoutSummary": "bounded stdout",
  "stderrSummary": ""
}
```

## Validation Rules

- Platform shell wrappers are not valid Project Commands.
- Shell metacharacters, command chaining, pipes, redirection, and shell
  substitution are not valid Project Commands.
- Project-root escape and known destructive patterns are blocked before
  approval.
- If a request is recognizably trying to open a local HTML preview, DIVE should
  produce a blocked/rerouted state and offer Preview when safe.
- Validation failure must resolve the pending card as blocked, denied, or
  stale; it must not leave an actionable approval button.

## Preview Reroute Result

```json
{
  "toolCallId": "call-456",
  "status": "rerouted",
  "rerouteTo": "preview",
  "target": "index.html",
  "message": "DIVE did not run the shell command. Open this file through Preview instead."
}
```
