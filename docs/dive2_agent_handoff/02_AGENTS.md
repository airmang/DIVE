# AGENTS.md — DIVE-2 Repository Instructions

This file is intended for coding agents working inside the DIVE-2 repository.

## Product Goal

DIVE-2 is being refactored into a product-like beginner desktop coding agent.

The target user is a general beginner who wants to try vibe coding alone. The local agent may work with files and commands, but the user should interact through a clear desktop UI, not a TUI or terminal.

## Core UX Direction

- Plan-first: user describes what they want, DIVE asks clarifying questions, DIVE creates a plan, user approves the plan, then one roadmap step is executed at a time.
- Always show roadmap/progress/current step in the desktop UI.
- Show simple explanations before raw logs.
- Show patch/diff previews before applying changes.
- Make undo/checkpoint visible.
- Hide D/I/V/E and card/gate terminology from normal product UI where possible.
- Keep D/I/V/E and card models internally if they reduce risk.

## Architecture Constraints

Do not rewrite the Rust backend agent architecture unless a task explicitly says so.

Existing backend infrastructure to preserve:

- `dive/src-tauri/src/agent/mod.rs` — AgentLoop
- `dive/src-tauri/src/agent/permission.rs` — PermissionHook, PendingApprovals, AutoApprovePolicy
- `dive/src-tauri/src/ipc/mod.rs` — Tauri command surface
- `dive/src-tauri/src/tools/` — local tools
- `dive/src-tauri/src/checkpoint/` — checkpoint engine
- `dive/src-tauri/src/db/` — SQLite persistence
- `dive/src/hooks/useWorkmap.ts` and `dive/src/stores/workmap.ts` — current card/workmap frontend model

Prefer adapters and incremental refactors:

- Add `useRoadmap()` over `useWorkmap()` before changing persistence.
- Add product components beside legacy components before deleting legacy flow.
- Introduce new UI language gradually while keeping tests passing.

## User-facing Language Rules

Use product language:

- 계획
- 로드맵
- 작업 단계
- 변경사항
- 작동 확인
- 되돌리기
- AI 연결
- 실행 전 확인

Avoid normal product UI language:

- 학생
- 교사
- 차시
- 연구 전용
- ablation
- D/I/V/E 게이트
- 카드, unless in internal/dev UI
- 프로바이더, unless in advanced settings

## Safety Rules

- Do not allow file edit/write/bash/run before plan approval.
- Do not rely only on prompt instructions for safety; enforce in app/Rust policy where relevant.
- Never add dangerous auto-approval defaults.
- Do not expose bypass or full-auto permission paths in beginner UX.
- Keep project-folder boundary protections.
- Do not read or display secrets or `.env` contents.

## PR Scope Rules

- Keep PRs small.
- Do not mix product copy cleanup, shell extraction, Rust permission policy, and settings redesign in one PR.
- Each PR must include a clear acceptance checklist.
- If the requested task is ambiguous, first produce a plan and ask for approval.

## Validation Commands

Frontend:

```bash
cd dive
pnpm typecheck
pnpm lint
pnpm build
```

Rust:

```bash
cd dive/src-tauri
cargo fmt --all -- --check
cargo test --features dev-mock --all-targets
cargo clippy --features dev-mock --all-targets -- -D warnings
```

Run frontend checks for frontend changes. Run Rust checks for Rust changes. Run both for mixed changes.

## Final Response Requirements

Every agent completion must include:

1. Files changed
2. Why the change supports the beginner product refactor
3. Tests run and results
4. Known risks
5. Follow-up tasks

Do not claim success if tests were not run.
