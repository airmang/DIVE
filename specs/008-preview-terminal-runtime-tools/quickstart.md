# Quickstart: Preview And Terminal Runtime Tools

## Prerequisites

- DIVE desktop app can run with a Pi-capable provider.
- Use a local project selected in DIVE.
- Use one fixture project with a plain `index.html`.
- Use one fixture project with a standard test/build command.
- Keep the verification coach and SupervisorAgent review-card behavior enabled
  as existing product context; this feature does not replace them.

## Validation Scenario 1: Static HTML Preview

1. Open a project containing `index.html`.
2. Ask DIVE to show or preview the result.
3. Confirm DIVE opens the slide-in Preview surface.
4. Confirm no `run_process` shell command approval is requested.
5. Confirm EventLog/export includes preview request and result records.

Expected result: `index.html` is visible through Preview, and step approval
still requires user observation or other verification evidence.

## Validation Scenario 2: Local URL Preview

1. Start a local dev server outside the AI turn or use an already-running local
   preview.
2. Ask DIVE to inspect the local URL.
3. Confirm DIVE accepts loopback URLs and rejects non-local URLs.
4. Confirm Preview shows a clear error if the local URL cannot be reached.

Expected result: local preview is handled as Preview, not a shell command.

## Validation Scenario 3: Project Preview Server

1. Open a project with a configured preview server.
2. Choose the Preview action.
3. Confirm DIVE starts or reuses the preview server.
4. Confirm the Preview tab displays the resulting local URL and Terminal shows
   bounded startup logs.

Expected result: preview startup is visible and logged without arbitrary shell
commands.

## Validation Scenario 4: Direct Test Command

1. Open a step with a direct verification command such as `pnpm test`.
2. Ask DIVE to run the check.
3. Confirm the approval card shows one executable and explicit args.
4. Approve it.
5. Confirm bounded stdout/stderr and exit status appear in Terminal and export.

Expected result: ordinary verification remains low-friction and no shell syntax
is required.

## Validation Scenario 5: Shell Preview Workaround Reroute

1. Trigger or simulate an AI request to open `index.html` through a platform
   shell command.
2. Confirm DIVE does not execute the command.
3. Confirm the permission card closes as blocked/rerouted and states that no
   command ran.
4. Confirm DIVE offers or opens the Preview action for the safe local file.

Expected result: common wrong-tool preview attempts become an understandable
Preview path.

## Validation Scenario 6: Stale Approval

1. Create a pending approval, then cancel, reload, or trigger validation failure
   so the backend request is no longer pending.
2. Click allow or deny on the visible card if it remains.
3. Confirm DIVE visibly closes or downgrades the card within 1 second and
   explains that no command ran.

Expected result: approval buttons do not silently no-op.

## Validation Scenario 7: Terminal Script Guardrails

1. Request a legitimate multi-command verification script.
2. Confirm DIVE presents a distinct high-risk Terminal Script approval card.
3. Confirm approval is one-shot and output is bounded.
4. Request scripts containing destructive, remote-execution, credential dump,
   privilege escalation, and project-root escape patterns.
5. Confirm each unsafe script is blocked before execution.

Expected result: shell-style verification is possible only through the distinct
high-risk path and cannot become the default command path.

## Suggested Commands

```bash
cd ~/DIVE-2/dive
pnpm typecheck
pnpm exec vitest run src/hooks/useChatSession.test.ts src/components/slide-in/PreviewTab.test.tsx src/components/chat/ToolActivity.test.tsx
pnpm test:unit
cd src-tauri
cargo test preview --lib
cargo test run_process --lib
cargo test terminal_script --lib
cargo test export --quiet
```

## Validation Results

### Foundation (P1 / T001-T015)

- Status: Passed targeted foundation validation on 2026-06-17.
- Scope: Shared runtime labels/types, Rust runtime models, EventLog/export
  seams, Pi tool guidance, registry coverage, chat reducer/store evidence
  handling, baseline export and Pi boundary tests.
