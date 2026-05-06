# DIVE-2 Refactor — Prompt Set for Codex / OpenCode / Claude Code

이 문서는 DIVE-2 리팩토링을 코드 에이전트에게 위임할 때 사용할 프롬프트 세트다. 각 프롬프트는 독립 PR 단위로 설계되어 있다.

사용 원칙:

- 첫 번째 에이전트 실행은 반드시 **분석/계획 전용**으로 한다.
- Codex는 Suggest 또는 승인 중심 모드로 시작한다.
- Claude Code는 `--permission-mode plan` 또는 `/plan`으로 시작한다.
- OpenCode는 Plan agent 또는 `edit: deny`, `bash: ask/deny` 설정으로 시작한다.
- 구현 프롬프트는 한 번에 하나만 전달한다.
- 각 PR이 끝날 때 반드시 테스트 결과와 변경 요약을 요구한다.

---

## 0. 공통 시스템/작업 지시 프롬프트

아래 프롬프트를 모든 에이전트 세션의 첫 메시지 또는 repo instruction으로 사용한다.

```text
You are working in the DIVE-2 repository.

Goal:
Refactor DIVE-2 from an education/research-oriented D/I/V/E workflow desktop app into a product-like beginner desktop coding agent. The Rust/Tauri backend already contains an agent loop, permission approval, project DB, provider runtime, tools, checkpoints, and IPC. Do not rewrite the backend agent architecture unless the current task explicitly requires a small adapter or mode/policy addition.

Product direction:
- The user is a general beginner trying vibe coding alone, not a student in a classroom.
- The local agent may read/edit/run code, but the beginner interacts through the desktop UI, not a TUI or terminal.
- The product must be Plan-first: user describes what they want, DIVE asks clarifying questions, DIVE creates a plan, user approves the plan, then one roadmap step is implemented at a time.
- D/I/V/E and card/gate terminology may remain as internal implementation details, but product UI should use beginner-friendly language: goal, plan, roadmap, step, change preview, run check, undo.

Hard constraints:
- Do not expose teacher/student/research survey/ablation controls in the normal production product surface.
- Do not allow file edits or command execution before a plan is approved.
- Do not make raw tool logs the primary beginner UI. Show simple explanations first; raw details can be collapsed.
- Preserve existing Tauri IPC, SQLite persistence, provider runtime, permission hook, checkpoint, and tool infrastructure where possible.
- Prefer adapters and incremental refactors over large rewrites.
- Keep PRs small and independently testable.

Before editing:
1. Inspect these files: README.md, dive/README.md, dive/package.json, dive/src/App.tsx, dive/src/components/shell/MainShell.tsx, dive/src/components/shell/WorkmapStrip.tsx, dive/src/components/workmap/AiAssistDialog.tsx, dive/src/components/workmap/CardDetailPanel.tsx, dive/src/hooks/useWorkmap.ts, dive/src/stores/workmap.ts, dive/src/pages/settings.tsx, dive/src-tauri/src/agent/mod.rs, dive/src-tauri/src/agent/permission.rs, dive/src-tauri/src/dive/gate.rs, dive/src-tauri/src/ipc/mod.rs.
2. Report your understanding of the current architecture.
3. Propose a minimal change plan for the current PR only.
4. Wait for approval before making edits if you are in a plan/review session.

Validation:
- Frontend-only PR: cd dive && pnpm typecheck && pnpm lint && pnpm build
- Rust PR: cd dive/src-tauri && cargo fmt --all -- --check && cargo test --features dev-mock --all-targets && cargo clippy --features dev-mock --all-targets -- -D warnings
- Mixed PR: run both frontend and Rust checks when feasible.

Final response must include:
- Summary of changed files
- Why each change supports the product refactor
- Tests run and results
- Known risks or follow-up tasks
```

---

## 1. Analysis-only Prompt

Codex/Claude/OpenCode에게 실제 구현 전에 레포 상태를 분석하게 할 때 사용한다.

