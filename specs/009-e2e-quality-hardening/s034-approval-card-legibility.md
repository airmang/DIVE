# S-034 — Beginner approval-card legibility (009 theme 6) — stage spec/plan

**Wily Stage**: S-034 (`STG-5e989802b7b8`, project `dive-2`). Status `draft` →
to be claimed by root. **Scope correction**: the Stage's registered scope glob
`dive/src/components/permission/**` is wrong — the code is
`dive/src/components/permission-card/**` plus Rust
(`dive/src-tauri/src/{agent,tools,ipc,dive}`). Root will correct the Wily scope
on claim.

**Spec**: [`spec.md`](spec.md) theme 6 — "Beginner approval-card legibility:
no plain-language change summary, no read gate, weak secret/scope warnings
(automation-bias risk)."

**Acceptance** (from the Stage):
1. Write/edit permission cards show a **content-aware plain-language summary**
   (e.g. "adds an opening-hours table with 7 rows") above the raw diff.
2. **Secret/scope warnings** surface on risky changes and a **read affordance**
   discourages blind approval.

## Context & why

For non-technical owners the write/edit approval card assumes diff-literacy: the
only explanation is a static per-tool i18n string (`write_file` →
"writes content to a file"), never "adds your opening-hours table". `WarnCard`
*already exposes* an `approvalRequirement` read-gate prop **but no caller ever
passes it**, so Approve is a single frictionless click — the rubber-stamp
condition DIVE exists to prevent. There is no secret/.env detection on the
file-write path (only shell commands are scanned), and a whole-file `write_file`
overwrite of an existing page shows a large noisy diff with no "entire file
replaced / N lines removed" highlight.

### Gaps closed (from `docs/qa/e2e-gap-backlog.md`, theme-6 cluster — 6 gaps)

