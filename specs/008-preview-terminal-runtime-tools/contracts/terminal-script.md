# Contract: Terminal Script

## Purpose

Provide a distinct, high-risk path for legitimate shell-style verification
without weakening Project Command.

## Request

`run_terminal_script`

```json
{
  "toolCallId": "call-789",
  "sessionId": 42,
  "cardId": 7,
  "shellFamily": "powershell",
  "script": "pnpm test; pnpm build",
  "reason": "Run two verification checks in sequence.",
  "expectedEffect": "Runs tests and build without changing project files.",
  "timeoutSec": 120,
  "outputLimit": 32768
}
```

## Approval Surface

Terminal Script approval must show:

- full script text;
- shell family;
- reason shell syntax is required;
- expected effect;
- timeout and output limit;
- detected risk factors;
- statement that approval is one-shot and not reused.

## Blocking Rules

The action must block before approval when it detects:

- known destructive filesystem patterns;
- project-root escape;
- remote download piped into execution;
- credential or environment dump patterns;
- privilege escalation;
- disk formatting or partition editing;
- hidden background process persistence;
- other project-defined high-risk patterns.

## Result

```json
{
  "toolCallId": "call-789",
  "status": "completed",
  "success": false,
  "exitCode": 1,
  "summary": "build failed after tests passed",
  "stdoutSummary": "bounded stdout",
  "stderrSummary": "bounded stderr",
  "truncated": false
}
```

## Non-Goals

- Terminal Script is not the default way to run tests.
- Terminal Script is not a workaround for Preview.
- Terminal Script must not count as verified evidence unless the captured
  output actually satisfies the verification policy.
