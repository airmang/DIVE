# Contract: Preview Runtime

## Purpose

Open local project inspection targets in DIVE's Preview surface without
requiring a shell command approval.

## Request

`preview_open`

```json
{
  "sessionId": 42,
  "cardId": 7,
  "kind": "static_file",
  "target": "index.html",
  "source": "ai_tool",
  "locale": "ko-KR"
}
```

Supported `kind` values:

- `static_file`: project-relative `.html` or `.htm` file.
- `local_url`: loopback URL already running locally.
- `dev_server`: start or reuse the project's configured preview server.
- `auto`: choose the safest available local preview target.

## Response

```json
{
  "status": "ready",
  "requestId": "uuid",
  "kind": "static_file",
  "previewUrl": "asset://project/index.html",
  "targetLabel": "index.html",
  "logs": [],
  "message": "Preview opened."
}
```

## Unavailable Response

```json
{
  "status": "unavailable",
  "requestId": "uuid",
  "kind": "static_file",
  "targetLabel": "../index.html",
  "reasonCode": "project_escape",
  "message": "DIVE can preview only local files inside the selected project."
}
```

## Validation Rules

- Static files must resolve inside the selected project.
- Static files must use `.html` or `.htm`.
- Local URLs must use a supported scheme and loopback host.
- Dev-server preview may start or reuse only a project preview command surfaced
  by DIVE, not arbitrary shell text supplied by the model.
- Preview failure must not fall back to Project Command or Terminal Script
  automatically.
- Opening Preview produces an inspection surface only; step approval still
  depends on verification evidence policy.

## UI Contract

- Successful Preview opens the slide-in Preview tab and loads the target.
- Preview errors appear in the Preview surface or adjacent action card, not as
  a generic chat-only failure.
- If Preview was reached by rerouting a blocked command, the blocked command
  card states that no command ran and offers the Preview result or failure.