- Commands:
  - `pnpm typecheck` (passed)
  - `cargo fmt --check` (passed)
  - `cargo test runtime --lib` (passed)
  - `cargo test builtins_include_track0_tools_with_expected_risk --lib`
    (passed)
  - `cargo test --test export_jsonl export_distinguishes_008_runtime_events_and_redacts_outputs`
    (passed)
  - `cargo test --features dev-mock --test tool_guard` (passed)
  - `git diff --check` (passed)
- Notes/Risks: Story-specific Preview opening, Project Command reroute, stale
  approval IPC, and Terminal Script execution remain for later phases.

### Scenario 1: Static HTML Preview

- Status: Passed targeted automated validation in P2 on 2026-06-17.
- Evidence: `cargo test --features dev-mock --test preview_runtime` covers
  project-relative `.html` preview, project escape rejection, unsupported
  extension rejection, and missing project handling. `pnpm exec vitest run
  src/components/slide-in/PreviewTab.test.tsx src/stores/slideIn.test.ts
  src/hooks/useChatSession.test.ts` covers static `index.html` Preview opening
  through `preview_open` with no shell approval copy.
- Risks: Manual desktop smoke still needed to confirm Tauri `convertFileSrc`
  asset rendering inside the packaged webview.

### Scenario 2: Local URL Preview

- Status: Passed targeted automated validation in P2 on 2026-06-17.
- Evidence: `cargo test --features dev-mock --test preview_runtime` covers
  loopback URL acceptance, external URL rejection, unsupported scheme
  rejection, and unreachable loopback failure. PreviewTab Vitest covers
  loopback URL IPC routing and pre-IPC external URL rejection.
- Risks: Manual desktop smoke still needed against a real running dev server.

### Scenario 3: Project Preview Server

- Status: Passed targeted automated validation in P2 on 2026-06-17.
- Evidence: `cargo test --features dev-mock --test preview_runtime` covers
  configured dev-server reuse with local fixture metadata and startup failure
  as a Preview-specific failed state. `preview_open(kind=dev_server)` wraps the
  existing DIVE-owned Preview startup path and records bounded logs plus command
  summary.
- Risks: Manual desktop smoke still needed for a real npm/pnpm/yarn/bun
  project preview startup.

### Scenario 4: Direct Test Command

- Status: Passed targeted automated validation in P3 on 2026-06-17.
- Evidence: `cargo test run_process --lib` covers direct argv commands,
  timeout bounds, project-relative executable paths, path-like arg escape
  rejection, shell wrappers, shell metacharacters, destructive command blocks,
  and no-shell execution. `cargo test
  supervised_run_process_emits_bounded_project_command_evidence --lib` covers
  Pi-sidecar Project Command completion emitting bounded `project_command.result`
  evidence. `pnpm exec vitest run src/components/chat/ToolActivity.test.tsx
  src/components/slide-in/TerminalTab.test.tsx src/hooks/useChatSession.test.ts`
  covers approval copy, terminal output rendering, result grouping, and
  execution evidence state. `cargo test --test export_jsonl
  export_distinguishes_008_runtime_events_and_redacts_outputs` covers export
  distinction and stdout/stderr redaction for `project_command.result`.
- Risks: Manual desktop smoke is still needed for an end-to-end approved
  command from the live permission card through the Terminal tab. Preview-open
  command reroute and stale approval cleanup remain later P4 work.

### Scenario 5: Shell Preview Workaround Reroute

- Status: Passed targeted automated validation in P4 on 2026-06-17.
- Evidence: `cargo test runtime --lib` covers deterministic preview-open
  classification for `open`, `start`, `xdg-open`, `cmd /c start`, and
  `powershell Start-Process`, including unsafe preview-looking targets.
  `cargo test supervised_run_process_reroutes_preview_open_before_approval --lib`
  verifies `run_process(open index.html)` emits `runtime.routing_decision`
  plus no-run `project_command.result` evidence before approval and never emits
  `ToolCallApproved`. `pnpm exec vitest run src/hooks/useChatSession.test.ts
  src/components/chat/ToolActivity.test.tsx` covers reducer/UI states for
  rerouted commands, no-command-ran copy, and Preview reroute handling. `cargo
  test --test export_jsonl
  export_distinguishes_008_runtime_events_and_redacts_outputs` verifies
  `runtime.routing_decision` export records are not verification evidence and
  blocked/rerouted Project Command rows are not external test runs.