```text
Analyze the DIVE-2 repository for the product UX refactor, but do not edit files.

Focus:
1. Confirm where the current UI exposes education/research/student/teacher language.
2. Confirm where D/I/V/E and card terminology appear in production UI.
3. Confirm the current MainShell responsibilities and identify the safest component split.
4. Confirm how workmap/card state maps to the product concept of roadmap/step.
5. Confirm how AgentLoop, PermissionHook, and tool approval currently work.
6. Identify the smallest first PR that moves the product surface toward a beginner desktop coding agent.

Output:
- Architecture summary
- Product UX problems found, with file paths
- Proposed PR sequence, max 10 PRs
- First PR exact file list
- Risks and what not to touch yet

Do not modify files. Do not run destructive commands. You may run read-only commands such as git status, find, grep/rg, pnpm scripts listing, and cargo test discovery only if safe.
```

---

## 2. PR 1 Prompt — Product Surface Cleanup

```text
Implement PR 1: Product Surface Cleanup.

Objective:
Remove or hide education/research/teacher/student surface from the normal production product flow. DIVE should look like a beginner desktop coding agent, not a classroom/research tool.

Scope:
- README.md
- dive/README.md
- dive/src-tauri/Cargo.toml
- dive/src/App.tsx
- dive/src/pages/settings.tsx
- dive/src/i18n/ko.json
- dive/src/i18n/en.json
- Only touch dive/src/pages/research-survey.tsx if needed to isolate it.

Required changes:
1. Update product copy to target a general beginner trying vibe coding alone.
2. Fix documentation mismatch: if package.json uses React 19, do not keep README saying React 18.
3. Move or demote teacher/student/research references out of the public product introduction.
4. In App.tsx, prevent research-survey from being a normal production product route. It can remain dev/internal gated.
5. In SettingsPage, hide research-only settings unless dev/internal research controls are enabled.
6. Rename visible “프로바이더” language where practical to “AI 연결” or similar user-facing wording.
7. Do not change backend behavior in this PR.

Acceptance criteria:
- Normal product route does not expose research survey.
- Settings normal view does not show ablation/research controls.
- README positions DIVE as a product-like beginner desktop coding agent.
- Typecheck/lint/build pass.

Validation:
Run:
cd dive && pnpm typecheck && pnpm lint && pnpm build

Final response:
- List product copy changes.
- State whether research route is hidden/gated and how.
- Include validation results.
```

---

## 3. PR 2 Prompt — Split MainShell

```text
Implement PR 2: Split MainShell into product shell components.

Objective:
Reduce MainShell responsibility without changing core behavior. Prepare for a product layout with TopBar, ProjectRail, ConversationPanel, RoadmapPanel, ActionDock, and ModalHost.

Scope:
- dive/src/components/shell/MainShell.tsx
- Add new components under dive/src/components/product/
- Move only UI orchestration code; avoid backend and IPC changes.

Required changes:
1. Create ProductShell.tsx and render it from MainShell.
2. Extract layout pieces:
   - TopBar.tsx
   - ProjectRail.tsx or wrap existing Sidebar temporarily
   - ConversationPanel.tsx or wrap existing ChatArea temporarily
   - RoadmapPanel.tsx or wrap existing WorkmapStrip temporarily
   - ActionDock.tsx placeholder if needed
   - ModalHost.tsx for dialogs
3. Keep existing functionality working.
4. Do not redesign all visuals in this PR.
5. Do not rename internal workmap/card types yet.

Acceptance criteria:
- MainShell becomes a thin wrapper or at least much smaller.
- ProductShell owns layout.
- Existing project/session/chat/workmap flows still compile.
- No behavior change beyond structural extraction.

Validation:
cd dive && pnpm typecheck && pnpm lint
Run pnpm build if changes are broad.

Final response:
- Explain the new component boundaries.
- List files moved/created.
- Include validation results.
```

---

## 4. PR 3 Prompt — Roadmap Adapter

```text
Implement PR 3: Add Roadmap adapter over Workmap/Card model.

Objective:
Keep the internal card/workmap persistence model, but expose a product UI model named Roadmap/Step.

Scope:
- dive/src/hooks/useWorkmap.ts
- dive/src/stores/workmap.ts only if needed
- Add dive/src/features/roadmap/types.ts
- Add dive/src/features/roadmap/cardToStep.ts
- Add dive/src/features/roadmap/useRoadmap.ts
- Update product shell/roadmap UI to consume RoadmapStep where feasible.

Required types:
- RoadmapStep
- RoadmapStepStatus: planned, ready, running, checking, done, needs_changes, extended
- RoadmapProgress

Mapping:
- decomposed -> planned
- instructed -> ready
- verifying -> checking
- verified -> done
- rejected -> needs_changes
- extended -> extended

Required changes:
1. Add adapter functions from CardTileData to RoadmapStep.
2. Add useRoadmap(sessionId) that wraps useWorkmap(sessionId).
3. Do not change DB schema.
4. Do not rename Rust CardState in this PR.
5. Start replacing user-facing labels “card/workmap” with “step/roadmap” where the adapter is used.

Acceptance criteria:
- UI can render roadmap steps without directly depending on CardTileData.
- Internal workmap still works.
- Typecheck/lint pass.

Validation:
cd dive && pnpm typecheck && pnpm lint

Final response:
- Explain adapter design.
- List remaining places still using card/workmap terminology.
- Include validation results.
```

