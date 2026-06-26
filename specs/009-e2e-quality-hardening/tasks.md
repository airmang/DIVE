# Tasks: Beginner Approval-Card Legibility (009 theme 6 / S-034)

**Input**: `spec.md` theme 6 + `s034-approval-card-legibility.md` + source inventory.

**Stage**: `STG-5e989802b7b8` - Beginner approval-card legibility (009 theme 6)

- `P1-foundation`: T001-T005
- `P2-read-gate`: T006-T009
- `P3-summary`: T010-T012
- `P4-secret-scope`: T013-T017
- `P5-integration`: T018-T022

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallel-safe (different files, no incomplete dependency).
- **[Story]**: US1 read gate · US2 plain-language summary · US3 secret/scope warnings · US4 consent + evidence trail.
- Every task names an exact repository path.

---

## Phase 1: Foundation (shared types + i18n)

**Purpose**: Types and localized strings every later slice depends on.

- [ ] T001 [US1] Add read-gate (`diffViewed` per-toolCallId map, `approvalRequirement` wiring) and plain-language summary types in `dive/src/components/permission-card/types.ts`
- [ ] T002 [P] [US3] Add Rust secret-flag and whole-file-overwrite result fields to the approval context in `dive/src-tauri/src/agent/permission.rs`
- [ ] T003 [P] [US1] Add English i18n keys for read-gate, change summary, secret callout, overwrite warning, and dependency consent in `dive/src/i18n/en.json`
- [ ] T004 [P] [US1] Add the Korean equivalents of those keys in `dive/src/i18n/ko.json`
- [ ] T005 [P] [US2] Add a deterministic patch-derived summary deriver module in `dive/src/components/permission-card/summarize.ts`

---

## Phase 2: Read gate (INTERACTIVE-01, P0)

**Purpose**: Defeat the one-click rubber stamp on write/edit cards.

- [ ] T006 [US1] Track `diffViewed` per toolCallId on diff expand/scroll in `dive/src/components/permission-card/DiffViewer.tsx` (depends on T001)
- [ ] T007 [US1] Compute and pass `approvalRequirement` for write/edit (satisfied when diff viewed or "I read the change" confirmed), keep read_file auto-approved, in `dive/src/components/chat/ToolActivity.tsx` (depends on T006)
- [ ] T008 [US1] Disable Approve until the requirement is satisfied and add the "I read the change" affordance in `dive/src/components/permission-card/WarnCard.tsx` (depends on T007)
- [ ] T009 [P] [US1] Component test for read-gate enable/disable behavior in `dive/src/components/permission-card/WarnCard.test.tsx` (depends on T008)

---

## Phase 3: Plain-language change summary (STATIC-03, DATA-03)

**Purpose**: A content-aware sentence above the raw diff for non-coders.

- [ ] T010 [US2] Render the patch-derived summary above the diff in `dive/src/components/permission-card/PermissionSummary.tsx` (depends on T005)
- [ ] T011 [US2] Add the optional non-blocking "Explain this change" affordance in `dive/src/components/permission-card/PatchPreviewPanel.tsx` (depends on T010)
- [ ] T012 [P] [US2] Unit-test the deterministic summary deriver in `dive/src/components/permission-card/summarize.test.ts` (depends on T005)

---

## Phase 4: Secret / scope warnings (APPS-05 + whole-file overwrite)

**Purpose**: Make unsafe writes legible and harder to blind-approve.

- [ ] T013 [US3] Add a secret heuristic (.env target, API-key/token regex, high-entropy literal) on the write/edit approval path in `dive/src-tauri/src/tools/guard.rs` (depends on T002)
- [ ] T014 [US3] Detect whole-file `write_file` overwrite (N lines removed) and escalate the risk tier on a secret/overwrite hit in `dive/src-tauri/src/agent/mod.rs` (depends on T013)
- [ ] T015 [US3] Render the secret/overwrite callout in `dive/src/components/permission-card/DiffViewer.tsx` (depends on T006)
- [ ] T016 [P] [US3] Localize the hardcoded Korean default deny reason in `dive/src-tauri/src/ipc/chat.rs`
- [ ] T017 [P] [US3] Rust test for the secret heuristic and risk escalation in `dive/src-tauri/tests/tool_guard.rs` (depends on T013)

---

## Phase 5: Integration / EventLog / dependency consent

**Purpose**: Close the evidence trail and the new-dependency consent gap.

- [ ] T018 [US4] Add an explained consent step for new-dependency adds in `dive/src/components/permission-card/CommandExplainer.tsx`
- [ ] T019 [US4] Add EventLog outcomes for read-gate-satisfied and secret-flagged in `dive/src-tauri/src/dive/event_log.rs` (depends on T013)
- [ ] T020 [P] [US4] Extend export redaction/coverage for the new approval events in `dive/src-tauri/src/export/mod.rs` (depends on T019)
- [ ] T021 [P] [US4] Export fixture test for the new events in `dive/src-tauri/tests/export_jsonl.rs` (depends on T020)
- [ ] T022 [US4] Run the full local CI gates (rust fmt + clippy --all-targets --features dev-mock -D warnings + cargo test; frontend format:check + typecheck + lint + unit) and capture the verification receipt (depends on T021)
