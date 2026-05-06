# DIVE-2 `/goal` + Ralph 작업 위임 프롬프트 세트

> 목적: DIVE-2의 기존 Ralph 루프와 Codex `/goal` 방식에 맞춰, “교육/연구용 D/I/V/E 워크맵 앱”을 “일반 초심자용 Plan-first 데스크톱 코딩 에이전트 제품”으로 리팩토링하도록 에이전트에게 위임한다.

---

## 0. 반드시 먼저 읽을 것

이 프롬프트 세트는 다음 전제에 맞춰 작성되었다.

- DIVE-2는 이미 Tauri 2 + React/TypeScript + Rust 백엔드 기반 데스크톱 앱이다.
- Rust 백엔드에는 agent loop, tools, permission hook, checkpoint, SQLite DB, provider runtime이 이미 존재한다.
- 이번 작업의 핵심은 백엔드 재작성보다 제품형 데스크톱 UX 리팩토링이다.
- 기존 Ralph 문서 구조는 `DIVE_SPEC.md`, `DIVE_DECISIONS.md`, `DIVE_PROGRESS.md`, `DIVE_NEXT.md`, `RALPH_PROMPT.md` 중심이다.
- 기존 Ralph는 매 턴 fresh Codex 호출로 시작하므로, 모든 상태는 SoT 문서에 남아 있어야 한다.

---

## 1. 가장 중요한 사전 경고: 기존 Ralph 프롬프트와 새 리팩토링 방향이 충돌함

현재 `docs/internal/RALPH_PROMPT.md`에는 기존 제품 불변 조건이 들어 있다.

특히 아래 결정은 새 제품 방향과 충돌한다.

```text
- 워크맵은 화면 하단 가로 띠 (좌측·중앙 세로 패널 X)
```

새 리팩토링 방향은 다음이다.

```text
- 로드맵은 초심자의 현재 위치 인식을 위해 우측 패널 또는 항상 보이는 주요 영역으로 승격한다.
- D/I/V/E 용어는 내부 모델로 유지하되, 제품 UI에서는 목표 정리 / 계획 확정 / 만들기 / 확인하기로 바꾼다.
- 사용자는 카드를 먼저 만들지 않고, 자연어로 만들고 싶은 것을 말하면 Deep Interview → Plan Review → Roadmap 생성 흐름을 탄다.
```

따라서 **기존 `RALPH_PROMPT.md`를 그대로 두고 Ralph를 실행하면 안 된다.** 먼저 SoT와 Ralph 프롬프트를 “Product UX Refactor” 방향으로 정렬해야 한다.

---

## 2. 추천 운영 방식

### 권장 순서

```text
1. 새 branch 생성
2. docs/internal/DIVE_PRODUCT_REFACTOR_PLAN.md 추가
3. 기존 SoT 충돌 audit
4. 사용자 승인 후 RALPH_PROMPT.md의 불변 조건 갱신
5. DIVE_PROGRESS.md에 Phase 8 Product UX Refactor 추가
6. DIVE_NEXT.md를 8-0 사전 정렬 작업으로 교체
7. /goal 또는 Ralph 루프로 8-1부터 순차 실행
8. 각 PR 단위로 멈춰서 사용자가 검토
```

### 브랜치 이름 제안

```bash
git checkout -b refactor/product-ux-plan-first
```

---

## 3. `/goal` 사용 전 Preflight Audit 프롬프트

이 프롬프트는 코드 수정 전에 레포와 SoT 충돌을 점검하는 용도다.

