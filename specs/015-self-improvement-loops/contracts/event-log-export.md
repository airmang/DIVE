# Contract: EventLog And Export — Signal Instrumentation (S-076)

**Purpose**: Record which prompt and policy produced each supervision event,
what the student saw, how each card exposure ended, and where a session came
from, so field data can be aggregated per version (FR-001–FR-006). Everything
here is additive; existing field names are unchanged.

## Versions (FR-001, FR-002)

| Field | Where | Value |
| --- | --- | --- |
| `promptVersion` | `provocation.supervisor_evaluated`, `verification_coach.requested`, `verification_coach.evaluated`, `prd_interview.turn_evaluated` | `<semver>+<8-hex>`; semver is a const next to each prompt builder, hex is SHA-256 of the rendered template with placeholders for per-request data (`dive/src-tauri/src/dive/prompt_version.rs`). |
| `policyVersion` | `provocation.supervisor_evaluated` | `policyVersion` of `dive/src/features/provocation/supervision-policy.json`, sent by the frontend with each evaluation request; the Rust value is logged when the request omits it. |

A pin test per surface fails when a template changes without a semver bump
(`supervisor_prompt_version_is_pinned`, `verification_coach_prompt_version_is_pinned`,
`prd_interview_prompt_version_is_pinned`). Each keeps a released
`(semver, hash)` history; append a new entry, never rewrite one.

`supervision-policy.json` is the single source of trigger thresholds (retry-loop
minimum failures, broad-step expected-file count, scope debounce, evidence
compaction limits). TypeScript imports it; Rust embeds the same file with
`include_str!` and rejects unknown keys. Output-contract limits (question 140
chars, evidence/action caps, 24 KB prompt cap) stay constants.

## `provocation.supervisor_evaluated` additions

```json
{
  "promptVersion": "1.0.0+256c9520",
  "policyVersion": "1.0.0",
  "decisionSummary": {
    "question": "변경 내용이나 실행 결과로 목표와 맞는지 볼 수 있나요?"
  }
}
```

`decisionSummary.question` is present only when `validationOutcome` is `shown`.
One row is still written per attempt (retries included).

## Card exposure events (FR-003, FR-004)

An **exposure** is one contiguous period in which a card is the visible
primary card of one `ProvocationCardHost`. Every exposure writes
`provocation.card_shown` once and then exactly one terminal event: its first
response (`action_clicked`, `dismissed`, `marked_irrelevant`,
`continued_with_risk`) or `provocation.card_unanswered`. Later responses on the
same exposure are still logged but are not terminal. A card that leaves view
and comes back starts a new exposure. Remounts under React StrictMode do not
create a new exposure.

| Field | Events | Meaning |
| --- | --- | --- |
| `exposureId` | all card events from the host | Joins `card_shown` to its responses/terminal event. |
| `question` | `card_shown` | The question text shown (`card.prompt`); `null` if the card has none. |
| `responseLatencyMs` | response events | ms from `card_shown` to this response. |
| `visibleMs` | `card_unanswered` | ms the card was visible. |
| `unansweredReason` | `card_unanswered` | `superseded` (another card or no card replaced it), `unmounted` (the host left the screen), `page_hidden` (`pagehide`; best effort on app close). |

`unansweredReason` is deliberately not `reason`: the export anonymizer hashes
`reason` keys as student text.

## Session attribution (FR-005)

`provocation_log_event` stores a card event under the request's `sessionId`.
When that is `null` (hosts without a session in scope, such as the PRD board),
the row is attached to the latest session of the payload's `projectId` (or
`supervisorCorrelation.projectId`), matching the plan/PRD event precedent. With
neither, the row stays unscoped. Every host passes `projectId`.

## `prd_interview.turn_evaluated` (new)

One row per PRD interview model turn, including turns that propose no patch
(these previously wrote no EventLog row). Counts and identifiers only; the
student answer and assistant message are never included.

```json
{
  "schemaVersion": 1,
  "projectId": 1,
  "projectSpecId": "prd-1",
  "draftId": "draft-1",
  "turnId": "prd-turn-1759112345000",
  "validationOutcome": "none",
  "parseFailureKind": null,
  "contractRetryAttempted": false,
  "patchProposed": false,
  "appliedFieldCount": 0,
  "rejectedReasonCount": 0,
  "architectureProposalCount": 0,
  "provider": "openrouter",
  "model": "anthropic/claude-sonnet-5",
  "promptVersion": "1.0.0+79eaddb8"
}
```

## Session origin (FR-006)

`Session.origin` (`classroom` | `qa` | `dev`, migration v20) is set at creation:
a valid `DIVE_SESSION_ORIGIN` env value wins, otherwise development builds
(debug or `dev-mock`) record `dev` and release builds `classroom`. An invalid
env value is ignored. Exported as `session_meta.origin`.

## Export policy (D-015-03)

- `question` (card events and `decisionSummary`) is exported in plain text. The
  sanitizer and anonymizer do not hash it by key name; the secret/email/account
  redaction and PII detectors still apply to its value.
- All new numeric fields and enums are exported as-is.
