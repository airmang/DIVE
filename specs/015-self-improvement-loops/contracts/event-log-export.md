# Contract: EventLog And Export — Signal Instrumentation (S-076) And Replay Corpus (S-078)

**Purpose**: Record which prompt and policy produced each supervision event,
what the student saw, how each card exposure ended, and where a session came
from, so field data can be aggregated per version (FR-001–FR-006). Everything
here is additive; existing field names are unchanged.

## Versions (FR-001, FR-002)

| Field | Where | Value |
| --- | --- | --- |
| `promptVersion` | `provocation.supervisor_evaluated`, `verification_coach.evaluated`, `prd_interview.turn_evaluated` | `<semver>+<8-hex>`; semver is a const next to each prompt builder, hex is SHA-256 of the rendered template with placeholders for per-request data (`dive/src-tauri/src/dive/prompt_version.rs`). **`null` when no prompt reached a model on that attempt**: supervisor provoke gate false, runtime/provider unavailable, oversized context, or the deterministic fallback card (Stage-C / DiffReady shell); coach runtime unavailable before the call. A timed-out or failed turn did send the prompt and carries the version. `verification_coach.requested` carries none (it precedes the call). |
| `policyVersion` | `provocation.supervisor_evaluated` | `policyVersion` of `dive/src/features/provocation/supervision-policy.json` as sent by the frontend with each evaluation request (validated: `MAJOR.MINOR.PATCH` with optional `-`/`+` suffix, ≤32 chars; an invalid value is ignored). The Rust value is logged when the request omits it or sends an invalid one. |
| `policyVersionRust` | `provocation.supervisor_evaluated` | Present only when the frontend and Rust policy versions differ (a stale bundle); `policyVersion` is then the frontend value. |

A pin test per surface fails when a template changes without a semver bump
(`supervisor_prompt_version_is_pinned`, `verification_coach_prompt_version_is_pinned`,
`prd_interview_prompt_version_is_pinned`). Each keeps a released
`(semver, hash)` history; append a new entry, never rewrite one. The PRD
interview hash also covers the confirm-gate table (every gap label and focus
line, plus the `none` / `ready_to_save` lines) because that text is sent to
the model; it is at `1.1.0` for that reason. The supervisor pin test
enumerates every `SupervisorEvent` variant through serde, so a new event
cannot be left out of the hash.

`supervision-policy.json` is the single source of trigger thresholds (retry-loop
minimum failures, broad-step expected-file count, scope debounce, evidence
compaction limits). TypeScript imports it; Rust embeds the same file with
`include_str!` and rejects unknown keys. Output-contract limits (question 140
chars, evidence/action caps, 24 KB prompt cap) stay constants.

## `provocation.supervisor_evaluated` additions

```jsonc
{
  "promptVersion": "1.0.0+256c9520",   // null when no prompt was sent
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
and comes back starts a new exposure, and so does a card whose question text
changes under the same id, so `card_shown.question` is always what was seen.
Remounts under React StrictMode do not create a new exposure. An exposure pins
the project, session, and mode it was shown under: its close event and its
responses are logged in that session even if the host has meanwhile moved on
(e.g. the step detail switching from step A to step B in one render).

| Field | Events | Meaning |
| --- | --- | --- |
| `exposureId` | all card events from the host | Joins `card_shown` to its responses/terminal event. |
| `question` | `card_shown` | The question text shown (`card.prompt`); `null` if the card has none. |
| `responseLatencyMs` | response events | ms from `card_shown` to this response. |
| `visibleMs` | `card_unanswered` | ms the card was visible. |
| `unansweredReason` | `card_unanswered` | `replaced` (another card, or the same card id now asking a different question, took its place), `removed` (the card left and nothing replaced it), `unmounted` (the host left the screen), `page_hidden` (`pagehide`; best effort on app close). |

`unansweredReason` is deliberately not `reason`: the export anonymizer hashes
`reason` keys as student text.

## Session attribution (FR-005)

`provocation_log_event` stores a card event under the request's `sessionId`.
Every host passes `projectId`, and the active `sessionId` of that project when
it has one. When `sessionId` is `null`, the row is attributed to, in order:

1. `exposure` — the session of the same `exposureId`'s `card_shown` row, so an
   exposure never splits across sessions (e.g. a step start creating a new
   session between `card_shown` and its terminal event);
2. `project_latest` — the latest **non-archived** session of the payload's
   `projectId` (or `supervisorCorrelation.projectId`).

The fallback used is recorded in the payload as `sessionResolvedBy`
(`exposure` | `project_latest`); rows stored with the client's session id carry
no such field.

**Known limitation**: with no session at all (e.g. PRD intent-check cards
shown before the project's first session exists, or with only archived
sessions), the row stays `session_id = NULL` and is in no session export.

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
  "evaluationId": "7f0c…",
  "validationOutcome": "none",
  "parseFailureKind": null,
  "contractRetryAttempted": false,
  "errorClass": null,
  "patchProposed": false,
  "appliedFieldCount": 0,
  "rejectedReasonCount": 0,
  "architectureProposalCount": 0,
  "provider": "openrouter",
  "model": "anthropic/claude-sonnet-5",
  "promptVersion": "1.1.0+2cd96df7"
}
```