```text
/goal Audit DIVE-2 for readiness to run the Product UX Refactor via Ralph.

You are working in the DIVE-2 repository.

Goal:
Prepare a read-only audit report that identifies conflicts between the current Ralph/SoT documents and the new product UX refactor direction.

Read these files first:
- README.md
- dive/README.md
- docs/internal/RALPH_README.md
- docs/internal/RALPH_PROMPT.md
- docs/internal/DIVE_NEXT.md
- docs/internal/DIVE_PROGRESS.md
- docs/internal/DIVE_DECISIONS.md
- dive/src/App.tsx
- dive/src/components/shell/MainShell.tsx
- dive/src/components/shell/WorkmapStrip.tsx
- dive/src/components/workmap/AiAssistDialog.tsx
- dive/src/components/workmap/CardDetailPanel.tsx
- dive/src/hooks/useWorkmap.ts
- dive/src-tauri/src/agent/mod.rs
- dive/src-tauri/src/agent/permission.rs
- dive/src-tauri/src/dive/gate.rs

Do not modify app source code.
Do not modify DIVE_SPEC.md.
Do not modify RALPH_PROMPT.md yet.

Create or update only:
- docs/internal/DIVE_PRODUCT_REFACTOR_PREFLIGHT.md

The report must include:
1. Current architecture summary.
2. SoT conflicts that will block the refactor.
3. Files that need to be changed before Ralph can run safely.
4. Recommended Phase 8 task list.
5. Verification commands for each task type.
6. A clear GO / NO-GO recommendation.

Important product direction:
- Convert DIVE from an education/research-facing D/I/V/E workflow app into a general beginner-friendly desktop UI for controlling a local coding agent.
- The terminal/agent backend may still run local tools, but the beginner interacts through the desktop UI.
- Keep Rust backend foundations unless a specific task requires small policy changes.
- Hide teacher/research/student surfaces from product UI.
- Replace card-first UX with chat → Deep Interview → Plan Review → Roadmap → Step-by-step execution.
- Keep D/I/V/E as internal state only; do not expose it as primary product language.

Stop after writing the audit report.
```

---

## 4. SoT Alignment `/goal` 프롬프트

Preflight 결과를 확인한 뒤, 사용자가 SoT 정렬을 승인할 때 사용한다.

```text
/goal Align DIVE-2 internal SoT documents for the Product UX Refactor.

You are working in the DIVE-2 repository.

This is a documentation/coordination task only. Do not modify application source code in this goal.

Allowed files to modify:
- docs/internal/DIVE_PRODUCT_REFACTOR_PLAN.md
- docs/internal/DIVE_PROGRESS.md
- docs/internal/DIVE_DECISIONS.md
- docs/internal/DIVE_NEXT.md
- docs/internal/RALPH_PROMPT.md

Do not modify DIVE_SPEC.md unless it already contains a user-approved section for the Product UX Refactor. If DIVE_SPEC.md must change, stop and mark BLOCKED in DIVE_NEXT.md with the exact required user decision.

Goal:
Prepare Ralph to implement a new Phase 8 called “Product UX Refactor: beginner-friendly desktop coding agent”.

Required changes:

1. Create `docs/internal/DIVE_PRODUCT_REFACTOR_PLAN.md` if it does not exist.
   It must summarize:
   - Product pivot.
   - New UX flow: project open → natural language goal → Deep Interview → Plan Review → Roadmap → step execution → patch preview → verify → recovery/undo.
   - Internal vs visible terminology.
   - PR sequence 8-1 through 8-10.
   - Acceptance checks.

2. Append a new ADR to `DIVE_DECISIONS.md`.
   Title:
   `ADR-077: Product UX Refactor pivots DIVE from D/I/V/E education surface to beginner desktop agent surface`

   The ADR must state:
   - D/I/V/E remains internal model/state-machine vocabulary.
   - Public UI uses product terms: Plan, Roadmap, Step, Changes, Run Check, Undo.
   - Roadmap may be a right-side always-visible panel despite old workmap-strip decision.
   - Research/teacher/student surfaces are moved out of product routes.
   - Rust agent loop, permission hook, checkpoint, provider runtime should be preserved as infrastructure.

3. Update `docs/internal/RALPH_PROMPT.md`.
   Replace old immutable UI decisions that conflict with Product UX Refactor.
   In particular, remove or supersede:
   - “워크맵은 화면 하단 가로 띠 (좌측·중앙 세로 패널 X)”

   Replace with:
   - “Product UX Refactor Phase에서는 로드맵을 초심자의 현재 위치 인식을 위해 우측 패널 또는 항상 보이는 주요 영역으로 승격할 수 있다.”
   - “D/I/V/E 용어는 내부 상태명으로 유지하되 product UI의 주 언어로 노출하지 않는다.”
   - “교사용·연구용·학생용 surface는 product route에서 숨기거나 internal/dev route로 격리한다.”
   - “백엔드 gate는 유지하되 사용자가 보는 흐름은 chat → interview → plan → roadmap → step execution이다.”

4. Add Phase 8 to `DIVE_PROGRESS.md`.
   Use this checklist:
   - [ ] 8-0 SoT alignment + product refactor preflight
   - [ ] 8-1 Product surface cleanup
   - [ ] 8-2 Split MainShell into product shell components
   - [ ] 8-3 Add Roadmap adapter over Workmap/Card model
   - [ ] 8-4 Replace bottom WorkmapStrip surface with beginner RoadmapPanel
   - [ ] 8-5 Add Deep Interview → Plan Review flow
   - [ ] 8-6 Add Plan-first agent run mode / permission profile
   - [ ] 8-7 Redesign execution UI: tool approval, command explainer, patch preview
   - [ ] 8-8 Add Recovery/Undo center around existing checkpoints
   - [ ] 8-9 Simplify Settings into AI Connection / App / Safety / Advanced
   - [ ] 8-10 Product copy polish, onboarding, docs, release checklist

5. Rewrite `DIVE_NEXT.md` to mark 8-0 as current task.
   If all required documentation alignment is complete, mark 8-0 done and set 8-1 as next.

6. Verify:
   - No app source files changed.
   - SoT files are internally consistent.
   - No instruction still forbids the new right-side/always-visible roadmap.

Commit using:
`docs(sot): align ralph for product ux refactor phase 8`
```