---

## 5. PR 4 Prompt — Persistent Roadmap Panel

```text
Implement PR 4: Replace the default bottom WorkmapStrip UX with a persistent RoadmapPanel.

Objective:
Make roadmap visibility the core beginner navigation surface. The user should always know the current step, progress, and next action.

Scope:
- dive/src/components/product/RoadmapPanel.tsx
- dive/src/components/product/ProductShell.tsx
- Existing WorkmapStrip may remain for legacy/demo, but should not be the primary production navigation.
- Add RoadmapStepList component if useful.

Required changes:
1. Use a 3-column product layout if feasible: ProjectRail | ConversationPanel | RoadmapPanel.
2. RoadmapPanel displays:
   - Overall progress
   - Current step
   - Step statuses
   - Next recommended action
   - Changed files count when available
3. Replace user-facing “워크맵/카드” with “로드맵/작업 단계” in the production layout.
4. Keep accessibility labels reasonable.
5. Do not modify Rust in this PR.

Acceptance criteria:
- Roadmap is visible by default in production shell.
- Bottom strip is not the primary production roadmap UI.
- Current step and progress are visible.
- Typecheck/lint/build pass.

Validation:
cd dive && pnpm typecheck && pnpm lint && pnpm build

Final response:
- Describe the new layout.
- Note any legacy WorkmapStrip usages left.
- Include validation results.
```

---

## 6. PR 5 Prompt — Deep Interview and Plan Draft

```text
Implement PR 5: Deep Interview + PlanDraft flow.

Objective:
Change the beginner start flow from “create cards first” to “describe what you want, answer a few questions, review a plan, then generate roadmap steps.”

Scope:
- New planning feature under dive/src/features/planning/
- Replace or wrap AiAssistDialog behavior.
- Rust IPC only if necessary; prefer frontend adapter first if lower risk.
- Existing card_create/workmap persistence should be reused when plan is accepted.

Required UX:
1. User enters a natural-language goal.
2. DIVE asks at most 3 clarifying questions at a time.
3. Questions must include choices and a “잘 모르겠음” path where appropriate.
4. After 2–3 turns or enough information, DIVE presents a PlanDraft.
5. PlanDraft includes:
   - goal
   - MVP scope
   - non-goals
   - roadmap steps
   - success criteria
   - assumptions/risks
6. User can choose:
   - 계획 수정
   - 더 작게 줄이기
   - 이 계획으로 시작
7. Accepting the plan creates existing cards/steps through current persistence path.

Suggested types:
- ProjectBrief
- InterviewQuestion
- InterviewTurn
- PlanDraft
- PlanStepDraft

Acceptance criteria:
- A new user can start by describing what they want, not by manually creating a card.
- Plan review appears before implementation.
- Accepting a plan creates roadmap steps.
- Existing workmap/card DB path remains intact.

Validation:
cd dive && pnpm typecheck && pnpm lint && pnpm build
If Rust IPC is added:
cd dive/src-tauri && cargo fmt --all -- --check && cargo test --features dev-mock --all-targets && cargo clippy --features dev-mock --all-targets -- -D warnings

Final response:
- Explain how ProjectBrief becomes roadmap steps.
- Explain how plan approval is enforced in UI.
- Include validation results.
```

---

## 7. PR 6 Prompt — Plan-first Permission Profile

