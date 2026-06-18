# Tasks: Preview And Terminal Runtime Tools

**Input**: Design documents from `/specs/008-preview-terminal-runtime-tools/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Tests are required by the 008 specification, DIVE v2 constitution, and implementation plan for runtime-boundary, deterministic routing, UI, EventLog, and export behavior.

**Organization**: Tasks are grouped by independently testable user story. The intended Wily decomposition is one Stage for 008 with Phases aligned to the task phases below.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files or does not depend on incomplete work.
- **[Story]**: Maps to the user story in `spec.md`.
- Every task includes an exact repository path.

---

## Phase 1: Setup (Shared Runtime Surface)

**Purpose**: Establish shared labels, types, and module seams used by all 008 slices.

- [X] T001 [P] Add shared runtime-action i18n keys for Preview, Project Command, Terminal Script, reroute, and stale states in `dive/src/i18n/en.json`
- [X] T002 [P] Add Korean shared runtime-action i18n keys for Preview, Project Command, Terminal Script, reroute, and stale states in `dive/src/i18n/ko.json`
- [X] T003 [P] Add frontend runtime action and execution-evidence types in `dive/src/components/chat/types.ts`
- [X] T004 [P] Add slide-in preview/session/output type fields for 008 runtime evidence in `dive/src/components/slide-in/types.ts`
- [X] T005 [P] Declare the shared Rust runtime routing module in `dive/src-tauri/src/tools/mod.rs`
- [X] T006 [P] Add quickstart validation result placeholders for each 008 scenario in `specs/008-preview-terminal-runtime-tools/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Typed models, logging/export seams, and Pi tool guidance that must exist before story-specific behavior lands.

**Critical**: No user story work should merge until this phase is complete.

- [X] T007 Create shared Rust models for `PreviewRequest`, `PreviewSession`, `RuntimeRoutingDecision`, `ExecutionEvidence`, and `StaleApprovalState` in `dive/src-tauri/src/tools/runtime.rs`
- [X] T008 Add runtime action event helpers for `runtime.routing_decision`, `preview.open_requested`, `preview.open_result`, `project_command.result`, `terminal_script.*`, and `tool_approval.stale` in `dive/src-tauri/src/dive/event_log.rs`
- [X] T009 Extend export redaction and runtime-event emission for 008 payloads in `dive/src-tauri/src/export/mod.rs`
- [X] T010 Update Pi-sidecar tool guidance so model-visible tools distinguish Preview, Project Command, and Terminal Script in `dive/src-tauri/src/pi_sidecar.rs`
- [X] T011 Add registry coverage for 008 tool names, schemas, and risk levels in `dive/src-tauri/src/tools/registry.rs`
- [X] T012 Add reducer support for runtime routing, preview, command, terminal script, and stale approval events in `dive/src/hooks/useChatSession.ts`
- [X] T013 Add bounded preview and terminal evidence state handling in `dive/src/stores/slideIn.ts`
- [X] T014 [P] Add baseline export fixtures for 008 runtime events in `dive/src-tauri/tests/export_jsonl.rs`
- [X] T015 [P] Add Pi runtime-boundary regression cases for 008 model-visible tools in `dive/src-tauri/tests/tool_guard.rs`

**Checkpoint**: Foundation is ready; user story implementation can proceed.

---

## Phase 3: User Story 1 - Open Project Preview Without Shell Workarounds (Priority: P1) MVP

**Goal**: A student can open a local static HTML file, loopback URL, or configured project preview through DIVE Preview without approving a shell command.

**Independent Test**: With a selected project containing `index.html`, ask DIVE to show the result and verify the Preview surface opens or shows a preview-specific unavailable state, with no shell command approval.

### Tests for User Story 1

- [X] T016 [P] [US1] Add Rust tests for static HTML, project escape, extension rejection, and missing-project preview validation in `dive/src-tauri/tests/preview_runtime.rs`
- [X] T017 [US1] Add Rust tests for loopback URL, external URL, dev-server reuse, and preview startup failure in `dive/src-tauri/tests/preview_runtime.rs`
- [X] T018 [P] [US1] Add Preview tab UI tests for static target, local URL, unavailable state, and no shell approval copy in `dive/src/components/slide-in/PreviewTab.test.tsx`
- [X] T019 [P] [US1] Add slide-in store tests for opening Preview and appending bounded startup logs in `dive/src/stores/slideIn.test.ts`

