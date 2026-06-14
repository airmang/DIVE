# Contract: Pi SupervisorAgent

**Purpose**: Define the bounded LLM boundary for P1 review-card question
generation.

## Invocation Rules

- DIVE invokes SupervisorAgent only after the deterministic P1 gate fires:
  `event=verify_entered`, `aiSelfReport=true`, and `concreteEvidence=false`.
- SupervisorAgent receives one `SupervisorContext` JSON object plus a fixed
  system instruction to return only JSON.
- The sidecar run message must include explicit `tools: []`.
- DIVE must assert the sidecar `ready.enabled_tools` value is `[]`.
- SupervisorAgent has no filesystem, process, resource discovery, built-in Pi
  tools, long-term memory, or shared main-agent session.

## Input

The input payload is `SupervisorContext` as defined in
[data-model.md](../data-model.md). Required P1 fields:

```json
{
  "schemaVersion": 1,
  "event": "verify_entered",
  "artifactRef": {
    "kind": "step",
    "id": "step-3",
    "label": "Add todo item form"
  },
  "contextHash": "sha256:...",
  "mode": "work",
  "locale": "ko-KR",
  "allowedActionIds": ["open_diff"],
  "goalSummary": "bounded sanitized text",
  "planSummary": {
    "stepCount": 4,
    "activeStep": "bounded sanitized text"
  },
  "verificationState": {
    "aiSelfReport": true,
    "concreteEvidence": false,
    "testResult": "skipped"
  },
  "feasibility": {
    "runnable": false,
    "previewable": false,
    "hasTests": false,
    "diffAvailable": true
  },
  "evidenceRefs": [
    {
      "id": "agent.assistant_claim",
      "source": "agent",
      "kind": "assistant_claim",
      "label": "AI 완료 주장",
      "valueSummary": { "kind": "enum", "value": "claimed_done" },
      "verificationEvidence": false
    }
  ]
}
```

Input exclusions:

- Raw code
- Raw diffs
- Raw terminal output
- Full transcripts
- Secrets, OAuth tokens, API keys
- Full environment dumps
- Unmasked student PII

## Output

SupervisorAgent must return exactly one JSON object:

```json
{
  "schemaVersion": 1,
  "provoke": true,
  "concern": "ai_self_report_only",
  "severity": "caution",
  "question": "AI는 완료됐다고 했지만, 변경된 파일을 확인해 실제 목표와 맞는지 볼 수 있나요?",
  "evidenceRefIds": ["agent.assistant_claim"],
  "suggestedActionIds": ["open_diff"],
  "supervisionHabit": "AI의 말과 직접 본 증거를 구분합니다.",
  "logRationale": "완료 주장은 있으나 독립 검증 증거가 없음"
}
```

## Validation Contract

DIVE accepts output only after all deterministic checks pass:

- `schemaVersion == 1`
- `provoke == true`
- `concern == "ai_self_report_only"`
- `question` is a question, criterion-linked, and within the P1 length cap.
- `evidenceRefIds` is non-empty and every id exists in input `evidenceRefs`.
- `suggestedActionIds` is stripped to the input `allowedActionIds` subset.
- `suggestedActionIds` may contain only verification nudges:
  `open_diff`, `open_preview`, `run_tests`, or `run_app`.
- Proceed/approve outcomes such as `continue_with_risk` and
  `verification_deferred` are DecisionGate-owned and rejected as LLM-suggested
  actions.
- Rendered severity is fixed to `caution`; agent severity is logged only.
- `logRationale` is sanitized and not copied verbatim to student-facing UI.

Drop/error behavior:

- Malformed JSON -> `parse_error`
- Unsupported schema -> `schema_version_unsupported`
- `provoke=false` -> `provoke_false`
- Unknown evidence -> `unknown_evidence_ref`
- Empty evidence -> `missing_evidence`
- Statement instead of question -> `not_question`
- Over-cap focal question -> `content_too_long`
- Runtime unavailable/timeout/sidecar error -> corresponding no-card log

No static fallback card is allowed for any failure.