| Gap | Sev | Summary |
| --- | --- | --- |
| INTERACTIVE-01 | **P0** | write/edit card has NO gate forcing the user to open/scroll the diff before Approve. |
| STATIC-03 | P1 | plain-language summary above the diff is generic (static per-tool string), not content-aware. |
| APPS-05 | P1 | no secret-aware detection in the file write/edit approval path (.env / API-key writes look like a generic warn diff). |
| DATA-03 | P2 | no plain-language "what this change does / why" layer; new-dependency adds get no explained consent. |
| (theme-6 #4) | P1 | whole-file `write_file` overwrite of an existing file has no "replaces entire file (N lines removed)" warning. |
| (approval-path i18n) | — | hardcoded Korean default deny reason `"사용자가 거부함"` at `ipc/chat.rs:1043`. |

### Confirmed touch points (from source inventory)

- **Cards**: `dive/src/components/permission-card/{PermissionCard,SafeCard,WarnCard,DangerCard,PermissionSummary,CommandExplainer,PatchPreviewPanel,DiffViewer,RawDetails,ArgsEditor}.tsx`, `types.ts`, `explain.ts`, `diff.ts`.
- **Read-gate prop already present**: `PermissionCardProps.approvalRequirement {required, satisfied, message}` — currently never passed by `ToolActivity.tsx` (the caller).
- **DangerCard** already has a mandatory `diffAcknowledged` checkbox pattern to mirror for the read gate.
- **Integration / caller**: `dive/src/components/chat/ToolActivity.tsx` (builds `PermissionCardData`, owns approve/deny handlers).
- **Backend approval pipeline**: `dive/src-tauri/src/agent/permission.rs` (`PermissionRequestContext`, `PendingApprovalSnapshot`), `agent/mod.rs` (`build_diff_preview`, `tool_call_start` event), `ipc/chat.rs` (`tool_approve`/`tool_deny`; Korean default reason at :1043), `tools/guard.rs` (existing terminal-script risk detection to mirror for secret heuristic), `dive/approval.rs`, `dive/event_log.rs` (outcome mapping), `export/mod.rs` (redaction/export).
- **i18n**: `dive/src/i18n/{en,ko}.json` namespace `permission_card.*` (all UI copy already routed through `t()`; add new keys).

## Design decisions (flagged for approval)

1. **Plain-language summary source — DETERMINISTIC, patch-derived (default).**
   Derive the summary from the diff/args in the frontend (lines added/removed,
   file kind, structural hints: "adds a `<table>` (7 rows)", "adds a `:hover`
   rule", "replaces the entire file — 42 lines removed"). Render above the diff.
   Add an **optional on-demand "Explain this change"** affordance that may call
   the LLM for a richer sentence — *off the approval hot path*, never blocking,
   degrades cleanly when the sidecar is unavailable (matches DIVE's
   no-static-fallback-masquerading-as-real ethos).
   - *Alternative (not chosen by default):* AI-author the summary on every card.
     Richer prose but adds latency + cost to every approval and is offline-fragile.
2. **Read gate — "scroll the diff OR confirm 'I read the change'" (default).**
   Wire `approvalRequirement` for `write`/`edit` cards: Approve disabled until
   the diff is expanded/scrolled (track `diffViewed` per `toolCallId`, mirroring
   the verify-stage `diffViewedStepIds` pattern) **or** an "I read the change"
   checkbox is ticked. `read_file` (Safe) stays auto-approved. Least-friction
   while still defeating the one-click rubber stamp.
3. **Secret detection → escalate risk tier to `danger` (default).** A Rust
   heuristic on the write/edit path flags likely secrets (.env target path,
   API-key/token regex, long high-entropy literal). On a hit: escalate
   `warn → danger` (which forces the existing diff-ack gate) **and** render a
   distinct callout ("this writes a secret into source — prefer a gitignored
   config/.env"). Escalation > callout-only because the danger tier already
   carries the mandatory acknowledgment.
4. **Leftover Korean deny reason** (`ipc/chat.rs:1043`) is fixed here since
   S-034 already edits that exact path. (Could defer to i18n; recommend include.)

## Non-goals / boundary (do NOT pull in — owned by other Stages)

- Behavior-preserving refactor banner (REFACTOR-02) and multi-replace/rename
  tool (REFACTOR-03) → **S-039** (theme 11).
- Verification-stepper false-completion (STATIC-04 / CROSS-verify) → **S-036**.
- Interview friction / criterion scaffolding (STATIC-01, STYLED-03) → **S-035**.
- Static-vs-server preview onboarding coachmark → **S-038**.
- Supervisor.rs Korean question / D-stage Korean prompt → **S-030 (done) / S-036**.

## Regression guards (preserve; add/keep tests)

- `read_file` and other Safe-tier tools stay **auto-approved** (no new friction).
- The existing `DangerCard` diff-ack gate and `ArgsEditor` JSON-validation gate
  keep working unchanged.
- Approval card UI stays i18n-clean in both `ko` and `en` (no new hardcoded copy).

## Phase plan (= Wily phases; each maps to a harness phase)

| Phase | Scope | Gaps |
| --- | --- | --- |
| **P1 Foundation** | shared types (`diffViewed` map, summary model, secret-flag result) + en/ko i18n keys for read-gate, summary, secret callout, overwrite warning, dependency consent. | seams |
| **P2 Read gate** | wire `approvalRequirement` for write/edit (`diffViewed`-or-checkbox); `ToolActivity` passes it; keep read_file auto-approved. Component tests. | INTERACTIVE-01 (P0) |
| **P3 Plain-language summary** | deterministic patch-derived summary above the diff in `PermissionSummary`/`PatchPreviewPanel`; optional "Explain this change" affordance. Tests. | STATIC-03, DATA-03 |
| **P4 Secret/scope warnings** | Rust secret heuristic + whole-file-overwrite detection on write/edit path; risk-tier escalation; distinct callout; fix Korean deny reason. Rust + FE tests. | APPS-05, theme-6 #4, i18n |
| **P5 Integration / EventLog / consent** | new-dependency explained consent; EventLog outcomes (read-gate-satisfied, secret-flagged) + export coverage; full local CI gates. Tests. | DATA-03, evidence trail |

## Validation loop (per 009)

spec/plan → implement → **local CI gates** (rust `cargo fmt --check` + `clippy
--all-targets --features dev-mock -D warnings` + full `cargo test`; frontend
`format:check` + `typecheck` + `lint` + unit) → rebuild release `.app` →
**live re-run** the theme-6 journeys (write/edit approval with content summary,
read-gate, secret-write deny, whole-file overwrite) in **ko and en** → verify.

## Codex handoff (supervised) — who does what

- **Root (Claude, this session)**: claims S-034 in Wily (lifecycle owner),
  corrects the Stage scope, authors this doc + `tasks.md`, runs `harness
  init`/`plan`/`run --adapter codex` to emit the per-phase work order, hands the
  work order to Codex (`codex-companion task --write`), then **verifies** (CI
  gates), runs **live ko/en QA**, and **completes** the Wily Stage + merge-prep.
- **Codex**: implements each phase **within the work-order boundary only** —
  does not widen scope, cross the phase boundary, or self-complete Wily state.