---

## 5. Ralph 실행용 새 `DIVE_NEXT.md` Seed

SoT alignment 후 `docs/internal/DIVE_NEXT.md`에 넣을 첫 구현 작업이다.

```markdown
# DIVE_NEXT.md

상태: 진행 예정
Phase: 8
작업 번호: 8-1
제목: Product surface cleanup

## 무엇을
DIVE-2의 product-facing 표면에서 교사용·학생용·연구용 냄새를 제거하고, 일반 초심자가 사용하는 데스크톱 코딩 에이전트 제품처럼 보이도록 route, 문서, 설정, 문구를 정리한다.

## 왜
현재 README, Settings, App route, research-survey page, i18n 문구에는 교육/연구/파일럿/교사용 surface가 노출되어 있다. Product UX Refactor의 목표는 “혼자서 바이브 코딩을 시작하는 일반 초심자”에게 맞는 제품형 표면을 만드는 것이다.

## 어떻게 (단계)
1. `App.tsx`에서 product route와 internal/dev route를 분리한다.
2. `research-survey`는 production product route에서 숨기고 dev/internal route로 격리한다.
3. Settings에서 연구 전용 설정과 설문 진입점은 dev/internal 조건에서만 노출한다.
4. README와 dive/README의 제품 설명을 일반 초심자용 데스크톱 코딩 에이전트 관점으로 정리한다.
5. React 버전 문서 불일치가 있으면 package.json 기준으로 바로잡는다.
6. i18n의 주요 product-facing 문구에서 “학생”, “교사”, “연구”, “차시”, “게이트 ablation” 노출을 줄인다.

## 명세 참조
- docs/internal/DIVE_PRODUCT_REFACTOR_PLAN.md
- DIVE_DECISIONS.md ADR-077
- DIVE_PROGRESS.md Phase 8

## 완료 조건
- [ ] production product route에서 research-survey가 직접 노출되지 않는다.
- [ ] Settings의 연구 전용 섹션은 dev/internal 조건에서만 보인다.
- [ ] README와 dive/README가 현재 package.json/Cargo.toml과 충돌하지 않는다.
- [ ] 일반 사용자가 보는 핵심 문구가 “제품형 데스크톱 코딩 에이전트” 방향과 일치한다.
- [ ] `pnpm typecheck` 통과.
- [ ] `pnpm lint` 통과.
- [ ] 변경 사항을 conventional commit으로 커밋한다.

## 의존성
- [완료] 8-0 SoT alignment + product refactor preflight
```

---

## 6. `/goal`로 PR 하나씩 직접 수행할 때 쓰는 Master Prompt

Ralph 루프 대신 Codex `/goal`을 PR 단위로 직접 쓸 때 사용한다. `{TASK}`만 바꿔서 반복한다.