### Implementation for User Story 1

- [X] T020 [US1] Implement preview target validation helpers for `static_file`, `local_url`, `dev_server`, and `auto` in `dive/src-tauri/src/ipc/preview.rs`
- [X] T021 [US1] Add the `preview_open` Tauri command and response contract in `dive/src-tauri/src/ipc/preview.rs`
- [X] T022 [US1] Register the `preview_open` command in the Tauri invoke handler in `dive/src-tauri/src/lib.rs`
- [X] T023 [US1] Add project-relative `.html` and `.htm` asset URL handling for Preview in `dive/src-tauri/src/ipc/preview.rs`
- [X] T024 [US1] Add loopback URL scheme and host validation for Preview in `dive/src-tauri/src/ipc/preview.rs`
- [X] T025 [US1] Extend dev-server Preview responses with request id, status, target label, message, and bounded logs in `dive/src-tauri/src/ipc/preview.rs`
- [X] T026 [US1] Log `preview.open_requested` and `preview.open_result` rows from Preview IPC in `dive/src-tauri/src/ipc/preview.rs`
- [X] T027 [US1] Open the slide-in Preview tab from successful `preview_open` results in `dive/src/components/slide-in/PreviewTab.tsx`
- [X] T028 [US1] Render Preview unavailable and failed states with preview-specific messages in `dive/src/components/slide-in/PreviewTab.tsx`
- [X] T029 [US1] Route preview tool/result events into the Preview tab and terminal log in `dive/src/hooks/useChatSession.ts`
- [X] T030 [US1] Add the step-review Preview action affordance without treating preview availability as verification evidence in `dive/src/components/product/StepDetailSlideIn.tsx`
- [X] T031 [US1] Add Korean Preview action, status, and error strings in `dive/src/i18n/ko.json`
- [X] T032 [US1] Add English Preview action, status, and error strings in `dive/src/i18n/en.json`
- [X] T033 [US1] Record US1 validation evidence and remaining risks in `specs/008-preview-terminal-runtime-tools/quickstart.md`

**Checkpoint**: US1 is independently testable and can ship as the first MVP slice.

---

## Phase 4: User Story 2 - Keep Ordinary Verification Commands Simple (Priority: P1)

**Goal**: Direct test/build commands remain one executable plus explicit arguments, with clear approval copy and bounded terminal/export evidence.

**Independent Test**: Ask DIVE to run a standard test command and verify the approval shows one executable, explicit args, timeout, reason, expected effect, and bounded output after execution.

### Tests for User Story 2

- [X] T034 [P] [US2] Add `run_process` schema and validation tests for direct argv commands, timeouts, path args, shell wrappers, and metacharacters in `dive/src-tauri/src/tools/run_process.rs`
- [X] T035 [P] [US2] Add Pi-sidecar tests that direct command completion emits bounded command evidence in `dive/src-tauri/src/pi_sidecar.rs`
- [X] T036 [P] [US2] Add ToolActivity tests for Project Command approval labels, args, timeout, reason, and expected effect in `dive/src/components/chat/ToolActivity.test.tsx`
- [X] T037 [P] [US2] Add TerminalTab tests for bounded stdout, stderr, exit status, and command summaries in `dive/src/components/slide-in/TerminalTab.test.tsx`

### Implementation for User Story 2

- [X] T038 [US2] Extend `run_process` input schema with `reason`, `expected_effect`, and bounded `timeout_sec` metadata in `dive/src-tauri/src/tools/run_process.rs`
- [X] T039 [US2] Harden project-root and path-like argument validation for direct commands in `dive/src-tauri/src/tools/run_process.rs`
- [X] T040 [US2] Emit `project_command.result` evidence from the Pi-sidecar tool result path in `dive/src-tauri/src/pi_sidecar.rs`
- [X] T041 [US2] Append command stdout, stderr, exit status, and summaries to the Terminal slide-in store in `dive/src/hooks/useChatSession.ts`
- [X] T042 [US2] Render Project Command approval copy with executable, args, timeout, reason, expected effect, and active context in `dive/src/components/permission-card/PermissionCard.tsx`
- [X] T043 [US2] Render Project Command result summaries distinctly from Preview and Terminal Script in `dive/src/components/chat/ToolActivity.tsx`
- [X] T044 [US2] Log direct command completion, denial, failure, and block states through EventLog helpers in `dive/src-tauri/src/dive/event_log.rs`
- [X] T045 [US2] Add export assertions for `project_command.result` evidence and redaction in `dive/src-tauri/tests/export_jsonl.rs`
- [X] T046 [US2] Add Project Command approval/result strings in `dive/src/i18n/en.json`
- [X] T047 [US2] Add Korean Project Command approval/result strings in `dive/src/i18n/ko.json`
- [X] T048 [US2] Record US2 validation evidence and remaining risks in `specs/008-preview-terminal-runtime-tools/quickstart.md`