- Risks: Manual desktop smoke is still needed to confirm the live reroute event
  opens the Preview tab through `preview_open(source=reroute)` for a real
  selected project.

### Scenario 6: Stale Approval

- Status: Passed targeted automated validation in P4 on 2026-06-17.
- Evidence: `cargo test --features dev-mock --test chat_runtime` covers
  cancelled approvals, missing pending requests, reload-like empty pending
  state, validation-failure/no-registration state, and one-shot resolution.
  `tool_approve` and `tool_deny` now emit `tool_approval.stale` plus
  `runtime.routing_decision(outcome=stale)` when a visible card is no longer
  backed by a pending request. `pnpm exec vitest run
  src/hooks/useChatSession.test.ts src/components/chat/ToolActivity.test.tsx`
  covers stale reducer/UI closure and no-command-ran copy.
- Risks: Manual app smoke is still needed for allow-after-reload and
  deny-after-cancel clicks in a live Tauri window.

### Scenario 7: Terminal Script Guardrails

- Status: Passed targeted automated validation in P5 on 2026-06-18.
- Evidence: `cargo test terminal_script --lib` covers the tool schema, bounded
  timeout/output shape, unsafe-pattern blocking, and the supervised
  Pi-sidecar approval/result path. `cargo test --test terminal_script` covers
  destructive, remote-execution, credential-exposure, privilege-escalation,
  project-root escape, and hidden-background patterns plus bounded
  stdout/stderr/exit/truncation output. `cargo test --features dev-mock --test
  tool_guard terminal_script_registry_schema_requires_high_risk_one_shot_metadata`
  verifies `run_terminal_script` remains a distinct danger tool with explicit
  script/reason/effect/schema metadata. `cargo test --test export_jsonl
  export_distinguishes_008_runtime_events_and_redacts_outputs` verifies
  separate `terminal_script.approval_requested` and `terminal_script.result`
  export rows with script/output redaction. `pnpm exec vitest run
  src/hooks/useChatSession.test.ts src/components/permission-card/PermissionCard.test.tsx
  src/components/slide-in/TerminalTab.test.tsx` covers full-script approval UI,
  shell family, risk factors, timeout, output limit, one-shot copy, bounded
  Terminal output, and truncation markers.
- Risks: Manual desktop smoke is still needed for a live user approval click
  through the installed Tauri permission card. The automated slice verifies the
  Pi-supervised tool path and export evidence but does not prove real shell
  availability on every classroom OS image.

### Preview MVP (P2 / T016-T033)

- Status: Passed targeted Preview MVP validation on 2026-06-17.
- Scope: `preview_open` IPC, static HTML validation, loopback URL validation,
  configured project preview response wrapping, Preview EventLog/export rows,
  Preview tab unavailable/failed states, slide-in preview context/log handling,
  and preview tool/result routing. Preview availability remains an inspection
  surface only and is not written as step verification evidence.
- Commands:
  - `pnpm typecheck` (passed)
  - `pnpm exec vitest run src/components/slide-in/PreviewTab.test.tsx src/stores/slideIn.test.ts src/hooks/useChatSession.test.ts` (passed)
  - `cargo test --features dev-mock --test preview_runtime` (passed)
  - `cargo test runtime --lib` (passed)
  - `cargo test --test export_jsonl export_distinguishes_008_runtime_events_and_redacts_outputs` (passed)
  - `cargo fmt --check` (passed)
  - `git diff --check` (passed)