```text
/goal Complete DIVE-2 Product UX Refactor task {TASK} as one reviewable PR-sized change.

Repository: DIVE-2.

Before editing, read:
- AGENTS.md if present
- docs/internal/DIVE_PRODUCT_REFACTOR_PLAN.md
- docs/internal/DIVE_DECISIONS.md
- docs/internal/DIVE_PROGRESS.md
- docs/internal/DIVE_NEXT.md
- dive/README.md

Task:
{PASTE_THE_EXACT_TASK_FROM_DIVE_NEXT_OR_PLAN}

Hard constraints:
- Keep this change PR-sized.
- Do not start the next task.
- Preserve Rust backend infrastructure unless this task explicitly requires a small policy/mode change.
- Do not expose D/I/V/E as the main user-facing product language.
- Do not reintroduce teacher/student/research surfaces into production product routes.
- Do not replace the desktop UI with a TUI.
- The local agent/terminal work remains backend behavior; beginners interact through desktop UI.
- Do not modify DIVE_SPEC.md unless explicitly authorized.
- Avoid TypeScript `any`.
- Avoid Rust `unwrap`/`expect` outside tests.

Verification required:
- If frontend changed: run `cd dive && pnpm typecheck && pnpm lint`.
- If Rust changed: run `cd dive/src-tauri && cargo fmt --all -- --check && cargo test --features dev-mock --all-targets && cargo clippy --features dev-mock --all-targets -- -D warnings`.
- If docs only: no build is required, but check links and obvious contradictions.

Completion requirements:
1. Summarize changed files.
2. Explain why each change supports the Product UX Refactor.
3. Report verification commands and results.
4. Update DIVE_PROGRESS.md only for this task.
5. Update DIVE_NEXT.md to the next task only after this task is fully verified.
6. Add ADR only if a new architecture/product decision was necessary.
7. Commit with a conventional commit message.

Stop when this single task is done or mark BLOCKED with a precise reason.
```

---

## 7. PR별 `/goal` 프롬프트

### 8-1 Product surface cleanup

```text
/goal Complete task 8-1 Product surface cleanup in DIVE-2.

Goal:
Remove or hide education/research/teacher/student surfaces from the production product UI so DIVE looks like a beginner-friendly desktop coding agent for general users.

Scope:
- App route cleanup.
- Settings research section gating.
- README/dive README wording and version consistency.
- i18n product copy cleanup.

Do not restructure MainShell yet.
Do not change backend behavior.
Do not delete research code if it may still be needed internally; hide it from product routes or dev/internal-gate it.

Acceptance:
- Production route does not expose research-survey directly.
- Settings research controls are dev/internal only.
- README and dive/README match current package/Cargo metadata.
- Product-facing copy avoids teacher/student/research phrasing unless in internal docs.
- `cd dive && pnpm typecheck && pnpm lint` pass.
```

### 8-2 Split MainShell

```text
/goal Complete task 8-2 Split MainShell into product shell components.

Goal:
Refactor `dive/src/components/shell/MainShell.tsx` from one overloaded orchestrator into a thin product shell composed of smaller components/hooks.

Scope:
- Introduce `components/product/` or equivalent.
- Extract TopBar, ProjectRail, ConversationPanel, RoadmapHost/placeholder, ActionDock, ModalHost as appropriate.
- Preserve current behavior.
- Do not redesign the full UX yet; this task is structural.

Constraints:
- Keep existing stores/hooks working.
- No backend changes unless compile requires trivial type alignment.
- Avoid large visual redesign in this PR.
- Do not remove existing functionality.

Acceptance:
- MainShell becomes a thin wrapper or clearly smaller coordinator.
- Modal state is moved into a dedicated hook/component where practical.
- `cd dive && pnpm typecheck && pnpm lint` pass.
```

### 8-3 Roadmap adapter