```text
Implement PR 6: Plan-first permission profile / AgentRunMode.

Objective:
Prevent file edits and command execution before plan approval at the Rust/application layer, not only by prompt instruction.

Scope:
- dive/src-tauri/src/agent/mod.rs
- dive/src-tauri/src/agent/permission.rs
- dive/src-tauri/src/ipc/mod.rs
- Add run_mode module if clean.
- Minimal frontend changes to pass runMode from planning/build flow if required.

Required design:
1. Introduce AgentRunMode or equivalent:
   - Interview
   - Plan
   - Build
   - Verify
   - Recovery
2. Mode policy:
   - Interview: deny edit/write/delete/mkdir/bash/run_process
   - Plan: allow read/list/search, deny edit/write/delete/mkdir/bash/run_process
   - Build: ask for edit/write/run, deny external paths/dangerous commands
   - Verify: allow/ask test commands, read, diff
   - Recovery: checkpoint restore + read/diff only
3. Do not rely only on LLM instructions.
4. Preserve existing PermissionHook/PendingApprovals behavior.
5. Add tests for blocking edit/write/run before plan approval.

Acceptance criteria:
- In Plan/Interview mode, edit/write/run tools cannot execute.
- In Build mode, existing approval flow still works.
- Tests cover the mode policy.

Validation:
cd dive/src-tauri
cargo fmt --all -- --check
cargo test --features dev-mock --all-targets
cargo clippy --features dev-mock --all-targets -- -D warnings
If frontend touched: cd dive && pnpm typecheck && pnpm lint

Final response:
- Explain the policy boundary.
- List tests added.
- Include validation results.
```

---

## 8. PR 7 Prompt — Beginner Execution UI

```text
Implement PR 7: Beginner execution UI for tool approvals and commands.

Objective:
Make local agent actions understandable to non-developer beginners. Show simple explanations first, raw details only on demand.

Scope:
- Chat message rendering
- Permission/tool call UI components
- Add execution components under dive/src/features/execution/
- No major Rust changes unless a missing field is required.

Required UI for file changes:
- Action type: file read/edit/write/delete
- File path
- Plain-language reason
- Risk level
- Buttons: View details, Allow, Deny

Required UI for commands:
- Command
- Meaning
- Whether it changes files
- Whether it needs network
- What happens if it fails
- Buttons: Run once, Cancel

Required behavior:
- Raw JSON/tool args/logs are collapsed by default.
- Diff preview, if available, is shown as “변경 전 확인”.
- Error messages must include next actions.

Acceptance criteria:
- Tool approval cards are beginner-readable.
- Raw logs are not the default primary UI.
- Existing approval/deny IPC still works.
- Typecheck/lint/build pass.

Validation:
cd dive && pnpm typecheck && pnpm lint && pnpm build

Final response:
- Describe UI changes for tool approvals.
- Explain how raw details are still accessible.
- Include validation results.
```

---

## 9. PR 8 Prompt — Patch Preview and Recovery/Undo

```text
Implement PR 8: Patch preview and Recovery/Undo center.

Objective:
Make “review changes before applying” and “undo safely” central product features.

Scope:
- Slide-in/code panel
- Patch preview UI
- Checkpoint/restore UI
- Recovery panel for failures
- Reuse existing checkpoint IPC where possible.

Required UI:
1. PatchPreviewPanel:
   - Plain summary
   - Changed files
   - Risk level
   - Collapsible detailed diff
   - Buttons: Apply, Ask for revision, Cancel
2. UndoBar:
   - Shows whether undo is available
   - Shows last checkpoint label/time if available
3. RecoveryPanel:
   - Problem summary
   - Possible causes
   - Next actions: Retry, Ask AI to fix, Modify plan, Undo

Acceptance criteria:
- User can see what will change before accepting.
- User can find undo without hunting through menus.
- Failures do not end as only raw error/toast.
- Typecheck/lint/build pass.

Validation:
cd dive && pnpm typecheck && pnpm lint && pnpm build
If checkpoint Rust touched, run Rust checks.

Final response:
- Explain patch preview flow.
- Explain recovery/undo flow.
- Include validation results.
```

---

## 10. PR 9 Prompt — Settings Simplification

```text
Implement PR 9: Settings simplification for beginner product UX.

Objective:
Restructure Settings into beginner-friendly sections and hide advanced/research controls from normal users.

Scope:
- dive/src/pages/settings.tsx
- settings subcomponents if created
- i18n resources

Target sections:
1. AI 연결
2. 앱 설정
3. 안전 설정
4. 고급

Required changes:
- Rename visible “프로바이더” to “AI 연결” where user-facing.
- Move automatic approval policy into Safety or Advanced, not top-level confusing area.
- Move MCP server management into Advanced.
- Hide research controls unless dev/internal flag is active.
- Rename tutorial mode to “자세한 설명 보기” or similar.

Acceptance criteria:
- Settings first view is not overwhelming.
- Research controls are not visible in normal production surface.
- Advanced features remain accessible but clearly separated.
- Typecheck/lint/build pass.

Validation:
cd dive && pnpm typecheck && pnpm lint && pnpm build

Final response:
- Explain new settings information architecture.
- Include validation results.
```

