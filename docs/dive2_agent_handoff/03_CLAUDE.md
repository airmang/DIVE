# CLAUDE.md — DIVE-2 Claude Code Instructions

## Start Mode

Begin analysis in Plan Mode. Do not edit files until a scoped plan is approved.

Recommended start:

```bash
claude --permission-mode plan
```

or use `/plan` for the first task.

## Project Mission

Refactor DIVE-2 into a beginner-friendly desktop coding agent product.

The user should not have to use a terminal/TUI. The Rust/Tauri backend agent performs local coding work, while the desktop UI presents planning, roadmap, patch preview, approval, verification, and undo.

## Non-negotiable Constraints

- Preserve existing AgentLoop/provider/tools/permission/checkpoint infrastructure unless a task explicitly requests a small adapter.
- Do not expose research survey, ablation controls, teacher/student copy, or classroom framing in normal product UI.
- Plan must be approved before file edits or command execution are allowed.
- D/I/V/E and card/gate can remain internal, but user-facing UI should use goal/plan/roadmap/step/check/undo language.
- Keep changes PR-sized.

## Required Inspection Before Implementation

Open and summarize these files before making changes:

- `README.md`
- `dive/README.md`
- `dive/package.json`
- `dive/src/App.tsx`
- `dive/src/components/shell/MainShell.tsx`
- `dive/src/components/shell/WorkmapStrip.tsx`
- `dive/src/components/workmap/AiAssistDialog.tsx`
- `dive/src/components/workmap/CardDetailPanel.tsx`
- `dive/src/hooks/useWorkmap.ts`
- `dive/src/stores/workmap.ts`
- `dive/src/pages/settings.tsx`
- `dive/src-tauri/src/agent/mod.rs`
- `dive/src-tauri/src/agent/permission.rs`
- `dive/src-tauri/src/dive/gate.rs`
- `dive/src-tauri/src/ipc/mod.rs`

## Development Style

- Prefer small adapters to large rewrites.
- Extract components before redesigning behavior.
- Keep existing tests green.
- Use TypeScript types for product UI models.
- Keep Rust permission safety explicit and tested.

## Validation

Frontend:

```bash
cd dive && pnpm typecheck && pnpm lint && pnpm build
```

Rust:

```bash
cd dive/src-tauri && cargo fmt --all -- --check && cargo test --features dev-mock --all-targets && cargo clippy --features dev-mock --all-targets -- -D warnings
```

## Final Reply

Include changed files, product UX impact, test results, and remaining risks.