```text
/goal Complete task 8-3 Add Roadmap adapter over existing Workmap/Card model.

Goal:
Keep the existing backend card/workmap model, but expose a product-facing Roadmap/Step model to the UI.

Scope:
- Add `features/roadmap` or equivalent.
- Create `useRoadmap(sessionId)` adapter over `useWorkmap(sessionId)`.
- Map internal states:
  decomposed → planned
  instructed → ready / working
  verifying → checking
  verified → done
  rejected → needs_changes
  extended → integrated
- Do not rewrite DB schema.
- Do not rewrite Rust gate engine in this task.

Acceptance:
- UI components can consume `steps`, `activeStepId`, `progress`, `selectStep`, and basic step actions without knowing CardState names.
- Existing workmap behavior still works.
- `cd dive && pnpm typecheck && pnpm lint` pass.
```

### 8-4 RoadmapPanel layout

```text
/goal Complete task 8-4 Replace bottom WorkmapStrip surface with beginner RoadmapPanel.

Goal:
Move the primary progress visualization from a bottom workmap strip to an always-visible roadmap area suitable for beginner desktop UI.

Scope:
- Introduce `RoadmapPanel` using the Roadmap adapter.
- Product UI should show current step, progress, remaining steps, and next action.
- Old WorkmapStrip may remain available behind dev/internal/demo if needed, but product shell should prefer RoadmapPanel.
- Use product language: Roadmap, Step, Done, Needs changes, Checking.
- Avoid D/I/V/E as primary visible labels.

Acceptance:
- Beginner can see where they are without opening a modal or expanding a bottom strip.
- Current step is visually obvious.
- Empty state invites the user to describe what they want to build, not manually create cards first.
- `cd dive && pnpm typecheck && pnpm lint` pass.
```

### 8-5 Deep Interview → Plan Review

```text
/goal Complete task 8-5 Add Deep Interview to Plan Review flow.

Goal:
Replace the card-first AI Assist experience with a beginner-friendly planning conversation: natural language goal → short interview → plan draft → user approval → roadmap steps.

Scope:
- Add ProjectBrief and PlanDraft frontend types.
- Add PlanInterviewPanel and PlanReviewPanel.
- Reuse existing `ai_assist_cards` or card_create flow where practical.
- Plan acceptance should create underlying cards/steps.
- One interview turn should ask at most 3 questions.
- Provide choices and “not sure” options.

Do not implement full autonomous planner backend if too large; a frontend orchestration using existing IPC is acceptable for this task, but keep types clean for later backend support.

Acceptance:
- User can start from “I want to build X” without manually creating a card.
- Plan review shows goal, MVP, non-goals, steps, success criteria.
- Accepting a plan creates roadmap steps.
- Cancelling leaves files unchanged.
- `cd dive && pnpm typecheck && pnpm lint` pass.
```

### 8-6 Plan-first permission profile

```text
/goal Complete task 8-6 Add Plan-first agent run mode / permission profile.

Goal:
Enforce at the application/backend level that file modification and command execution do not happen before the user accepts a plan.

Scope:
- Add or prepare an AgentRunMode / permission profile concept if appropriate.
- Modes should distinguish Interview/Plan/Build/Verify or equivalent.
- Plan/Interview must deny edit/write/delete/bash/run_process unless explicitly allowed by accepted plan state.
- Build can request approval for edit/write/run tools.
- Use existing PermissionHook and AutoApprovePolicy architecture where possible.

Constraints:
- Do not rewrite AgentLoop wholesale.
- Add tests for policy behavior.
- Preserve existing provider/tool functionality.

Acceptance:
- There is a backend-enforced path preventing mutating tools before plan acceptance.
- Tests cover at least one allowed safe read and one denied mutating action in plan mode.
- Frontend can display “No files changed yet” during planning.
- Rust verification passes:
  `cd dive/src-tauri && cargo fmt --all -- --check && cargo test --features dev-mock --all-targets && cargo clippy --features dev-mock --all-targets -- -D warnings`
- Frontend verification passes if touched:
  `cd dive && pnpm typecheck && pnpm lint`
```

### 8-7 Beginner execution UI

```text
/goal Complete task 8-7 Redesign execution UI for beginners.

Goal:
Make tool approvals, command execution, and patch previews understandable to non-developer beginners using the desktop UI.

Scope:
- Redesign ToolApprovalCard / permission card copy.
- Add CommandExplainer UI for run_process/bash commands.
- Add PatchPreviewPanel or improve existing diff preview UI.
- Raw logs should be collapsed by default with “show details”.
- Explain: what will happen, which files/commands are involved, risk level, and available choices.

Constraints:
- Do not remove safety approval behavior.
- Do not auto-approve mutating tools.
- Keep advanced/raw details accessible.

Acceptance:
- User sees plain-language explanation before file edits or commands.
- Diff/patch preview is available before accepting file changes when possible.
- Command execution cards explain whether files change and what failure means.
- `cd dive && pnpm typecheck && pnpm lint` pass.
```