---

## 11. PR 10 Prompt — Copy Polish and Onboarding

```text
Implement PR 10: Copy polish and onboarding productization.

Objective:
Make first-run and empty states feel like a polished beginner product.

Scope:
- Onboarding components
- New project dialog
- Empty states in product shell/chat/conversation
- i18n resources
- README if final copy needs sync

Required first-run flow:
1. Pick project folder.
2. Connect AI.
3. Describe what you want to build.
4. Answer a few planning questions.
5. Review plan.
6. Start first roadmap step.

Required copy rules:
- Avoid “학생”, “교사”, “차시”, “연구”, “게이트”, “ablation” in normal product UI.
- Use “처음 사용하는 사람”, “초심자”, “계획”, “로드맵”, “작업 단계”, “작동 확인”, “되돌리기”.
- Avoid making the user feel tested or graded.

Acceptance criteria:
- A new user knows the next action within 60 seconds.
- Empty states have one clear CTA.
- Product copy is consistent across Korean and English.
- Typecheck/lint/build pass.

Validation:
cd dive && pnpm typecheck && pnpm lint && pnpm build

Final response:
- Summarize copy and onboarding changes.
- Include validation results.
```

---

## 12. Review-only Prompt

다른 에이전트에게 구현 결과를 리뷰만 시킬 때 사용한다.

```text
Review the current branch for the DIVE-2 product UX refactor. Do not edit files.

Review focus:
1. Does the change move DIVE toward a beginner desktop coding agent product?
2. Does it avoid exposing teacher/student/research/ablation surfaces in normal product flow?
3. Does it preserve existing Rust/Tauri agent infrastructure?
4. Does it keep changes scoped to the intended PR?
5. Are D/I/V/E and card terminology hidden or reduced in user-facing UI where expected?
6. Are tests and validation commands sufficient?
7. Are there new risks around permissions, file edits, command execution, or checkpoint restore?

Output:
- Verdict: approve / request changes / block
- Critical issues
- Non-blocking suggestions
- Files that need follow-up
- Missing tests

Do not modify files.
```

---

## 13. QA/Fix Prompt

테스트 실패나 리뷰 지적 후 수정용 프롬프트다.

```text
Fix the current branch based only on the failing tests and review comments below.

Constraints:
- Do not expand scope.
- Do not start a new refactor.
- Do not rename unrelated files or change unrelated UI.
- Preserve the intent of this PR.
- After fixing, rerun the smallest relevant validation command first, then the full required command if feasible.

Review/test failures:
[PASTE FAILURES HERE]

Output:
- Root cause
- Files changed
- Validation command results
- Any remaining risk
```

---

## 14. Final PR Summary Prompt

에이전트에게 PR 설명문을 쓰게 할 때 사용한다.

```text
Write a concise PR summary for the current branch.

Include:
1. What changed
2. Why it supports the DIVE beginner product UX refactor
3. User-facing behavior changes
4. Internal architecture changes
5. Tests run
6. Screenshots needed, if any
7. Follow-up tasks

Do not overclaim. If a planned item was not completed, list it as follow-up.
```

---

## 15. Suggested Agent Mode Usage

### Codex

Use for:
- PR-sized implementation
- Large file refactors with tests
- Applying structured instructions from `AGENTS.md`

Recommended:
- Start in Suggest mode for analysis.
- Use Auto Edit only for a single scoped PR.
- Avoid Full Auto unless running in a clean sandbox or throwaway branch.

### Claude Code

Use for:
- Planning/refactor design
- UI architecture review
- careful multi-file changes after plan approval

Recommended:
- Start with `claude --permission-mode plan` or `/plan`.
- Approve one PR-sized plan at a time.
- Avoid bypass permissions.

### OpenCode

Use for:
- Build/Plan agent split
- Strict permission configs
- Subagent review flows

Recommended:
- Use Plan agent for analysis.
- Use permission config that denies edits during review.
- For build tasks, keep bash commands ask-based and deny git push/commit unless explicitly requested.