**Checkpoint**: US2 preserves low-friction ordinary verification independently from Preview.

---

## Phase 5: User Story 3 - Reroute Invalid Preview Attempts Clearly (Priority: P2)

**Goal**: Shell commands that only try to open local preview output are blocked or rerouted to Preview, and stale approval cards close visibly.

**Independent Test**: Simulate an AI request to open `index.html` through a platform shell and verify DIVE does not run it, closes the invalid command request, and offers Preview or a preview-specific unavailable explanation.

### Tests for User Story 3

- [X] T049 [P] [US3] Add preview-open command classifier tests for `open`, `start`, `xdg-open`, `cmd /c start`, and `powershell Start-Process` patterns in `dive/src-tauri/src/tools/runtime.rs`
- [X] T050 [P] [US3] Add Rust stale approval tests for cancellation, validation failure, missing pending request, and app reload in `dive/src-tauri/tests/chat_runtime.rs`
- [X] T051 [P] [US3] Add chat reducer tests for rerouted, blocked, stale, and no-command-ran states in `dive/src/hooks/useChatSession.test.ts`
- [X] T052 [P] [US3] Add PermissionCard UI tests for reroute action, stale close, deny-after-stale, and unavailable preview copy in `dive/src/components/permission-card/PermissionCard.test.tsx`

### Implementation for User Story 3

- [X] T053 [US3] Implement deterministic preview-open command classification and safe target extraction in `dive/src-tauri/src/tools/runtime.rs`
- [X] T054 [US3] Return blocked or rerouted Project Command results for preview-open attempts before approval in `dive/src-tauri/src/tools/run_process.rs`
- [X] T055 [US3] Emit `runtime.routing_decision` rows for blocked, rerouted, unavailable, and stale outcomes in `dive/src-tauri/src/pi_sidecar.rs`
- [X] T056 [US3] Detect no-longer-pending approvals during allow and deny IPC calls in `dive/src-tauri/src/ipc/chat.rs`
- [X] T057 [US3] Emit `tool_approval.stale` rows when a visible approval is no longer backed by a pending request in `dive/src-tauri/src/ipc/chat.rs`
- [X] T058 [US3] Resolve stale, blocked, and rerouted tool-call messages in the chat reducer in `dive/src/hooks/useChatSession.ts`
- [X] T059 [US3] Render stale, blocked, rerouted, and no-command-ran states in the tool activity surface in `dive/src/components/chat/ToolActivity.tsx`
- [X] T060 [US3] Add a Preview reroute action and unavailable fallback copy to permission cards in `dive/src/components/permission-card/PermissionCard.tsx`
- [X] T061 [US3] Add English reroute, stale approval, and no-command-ran strings in `dive/src/i18n/en.json`
- [X] T062 [US3] Add Korean reroute, stale approval, and no-command-ran strings in `dive/src/i18n/ko.json`
- [X] T063 [US3] Add export assertions for runtime routing and stale approval records in `dive/src-tauri/tests/export_jsonl.rs`
- [X] T064 [US3] Record US3 validation evidence and remaining risks in `specs/008-preview-terminal-runtime-tools/quickstart.md`

**Checkpoint**: US3 makes the common wrong-tool preview flow understandable and auditable.

---

## Phase 6: User Story 4 - Run Shell-Style Terminal Scripts Only With Strong Guardrails (Priority: P3)

**Goal**: Legitimate shell-style verification uses a distinct high-risk Terminal Script action with full-script display, one-shot approval, blocking, bounded output, and separate logging/export.

**Independent Test**: Request a multi-command verification script and unsafe script fixtures, then verify Terminal Script is visually distinct, one-shot, bounded, separately logged, and blocks destructive patterns before execution.

