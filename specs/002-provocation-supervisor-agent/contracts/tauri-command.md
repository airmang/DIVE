# Contract: Tauri IPC For Supervisor Evaluation

**Purpose**: Define the app boundary used by the verification/final approval UI
to request P1 supervisor evaluation.

## Command

`provocation_agent_evaluate`

The command name is proposed for implementation. It should be registered in
`dive/src-tauri/src/ipc` and exposed through Tauri's invoke handler.

## Request

```json
{
  "sessionId": 123,
  "event": "verify_entered",
  "artifactRef": {
    "kind": "step",
    "id": "step-3",
    "label": "Add todo item form"
  },
  "sourceUiMode": "standard",
  "locale": "ko-KR",
  "uiState": {
    "goalSummary": "bounded sanitized text",
    "planSummary": {
      "stepCount": 4,
      "activeStep": "bounded sanitized text"
    },
    "verification": {
      "aiClaimedDone": true,
      "diffReviewed": false,
      "appLaunched": false,
      "previewChecked": false,
      "automatedTestsPassed": false,
      "testResult": "skipped",
      "manualChecks": []
    },
    "feasibility": {
      "runnable": false,
      "previewable": false,
      "hasTests": false,
      "diffAvailable": true
    }
  }
}
```

Rules:

- Frontend may pass UI observations and feasibility signals, but Rust builds
  the canonical `SupervisorContext`.
- `sourceUiMode` is normalized before context construction.
- Rust must ignore or sanitize any raw prompt/transcript/code-like fields.
- P1 request event must be `verify_entered`; `ai_claimed_done` is recorded by
  backend/session state and does not render a card.

## Response

Shown card:

```json
{
  "status": "shown",
  "evaluationId": "uuid-or-log-id",
  "card": {
    "id": "provocation:step-3:ai_self_report_only:sha256...",
    "type": "ai_self_report_only",
    "stage": "verify",
    "severity": "caution",
    "prompt": "AI는 완료됐다고 했지만, 변경된 파일을 확인해 실제 목표와 맞는지 볼 수 있나요?",
    "message": "확인 가능한 증거를 먼저 살펴보세요.",
    "evidence": [
      { "label": "AI 완료 주장", "source": "agent" }
    ],
    "actions": [
      { "id": "open_diff", "kind": "open_diff", "label": "변경 보기" }
    ],
    "primaryActionId": "open_diff",
    "createdAt": "2026-06-14T00:00:00.000Z",
    "metadata": {
      "contextHash": "sha256:...",
      "evidenceHash": "sha256:...",
      "supervisorEvaluationId": "uuid-or-log-id"
    }
  }
}
```

No card:

```json
{
  "status": "none",
  "evaluationId": "uuid-or-log-id",
  "dropReason": "provoke_false"
}
```

Error/drop:

```json
{
  "status": "dropped",
  "evaluationId": "uuid-or-log-id",
  "dropReason": "timeout"
}
```

Response rules:

- `status=shown` is the only response with `card`.
- `status=none` covers deterministic no-card outcomes such as the provoke gate
  not firing.
- `status=dropped` covers validation/runtime/drop outcomes.
- Frontend must not synthesize fallback cards for `none` or `dropped`.
- Frontend may continue verification/final approval when the response is late,
  absent, `none`, or `dropped`.
- Proceed/approve outcomes are not returned as supervisor actions.
  `continue_with_risk` and `verification_deferred` are DecisionGate outcomes
  and must be logged separately from supervisor `suggestedActionIds`.