A failed model call is logged too, before the error is returned:
`validationOutcome: "model_error"` with `errorClass` `request_failed` |
`stream_error` | `finished_with_error`. The provider's error text is never
logged.

## Session origin (FR-006)

`Session.origin` (`classroom` | `qa` | `dev`, migration v20) is set at creation,
first valid source wins:

1. env `DIVE_SESSION_ORIGIN`;
2. the override file `<app_data_dir>/session-origin` (next to `dive.db`), whose
   trimmed content is `classroom`, `qa`, or `dev`. A release `.app` launched
   through LaunchServices receives no env vars, so the live-QA harness writes
   `qa` here; it is read on every session creation;
3. development builds (debug or `dev-mock`) → `dev`;
4. otherwise `classroom`.

An invalid env or file value is ignored with a warning. New rows default to
`classroom`; rows that already exist when v20 runs are backfilled `dev`,
because no classroom pilot has run on a pre-v20 build. Exported as
`session_meta.origin`.

## Export policy (D-015-03)

- `question` (card events and `decisionSummary`) is exported in plain text. The
  sanitizer and anonymizer do not hash it by key name; the secret/email/account
  redaction and PII detectors still apply to its value.
- All new numeric fields and enums are exported as-is.

## Local replay corpus (S-078, FR-020/FR-021)

`SupervisionReplay` (migration v21) holds one row per model call of a
supervision surface, captured **only when a prompt reached a model** (the
evaluation event's `promptVersion` is non-null), so the call can be re-run
offline:

| Column | Meaning |
| --- | --- |
| `evaluation_id` (unique) | Joins the row to its event: `supervisorEvaluationId` of `provocation.supervisor_evaluated` (one row per attempt, retries included), `eventId` of `verification_coach.evaluated`, `evaluationId` of `prd_interview.turn_evaluated`. |
| `surface` | `supervisor` \| `coach` \| `prd_interview`. |
| `session_id`, `project_id` | Nullable; rows are deleted with their session/project. |
| `prompt_version`, `policy_version`, `model` | As logged on the event (`policy_version` is supervisor-only). |
| `context_json` | The prompt inputs: the exact `SupervisorContext` (supervisor); the full generate request (coach); the rendered user-prompt inputs `{draftJson, missingConfirmable, nextFocus, conversation, answer, jsonContractRetry}` of the call that decided the turn (PRD, the in-turn retry when there was one). With `prompt_version` these rebuild the exact prompt. |
| `raw_output`, `raw_truncated` | The raw model reply, cut at 16 KB on a character boundary (`raw_truncated` = 1 when cut); `NULL` for a sent call that returned nothing (timeout, sidecar or provider error). |
| `validation_json` | The validation result (outcome, drop/reason code, decision summary or PRD outcome). |

- **Capture switch** (D-015-02): backend preference `replayCapture` in the
  `AppPreference` table, default ON. Settings → Advanced → "Saved AI review
  records" shows the row count, toggles capture (`replay_settings_get` /
  `replay_settings_set`), and deletes all rows (`replay_records_clear`). An
  unreadable preference counts as OFF.
- **Retention** on every insert: rows older than 30 days are deleted, then all
  but the newest 500.
- **Best effort**: a capture failure is logged as a warning and never fails or
  changes the user's turn (the PRD row is written after the turn's
  transaction commits).
- **Export**: never in the default export. `ExportOptions.include_replay`
  (IPC `export_session` `options`; there is no export-options UI, so this is
  IPC-only) appends one `kind: "replay"` record per row of the session, after
  the events:

```json
{
  "kind": "replay",
  "id": "id:replay:…",
  "evaluation_id": "…",
  "surface": "prd_interview",
  "created_at": 1759112345000,
  "prompt_version": "1.1.0+2cd96df7",
  "policy_version": null,
  "model": "…",
  "context": { "answer": "h:…", "nextFocus": "capture_intent_summary", "…": "…" },
  "raw_output": "…",
  "raw_truncated": false,
  "validation": { "validationOutcome": "none" }
}
```

  `context` and `validation` pass through the provocation sanitizer (raw-body
  keys summarized, secrets/emails/account ids redacted) and the anonymizer
  (paths and PII hashed per `hash_file_paths` / `hash_user_text`). With
  `hash_user_text` on, the known student-text fields of the prompt inputs are
  hashed too (`answer`, `conversation`, `draftJson`, `goalSummary`,
  `activeStep`, `label`, `title`, `summary`, `instruction`, `text`,
  `verificationCommand`, `verificationManualCheck`, `valueSummary`,
  `rejectedReasons`). `raw_output` is AI output and stays text (D-015-03),
  with secrets redacted and PII-shaped output hashed — except for the
  `prd_interview` surface, whose replies restate the student's goal, answers,
  and criteria nearly verbatim, so with `hash_user_text` on its `raw_output`
  is hashed as user text.