### 8-8 Recovery/Undo center

```text
/goal Complete task 8-8 Add Recovery/Undo center using existing checkpoint infrastructure.

Goal:
Make failure recovery and undo visible as a primary product feature, not a hidden technical feature.

Scope:
- Add RecoveryPanel / UndoCenter UI.
- Use existing checkpoint_create/checkpoint_list/checkpoint_restore IPC where possible.
- Surface “last change”, “undo available”, and failed-step recovery actions.
- On failed verification/tool error, show next choices: explain error, retry, adjust plan, undo.

Constraints:
- Do not redesign checkpoint backend unless necessary.
- Avoid destructive restore without confirmation.

Acceptance:
- User can find undo/recovery from main product UI.
- Failed step shows clear next actions.
- Checkpoint list/restore path works or gracefully reports unavailable state.
- `cd dive && pnpm typecheck && pnpm lint` pass.
- Rust tests pass if backend touched.
```

### 8-9 Settings simplification

```text
/goal Complete task 8-9 Simplify Settings into product-friendly sections.

Goal:
Make Settings understandable for general beginner users.

Scope:
- Reorganize settings into sections:
  1. AI Connection
  2. App Settings
  3. Safety
  4. Advanced
- Move MCP and auto-approve policy under Advanced.
- Rename provider wording to “AI connection” in product-facing copy.
- Keep existing functionality.

Acceptance:
- Beginner sees AI connection first.
- Safety settings use plain language.
- Advanced features are still accessible but not dominant.
- Research settings remain internal/dev only.
- `cd dive && pnpm typecheck && pnpm lint` pass.
```

### 8-10 Product copy polish + docs

```text
/goal Complete task 8-10 Product copy polish, onboarding, and release checklist.

Goal:
Finish the Product UX Refactor by polishing visible copy, onboarding, docs, and verification checklist.

Scope:
- First-run onboarding language.
- Main empty states.
- README product screenshots checklist text if applicable.
- Update internal progress docs.
- Add final QA checklist for product refactor.

Acceptance:
- First-time user flow reads as: choose project → connect AI → describe goal → plan → roadmap → step execution.
- No production-facing copy uses teacher/student/research language unless explicitly inside internal docs.
- Documentation clearly distinguishes product features from internal research tooling.
- `cd dive && pnpm typecheck && pnpm lint && pnpm build` pass.
- Rust all-targets tests/clippy pass if backend changed.
```

---

## 8. Ralph 루프용 대체 `RALPH_PROMPT` 핵심 패치

기존 파일 전체를 갈아엎기보다, “변경 불가 결정” 블록만 Phase 8 호환으로 바꾸는 것을 권장한다.

### 기존 블록 대체안

```markdown
### Product UX Refactor Phase 8 변경 불가 결정

- DIVE는 product surface에서 일반 초심자용 데스크톱 코딩 에이전트로 보인다.
- 사용자는 터미널/TUI가 아니라 데스크톱 앱 UI로 상호작용한다.
- 로컬 터미널·파일·명령 작업은 Rust agent backend가 수행한다.
- 사용자의 첫 행동은 카드 생성이 아니라 “만들고 싶은 것 말하기”다.
- 기본 흐름은 chat → Deep Interview → Plan Review → Roadmap → Step Execution → Patch Preview → Verify → Recovery/Undo다.
- D/I/V/E, Card, Gate는 내부 상태·DB·백엔드 모델로 유지할 수 있으나 product UI의 주 언어로 노출하지 않는다.
- Product UI 용어는 Plan, Roadmap, Step, Changes, Run Check, Undo, Recovery를 우선한다.
- 로드맵은 초심자 현재 위치 인식을 위해 우측 패널 또는 항상 보이는 주요 영역으로 승격할 수 있다.
- 교사용·학생용·연구용·설문·ablation 기능은 product route에서 숨기고 internal/dev route로 격리한다.
- Rust AgentLoop, ProviderRuntime, PermissionHook, Checkpoint, DB, IPC 기반은 가능한 보존한다.
- 계획 승인 전 mutating tools(edit/write/delete/run command)는 backend permission profile로 차단한다.
- TypeScript any 금지. Rust unwrap/expect는 테스트 외 금지.
```