### Tests for User Story 4

- [X] T065 [P] [US4] Add Terminal Script validation tests for destructive, remote execution, credential exposure, privilege escalation, and project-root escape patterns in `dive/src-tauri/tests/terminal_script.rs`
- [X] T066 [P] [US4] Add registry tests for `run_terminal_script` schema, one-shot risk, and danger classification in `dive/src-tauri/src/tools/registry.rs`
- [X] T067 [P] [US4] Add PermissionCard and DangerCard tests for full script, shell family, risk factors, timeout, output limit, and one-shot copy in `dive/src/components/permission-card/PermissionCard.test.tsx`
- [X] T068 [P] [US4] Add TerminalTab tests for bounded Terminal Script output and truncation markers in `dive/src/components/slide-in/TerminalTab.test.tsx`

### Implementation for User Story 4

- [X] T069 [US4] Create the `run_terminal_script` tool with typed input, validation, bounded timeout, and bounded output in `dive/src-tauri/src/tools/terminal_script.rs`
- [X] T070 [US4] Export the Terminal Script tool module in `dive/src-tauri/src/tools/mod.rs`
- [X] T071 [US4] Register `run_terminal_script` in the built-in tool registry in `dive/src-tauri/src/tools/registry.rs`
- [X] T072 [US4] Add Terminal Script risk classification and unsafe-pattern helpers in `dive/src-tauri/src/tools/guard.rs`
- [X] T073 [US4] Enforce one-shot high-risk Terminal Script approval in the Pi-sidecar approval loop in `dive/src-tauri/src/pi_sidecar.rs`
- [X] T074 [US4] Add Terminal Script approval mode and full-script display to the permission card surface in `dive/src/components/permission-card/PermissionCard.tsx`
- [X] T075 [US4] Add high-risk Terminal Script visual treatment in `dive/src/components/permission-card/DangerCard.tsx`
- [X] T076 [US4] Append bounded Terminal Script stdout, stderr, exit status, and truncation states to Terminal UI in `dive/src/hooks/useChatSession.ts`
- [X] T077 [US4] Log `terminal_script.approval_requested` and `terminal_script.result` records in `dive/src-tauri/src/dive/event_log.rs`
- [X] T078 [US4] Export Terminal Script evidence separately from Project Command output in `dive/src-tauri/src/export/mod.rs`
- [X] T079 [US4] Add English Terminal Script approval, block, result, and truncation strings in `dive/src/i18n/en.json`
- [X] T080 [US4] Add Korean Terminal Script approval, block, result, and truncation strings in `dive/src/i18n/ko.json`
- [X] T081 [US4] Record US4 validation evidence and remaining risks in `specs/008-preview-terminal-runtime-tools/quickstart.md`

**Checkpoint**: US4 is complete only after Terminal Script cannot be confused with ordinary Project Command or Preview.

---

## Phase 7: Polish & Cross-Cutting Validation

**Purpose**: Finish documentation, verification, and handoff without expanding product scope.

