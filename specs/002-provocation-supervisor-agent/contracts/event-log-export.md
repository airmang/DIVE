# Contract: EventLog And Export

**Purpose**: Define local research ledger records for supervisor evaluation.

## Event Types

P1 adds or standardizes these event types:

- `provocation.supervisor_evaluated`: written for every evaluation attempt,
  including shown, none/no-card, dropped, and error outcomes.
- Existing card exposure/action events remain in the current `provocation.*`
  family and are correlated by `cardId` / `supervisorEvaluationId`.
- DecisionGate proceed outcomes record `continue_with_risk` and
  `verification_deferred` distinctly; neither is an LLM-suggested action.

## `provocation.supervisor_evaluated` Payload

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
  "evidenceHash": "sha256:...",
  "mode": "work",
  "sourceUiMode": "standard",
  "evidenceRefs": [
    {
      "id": "agent.assistant_claim",
      "source": "agent",
      "kind": "assistant_claim",
      "label": "AI 완료 주장",
      "verificationEvidence": false
    }
  ],
  "supervisorModel": "openai-codex/gpt-5.4-mini",
  "latencyMs": 812,
  "usage": null,
  "decisionSummary": {
    "provoke": true,
    "concern": "ai_self_report_only",
    "severity": "caution",
    "evidenceRefIds": ["agent.assistant_claim"],
    "suggestedActionIds": ["open_diff"],
    "strippedActionIds": []
  },
  "validationOutcome": "shown",
  "dropReason": null,
  "cardId": "provocation:step-3:ai_self_report_only:sha256...",
  "userResponse": null
}
```

## Required Invariants

- `mode` is canonical `work | guided`; never `standard` or `expert`.
- `sourceUiMode` is optional migration metadata only.
- `evidenceRefs` separate AI self-report from concrete verification evidence.
- `decisionSummary` is sanitized and bounded.
- `dropReason` is present when `validationOutcome` is `none`, `dropped`, or
  `error`.
- `cardId` is present only when a card is shown.
- Card exposure/action/dismiss/mark-irrelevant logs attach `cardId` and, when
  available, `supervisorEvaluationId`.

## Sanitization Requirements

Export must not contain:

- Raw code
- Raw diffs
- Raw terminal output
- Full transcripts
- OAuth tokens
- API keys
- Authorization headers
- Full environment dumps
- Unmasked student names, emails, account identifiers, or similar PII

Long or code-like evidence values must be summarized using the existing export
sanitizer pattern.