---

## 9. Ralph가 막혔을 때 넣을 BLOCKED 해결 프롬프트

```text
/goal Resolve the current DIVE-2 Ralph BLOCKED state safely.

Read:
- docs/internal/DIVE_NEXT.md
- docs/internal/DIVE_PROGRESS.md
- docs/internal/DIVE_DECISIONS.md
- docs/internal/DIVE_PRODUCT_REFACTOR_PLAN.md
- docs/internal/RALPH_PROMPT.md

Goal:
Analyze the BLOCKED reason and produce a minimal user decision request or a safe fix.

Rules:
- If the block is caused by conflicting SoT documents, do not modify app source code.
- If the block requires a product decision, update DIVE_NEXT.md with a precise question and stop.
- If the block is a simple verification failure, fix only the current task scope and rerun the relevant checks.
- Do not skip to the next task.
- Do not mark DONE unless verification passed.

Output:
- What was blocked.
- Root cause.
- Files changed.
- Verification result.
- Whether Ralph can resume.
```

---

## 10. Review 전용 `/goal` 프롬프트

각 PR 완료 후 별도 Codex/Claude/OpenCode 세션에 맡길 리뷰 프롬프트다.

```text
/goal Review the latest DIVE-2 Product UX Refactor changes for correctness and scope control.

Review only. Do not edit files unless explicitly asked after the review.

Read:
- docs/internal/DIVE_PRODUCT_REFACTOR_PLAN.md
- docs/internal/DIVE_NEXT.md
- docs/internal/DIVE_PROGRESS.md
- git diff against main

Check:
1. Does the change stay within the current task scope?
2. Does it preserve existing backend behavior unless required?
3. Does it avoid exposing D/I/V/E as product-facing primary language?
4. Does it avoid teacher/student/research surface in production UI?
5. Are mutating agent actions still gated by permission/profile logic?
6. Are TypeScript and Rust style constraints followed?
7. Are tests/verification adequate?
8. Does this create hidden regressions in onboarding, provider setup, chat, workmap/card persistence, permission cards, or checkpoints?

Output:
- Verdict: approve / request changes / block.
- Top 5 risks.
- Required fixes.
- Optional improvements.
- Suggested test commands.
```

---

## 11. 운영자 체크리스트

Ralph 또는 `/goal`을 돌리기 전:

- [ ] 새 branch에서 시작했다.
- [ ] 기존 `RALPH_PROMPT.md`의 하단 워크맵 불변 조건을 Phase 8용으로 갱신했다.
- [ ] `DIVE_PRODUCT_REFACTOR_PLAN.md`가 있다.
- [ ] `DIVE_DECISIONS.md`에 Product UX Refactor ADR이 있다.
- [ ] `DIVE_PROGRESS.md`에 Phase 8 작업 목록이 있다.
- [ ] `DIVE_NEXT.md`가 정확히 하나의 작업만 가리킨다.
- [ ] 에이전트에게 “다음 작업까지 하지 말라”고 명시했다.
- [ ] 작업 후 반드시 `pnpm typecheck`, `pnpm lint`, 필요한 Rust 검증을 요구했다.
- [ ] 각 PR 후 별도 review goal을 돌린다.

---

## 12. 추천 운영 결론

가장 안전한 방식은 다음이다.

```text
1. /goal preflight audit
2. /goal SoT alignment
3. 사용자 수동 검토
4. Ralph loop로 8-1 한 작업 수행
5. review goal
6. merge or fix
7. 다음 작업으로 반복
```

전체 Phase 8을 한 번의 `/goal`로 맡기지 말 것. UI/UX 리팩토링은 scope creep이 크므로, PR 단위 goal 또는 Ralph의 `DIVE_NEXT.md` 단일 작업 루프가 더 안전하다.