- [X] T082 [P] Update active spec status with shipped 008 scope and any deferred Terminal Script notes in `docs/spec-status.md`
- [X] T083 [P] Update the 008 manual smoke checklist with validation evidence in `specs/008-preview-terminal-runtime-tools/quickstart.md`
- [X] T084 [P] Run frontend typecheck and record results in `specs/008-preview-terminal-runtime-tools/quickstart.md`
- [X] T085 [P] Run targeted Vitest suites for Preview, Terminal, ToolActivity, PermissionCard, and chat reducer and record results in `specs/008-preview-terminal-runtime-tools/quickstart.md`
- [X] T086 [P] Run full `pnpm test:unit` and record results in `specs/008-preview-terminal-runtime-tools/quickstart.md`
- [X] T087 [P] Run targeted Rust tests for preview, run_process, terminal_script, EventLog, and export and record results in `specs/008-preview-terminal-runtime-tools/quickstart.md`
- [X] T088 Run full Rust validation required by the 008 quickstart and record results in `specs/008-preview-terminal-runtime-tools/quickstart.md`
- [X] T089 Perform manual smoke for static HTML Preview, local URL Preview, direct command, reroute, stale approval, and Terminal Script guardrails in `specs/008-preview-terminal-runtime-tools/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies.
- **Phase 2 Foundation**: Depends on Phase 1 and blocks all user stories.
- **US1 Preview MVP**: Depends on Phase 2 and should be implemented first.
- **US2 Project Command**: Depends on Phase 2 and may run in parallel with US1 after shared models settle.
- **US3 Reroute/Stale**: Depends on US1 preview contracts and US2 command validation.
- **US4 Terminal Script**: Depends on Phase 2 and US2 guard patterns; can be deferred if MVP scope is Preview plus Project Command.
- **Phase 7 Polish**: Depends on the selected story scope being complete.

### User Story Dependencies

- **US1 (P1)**: Independent after Foundation; first MVP slice.
- **US2 (P1)**: Independent after Foundation; preserves ordinary verification while US1 handles Preview.
- **US3 (P2)**: Requires US1 Preview target handling and US2 command validation so reroute can be truthful.
- **US4 (P3)**: Requires shared runtime models and command guard patterns; should not block US1/US2 MVP.

### Within Each User Story

- Write and run story tests before implementation.
- Implement Rust validation and IPC before frontend result rendering.
- Add EventLog/export coverage in the same story that introduces or changes runtime evidence.
- Keep AI self-report separate from verification evidence.
- Do not add legacy runtime fallback, shell fallback for Project Command, generic warning banners, or quiz/card-deck behavior.

---

## Parallel Opportunities

- T001-T006 can run in parallel during setup.
- T014 and T015 can run in parallel with T007-T013 once event names are agreed.
- US1 tests T016, T018, and T019 can run in parallel; T017 follows T016 because both share `preview_runtime.rs`.
- US2 tests T034-T037 can run in parallel.
- US3 tests T049-T052 can run in parallel.
- US4 tests T065-T068 can run in parallel.
- Phase 7 validation tasks T082-T087 can run in parallel after the selected implementation scope is stable; T088 and T089 should run after targeted checks.

---

## Parallel Example: User Story 1

```text
Task: "Add Preview tab UI tests for static target, local URL, unavailable state, and no shell approval copy in dive/src/components/slide-in/PreviewTab.test.tsx"
Task: "Add slide-in store tests for opening Preview and appending bounded startup logs in dive/src/stores/slideIn.test.ts"
Task: "Add Rust tests for static HTML, project escape, extension rejection, and missing-project preview validation in dive/src-tauri/tests/preview_runtime.rs"
```

---

## Parallel Example: User Story 2

```text
Task: "Add run_process schema and validation tests for direct argv commands, timeouts, path args, shell wrappers, and metacharacters in dive/src-tauri/src/tools/run_process.rs"
Task: "Add ToolActivity tests for Project Command approval labels, args, timeout, reason, and expected effect in dive/src/components/chat/ToolActivity.test.tsx"
Task: "Add TerminalTab tests for bounded stdout, stderr, exit status, and command summaries in dive/src/components/slide-in/TerminalTab.test.tsx"
```

---

## Wily Stage/Phase Mapping

**Stage**: `S-024` / `STG-a294be994b1a` - `008 Preview/Terminal 런타임 도구 경계 구현`

- **P1-foundation - Shared Foundation**: T001-T015
- **P2-preview-mvp - Preview MVP**: T016-T033
- **P3-project-command - Direct Project Command Evidence**: T034-T048
- **P4-reroute-stale - Preview Reroute And Stale Approval**: T049-T064
- **P5-terminal-script - Terminal Script Guardrails**: T065-T081
- **P6-validation-handoff - Validation And Handoff**: T082-T089

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete US1 Preview MVP.
3. Complete US2 direct Project Command evidence.
4. Complete the US3 reroute/stale subset needed to close the original shell-preview approval failure.
5. Stop and validate quickstart scenarios 1-6 before Terminal Script.

### Incremental Delivery

1. Preview static HTML and local URL handling.
2. Dev-server Preview reuse/start.
3. Direct command approval/result polish.
4. Preview-open command reroute and stale approval cleanup.
5. Terminal Script high-risk vertical slice.
6. Full export and smoke validation.

### Deferred Scope

Terminal Script is P3. If implementation risk or schedule pressure appears, US4 may be left as a documented later vertical slice, but Project Command must still reject shell-only syntax and Preview must not fall back to shell commands.
