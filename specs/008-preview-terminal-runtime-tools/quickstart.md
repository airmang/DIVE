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
cd C:/Users/kokyu/Code/DIVE-2/dive
pnpm typecheck
pnpm exec vitest run src/hooks/useChatSession.test.ts src/components/slide-in/PreviewTab.test.tsx src/components/chat/ToolActivity.test.tsx
pnpm test:unit
cd src-tauri
cargo test preview --lib
cargo test run_process --lib
cargo test terminal_script --lib
cargo test export --quiet
```

## Manual Smoke Checklist

- Preview opens static HTML without shell approval.
- Preview rejects external URLs and project-root escape paths.
- Direct commands still run ordinary test/build checks.
- Shell-only syntax is not accepted as Project Command.
- Terminal Script, when implemented, is visually distinct and high-risk.
- EventLog/export separates preview, command, terminal script, user
  observation, AI self-report, and approval decision.