- Notes/Risks: Static HTML asset rendering and real project preview startup
  still need manual desktop smoke. Project Command reroute/stale approval and
  Terminal Script execution remain later phases.

### Project Command Evidence (P3 / T034-T048)

- Status: Passed targeted Project Command validation on 2026-06-17.
- Scope: `run_process` remains one executable plus explicit args with no shell
  fallback. The schema now carries `reason`, `expected_effect`, and bounded
  `timeout_sec`; timeout values outside 1..60 seconds are rejected instead of
  silently changing approval meaning. Shell wrappers, shell metacharacters,
  absolute/path-escape executable paths, and path-like escaping args are
  rejected before approval. Direct command completion, failure, denial, and
  block states emit bounded `project_command.result` EventLog/export evidence.
  The approval/result UI distinguishes Project Command from Preview and
  Terminal Script and shows executable, args, timeout, reason, and expected
  effect.
- Commands:
  - `cargo test run_process --lib` (passed)
  - `cargo test supervised_run_process_emits_bounded_project_command_evidence --lib` (passed)
  - `cargo test --test export_jsonl export_distinguishes_008_runtime_events_and_redacts_outputs` (passed)
  - `pnpm typecheck` (passed)
  - `pnpm exec vitest run src/components/chat/ToolActivity.test.tsx src/components/slide-in/TerminalTab.test.tsx src/hooks/useChatSession.test.ts` (passed)
- Notes/Risks: Manual desktop smoke for approving a real command remains.
  Preview reroute/stale approval behavior is intentionally left to P4, and
  Terminal Script execution/guardrails remain outside this phase.

### Preview Reroute And Stale Approval (P4 / T049-T064)

- Status: Passed targeted reroute/stale validation on 2026-06-17.
- Scope: Preview-open shell workarounds are classified deterministically and
  intercepted before approval/execution. Safe static HTML and loopback targets
  are rerouted through Preview using `preview_open(source=reroute)`;
  unsafe/external/non-preview targets become preview-unavailable/no-command-ran
  states. Stale allow/deny clicks emit `tool_approval.stale` and
  `runtime.routing_decision(outcome=stale)`. Export summaries keep reroutes and
  stale approvals separate from verification evidence, and no blocked/rerouted
  Project Command row is counted as an external test run.
- Commands:
  - `cargo fmt --check` (passed)
  - `cargo test runtime --lib` (passed)
  - `cargo test supervised_run_process_reroutes_preview_open_before_approval --lib` (passed)
  - `cargo test --features dev-mock --test chat_runtime` (passed)
  - `cargo test --test export_jsonl export_distinguishes_008_runtime_events_and_redacts_outputs` (passed)
  - `pnpm typecheck` (passed)
  - `pnpm exec vitest run src/hooks/useChatSession.test.ts src/components/chat/ToolActivity.test.tsx` (passed)
- Notes/Risks: Manual desktop smoke remains for live Preview tab opening from a
  rerouted shell workaround and for visible stale approve/deny clicks after app
  reload or cancellation. Terminal Script execution/guardrails remain outside
  this phase by design.

### Terminal Script Guardrails (P5 / T065-T081)

- Status: Passed targeted Terminal Script validation on 2026-06-18.
- Scope: `run_terminal_script` is now a distinct high-risk tool, not a
  Project Command mode or Preview workaround. It requires full script, shell
  family, reason, expected effect, timeout, and output limit metadata; blocks
  destructive, remote-execution, credential exposure, privilege escalation,
  project-root escape, and hidden background/persistence patterns before
  approval; runs only after one-shot danger approval; captures bounded
  stdout/stderr/exit/truncation state; and logs/exports
  `terminal_script.approval_requested` plus `terminal_script.result` separately
  from `project_command.result`.
- Commands:
  - `cargo fmt --check` (passed)
  - `cargo test terminal_script --lib` (passed)
  - `cargo test --test terminal_script` (passed)
  - `cargo test supervised_terminal_script_logs_one_shot_approval_and_bounded_result --lib` (passed)
  - `cargo test --features dev-mock --test tool_guard terminal_script_registry_schema_requires_high_risk_one_shot_metadata` (passed)
  - `cargo test --test export_jsonl export_distinguishes_008_runtime_events_and_redacts_outputs` (passed)
  - `pnpm typecheck` (passed)
  - `pnpm exec vitest run src/hooks/useChatSession.test.ts src/components/permission-card/PermissionCard.test.tsx src/components/slide-in/TerminalTab.test.tsx` (passed)
- Notes/Risks: Manual desktop smoke remains for approving a real Terminal
  Script in the installed app and confirming shell-family availability on the
  target OS. Preview still does not use shell commands, and Project Command
  still rejects shell wrappers/metacharacters instead of falling back to shell.

### Final Validation And Handoff (P6 / T082-T089)

- Status: Passed automated validation and dev-app manual smoke on 2026-06-18.
- Scope: Shipped 008 scope/status documentation, full quickstart validation
  evidence, frontend targeted/full validation, Rust targeted/full validation,
  EventLog/export distinction, no-shell Preview reroute boundaries, direct
  Project Command argv boundaries, Terminal Script high-risk guardrails, and
  live static HTML Preview asset rendering.
- Commands:
  - `pnpm typecheck` (passed)
  - `pnpm exec vitest run src/hooks/useChatSession.test.ts src/components/slide-in/PreviewTab.test.tsx src/components/slide-in/TerminalTab.test.tsx src/components/chat/ToolActivity.test.tsx src/components/permission-card/PermissionCard.test.tsx src/stores/slideIn.test.ts` (passed: 6 files, 29 tests)
  - `pnpm test:unit` (passed: 47 files, 266 tests)
  - `cargo fmt --check` (passed)
  - `cargo test runtime --lib` (passed)
  - `cargo test run_process --lib` (passed)
  - `cargo test terminal_script --lib` (passed)
  - `cargo test --features dev-mock --test preview_runtime` (passed)
  - `cargo test --features dev-mock --test chat_runtime` (passed)
  - `cargo test --test terminal_script` (passed)
  - `cargo test --test export_jsonl export_distinguishes_008_runtime_events_and_redacts_outputs` (passed)
  - `cargo test --features dev-mock --test tool_guard terminal_script_registry_schema_requires_high_risk_one_shot_metadata` (passed)
  - `cargo test` (passed: 497 lib tests plus default integration/doc suites; 8 ignored live/keyring/provider smokes)
- Manual smoke: `pnpm tauri:dev` opened a live Tauri dev window. Static
  `index.html` Preview initially produced a blank iframe, which exposed a real
  asset protocol configuration gap. The fix enables Tauri `protocol-asset`,
  adds `app.security.assetProtocol`, keeps Preview target validation in Rust,
  and allows Preview frames to load `asset.localhost`.
- Notes/Risks: Packaged-app and target-OS classroom images still need release
  smoke for asset protocol scope, dev-server Preview, stale clicks, direct
  command approval, and Terminal Script shell-family availability.

## Manual Smoke Checklist

- [x] Preview opens static HTML without shell approval in a live Tauri window.
- [x] Static HTML blank-screen regression fixed by enabling Tauri asset
  protocol and Preview frame CSP coverage.
- [x] Preview accepts loopback local URLs and rejects external URLs in a live
  Tauri window.
- [x] Project preview server startup/reuse shows Preview plus bounded startup
  logs in a live Tauri window.
- [x] Direct commands still run ordinary test/build checks from the live
  permission card into Terminal output.
- [x] Shell-preview workarounds reroute to Preview and state that no command
  ran in the live permission/card flow.
- [x] Stale allow/deny clicks visibly close or downgrade the card within 1
  second in a live app reload/cancel scenario.
- [x] Terminal Script approval is visually distinct, high-risk, one-shot, and
  blocks unsafe fixtures in the live permission-card flow.
- [x] Automated EventLog/export validation separates preview, command,
  terminal script, user observation, AI self-report, and approval decision.
