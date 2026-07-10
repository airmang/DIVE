# DIVE 제품 출시 준비 Stage 감사

- 작성일: 2026-05-30 KST
- 브랜치: `codex/dive-product-readiness-stage`
- 검토 기준 HEAD: `a289ca8 feat: harden audit and product quality flows`
- 원격 상태: 현재 로컬 `main`/브랜치는 `origin/main`(`4bbeec1`)보다 커밋 1개 앞서 있음
- 요청 범위: 실제 초심자가 DIVE로 바이브 코딩을 할 수 있을 정도의 제품화/출시 잔여 작업 정리
- 명시 제외: Windows 코드 서명, EV 인증서, Azure Trusted Signing, SmartScreen 신뢰 제거

## 결론

DIVE는 아직 무감독 초심자에게 "출시 가능"이라고 보기 어렵다.

다만 기반은 많이 올라와 있다. 현재 코드에는 disk DB, provider runtime hydration, plan-first interview/roadmap, tool permission, filesystem guard hardening, checkpoints, provider health check, tracing log, release gate script가 있다. 남은 문제는 "백엔드가 없어서 못 쓰는 상태"라기보다, **초심자 첫 사용 경로가 진짜로 끝까지 통하고, UI가 거짓 신호를 주지 않으며, 그 경로가 증거로 검증되어야 하는 상태**다.

최소 출시 품질 기준은 아래로 잡는 것이 맞다.

1. 깨끗한 프로필의 초심자가 프로젝트 열기/생성 -> AI 연결 -> 목표 입력 -> 인터뷰 -> 계획 승인 -> 로드맵 Step 실행 -> 변경 승인 -> 미리보기/검증 -> 복구/되돌리기 -> 재시작 후 이어가기를 완료한다.
2. 런타임이 실제 AI 호출을 할 수 없는 상태에서는 UI가 AI/모델 연결 완료처럼 보이지 않는다.
3. 권한 승인, 오류, 미리보기, 복구, 문서가 workmap/card/D/I/V/E를 몰라도 이해된다.
4. 위 흐름이 automated product-flow verifier와 최소 1회 connected-provider smoke evidence로 증명된다.

## 확인한 근거

제품/릴리스 문서:

- `README.md`
- `dive/README.md`
- `DIVE_SPEC.md`
- `DIVE_PLAN.md`
- `CHANGELOG.md`
- `docs/internal/DIVE_NEXT.md`
- `docs/internal/DIVE_NEXT_PHASE10_PLAN.md`
- `docs/internal/DIVE_PROGRESS.md`
- `docs/internal/DIVE_PRODUCT_REFACTOR_QA.md`
- `docs/release-gate-2026-05.md`
- `docs/packaging-windows.md`

제품 UI/프론트:

- `dive/src/App.tsx`
- `dive/src/components/product/useProductShellController.ts`
- `dive/src/components/product/ProductShellLayout.tsx`
- `dive/src/components/product/RoadmapRail.tsx`
- `dive/src/components/product/SocraticInterviewPanel.tsx`
- `dive/src/components/product/PlanDraftApprovalScreen.tsx`
- `dive/src/components/product/PlanDraftRecoveryScreen.tsx`
- `dive/src/components/shell/ChatArea.tsx`
- `dive/src/components/shell/Sidebar.tsx`
- `dive/src/components/onboarding/OnboardingDialog.tsx`
- `dive/src/components/onboarding/NewProjectDialog.tsx`
- `dive/src/components/settings/ProviderModelSelector.tsx`
- `dive/src/pages/settings.tsx`
- `dive/src/components/permission-card/*`
- `dive/src/components/slide-in/*`

에이전트/백엔드:

- `dive/src-tauri/src/agent/mod.rs`
- `dive/src-tauri/src/agent/permission.rs`
- `dive/src-tauri/src/dive/gate.rs`
- `dive/src-tauri/src/dive/plan_router.rs`
- `dive/src-tauri/src/ipc/mod.rs`
- `dive/src-tauri/src/ipc/provider.rs`
- `dive/src-tauri/src/ipc/provider_runtime.rs`
- `dive/src-tauri/src/ipc/workspace_plan.rs`
- `dive/src-tauri/src/providers/factory.rs`
- `dive/src-tauri/src/tools/registry.rs`
- `dive/src-tauri/src/tools/guard.rs`

공개 사용자 문서 drift 샘플:

- `docs/student-quickstart.md`
- `docs/user-guide/tutorial.md`
- `docs/user-guide/troubleshooting.md`
- `docs/user-guide/faq.md`
- `docs/pilot-checklist.md`
- `docs/pilot-benchmarks.md`

Wily Server 상태:

- `list_projects` 결과에는 `wily-plugin`, `hwpx`, `mac2win`만 보인다.
- 현재 보이는 Wily Server 프로젝트 목록에는 DIVE/DIVE-2 프로젝트가 없다.
- `design_stage(project_id="dive-2")` 시도는 서버에서 `422 Unprocessable Entity`로 거부되었다.

## 현재 강점

- 프로덕션 mock/demo 노출은 많이 줄었다. `?route=prompt-helper`와 Settings mock provider는 dev-gate되어 있고 `verify:production-wire`가 확인한다.
- Plan-first 구조는 실제로 구현되어 있다. interview, JSON plan draft decode, plan approval, dependency-aware roadmap, step-session/card mapping, route-chat add-step, roadmap activity가 있다.
- 에이전트 권한 모델의 기반은 괜찮다. `Interview`/`Plan` 모드는 mutation을 막고, `Build`는 approved plan + active step 없이는 mutating tool을 막는다. danger tool은 policy auto-approve 대상이 아니다.
- tool safety가 강화되어 있다. built-in registry에서 freeform `bash`는 빠져 있고 `run_process`가 남아 있으며, destructive command/path guard와 filesystem containment 테스트가 있다.
- release hardening도 있다. provider timeout, tracing file log, panic hook, migration rollback docs, version sync, production-wire, v4 verification script가 존재한다.

## 핵심 잔여 리스크

### P0. Provider truth와 first-run 상태가 초심자를 속일 수 있음

최신 QA에는 local-file secret/backend에 실제 key가 없는 상황에서 Settings가 `opencode zen` / `Big Pickle`을 active처럼 보였고, 런타임 호출은 `provider not configured`로 실패한 기록이 있다. Sidebar도 `providers.find((p) => p.is_connected)` 기반으로 provider/model label을 만든다.

출시 차단 이유:

- 초심자는 "DB에 provider row가 있음"과 "실제 AI 호출 가능"을 구분하지 못한다.
- 첫 목표 입력이 실패하기 전까지 UI가 준비 완료처럼 보일 수 있다.
- provider-not-configured 이후 retry/error/interview 상태가 중복되거나 오해를 만든다.

주요 파일/근거:

- `docs/internal/DIVE_PRODUCT_REFACTOR_QA.md` section 26
- `dive/src/stores/project-session.ts`
- `dive/src/components/shell/Sidebar.tsx`
- `dive/src/pages/settings.tsx`
- `dive/src-tauri/src/ipc/provider.rs`
- `dive/src-tauri/src/ipc/provider_runtime.rs`

완료 기준:

- Settings, Sidebar, TopBar, chat composer가 하나의 "runtime-ready AI connection" 상태를 공유한다.
- keyring/local-file secret이 없으면 현재 모델을 usable하게 보여주지 않고 재연결 CTA를 보여준다.
- `provider not configured` retry가 duplicate error stack이나 misleading interview state를 만들지 않는다.
- configured-without-secret, bad key, disconnected provider, restart hydration 테스트가 있다.

### P0. 초심자 golden path가 아직 end-to-end로 증명되지 않음

typecheck/lint/build/Rust tests는 많지만, Phase 8/10 문서가 요구한 full product-flow verifier가 없다. 필요한 범위는 project open -> natural-language goal -> interview -> plan review -> roadmap -> step execution -> patch preview -> verify -> recovery/undo다. `dive/scripts/`에는 targeted verifier는 많지만 `verify-product-refactor.mjs` / `verify-product-flow.mjs`에 해당하는 스크립트가 없다.

최신 QA도 현재 sweep에서는 provider key가 없어 fresh live connected-provider generation을 다시 실행하지 못했다고 기록한다.

출시 차단 이유:

- 개별 테스트 green은 초심자가 실제 앱 하나를 만들 수 있음을 증명하지 않는다.
- agent, roadmap, provider, preview, recovery는 같이 통과해야 제품 경로다.

완료 기준:

- controlled Tauri IPC 또는 QA app-data 기반 product-flow verifier를 추가한다.
- current build 기준 connected-provider smoke evidence를 최소 1개 남긴다.
- plan approval, roadmap, permission card, changed files, preview, recovery, restart evidence를 캡처한다.

### P0. 공개 사용자 문서가 아직 old card/workmap 제품을 가르침

public/user 문서 중 일부가 여전히 D/I/V/E, workmap, card, provider 용어를 primary flow로 설명한다.

예:

- `docs/student-quickstart.md`: "카드 없으면 채팅이 안 됩니다"와 D 단계 카드 만들기 중심.
- `docs/user-guide/tutorial.md`: 하단 workmap과 card detail panel 기반 튜토리얼.
- `docs/user-guide/troubleshooting.md`: "먼저 워크맵에 카드를 추가하세요" 해결책.
- `docs/user-guide/faq.md`: workmap shortcut/provider 용어.

출시 차단 이유:

- 초심자는 막히면 문서를 본다.
- 문서가 현재 UI와 다르면 제품이 불안정하다고 느낀다.
- Opus/Ralph 같은 다음 에이전트도 outdated docs를 product truth로 오해할 수 있다.

완료 기준:

- quickstart/tutorial/troubleshooting/FAQ/pilot checklist를 current plan-first flow로 재작성한다.
- legacy classroom/card/workmap 자료는 internal/research/legacy로 옮기거나 historical로 표시한다.
- 개발/API 문서 외에는 "provider"보다 "AI connection / AI assistant" 언어를 쓴다.
- 오래된 GitHub URL과 release URL을 정리한다.

### P0. Wily Stage/SoT coordination 대상이 아직 불명확함

현재 로컬 브랜치는 `origin/main`보다 1커밋 앞서 있고, Wily Server에는 DIVE/DIVE-2 프로젝트가 보이지 않는다. `design_stage`도 `project_id="dive-2"`에서 `422 Unprocessable Entity`로 거부됐다. 그래서 이 감사에서 authoritative Wily Stage에 남은 작업을 붙이는 것은 아직 완료하지 못했다.

또한 `docs/internal/DIVE_NEXT_PHASE10_PLAN.md`는 `G10-C4`를 "local close-out 완료, branch clean/commit/merge 사용자 승인 대기"로 남겨두고 있는데, 현재 로컬 Git은 이미 `a289ca8`까지 진행되어 있다. 문서 SoT와 Git state를 맞출 필요가 있다.

완료 기준:

- Wily Server에 DIVE/DIVE-2 프로젝트가 등록되거나 보이도록 한다.
- local branch/main/origin 상태와 Phase 10 문서를 맞춘다.
- 아래 Stage backlog는 대상 Wily project가 확정된 뒤 draft/approved Stage로 등록한다.

### P1. Agent approval UX가 아직 초심자/Korean product 기준에 못 미침

safety model은 좋지만 권한 카드의 핵심 문구가 영어 hard-code로 남아 있다.

예:

- `SafeCard`: "Quick safety check", "Deny", "Allow read"
- `WarnCard`: "Review before DIVE changes anything", "Edit request", "Allow this change"
- `DangerCard`: "High-risk approval required", "Allow high-risk action"
- `PermissionSummary`: "Files or folders involved", "Your choices"
- `PatchPreviewPanel`, `explain.ts`: 영어 설명 다수

왜 중요한가:

- 권한 카드는 초심자가 agent를 믿을지 말지 결정하는 가장 중요한 순간이다.
- 한국어 product path에서 safety-critical copy가 영어로 섞이면 품질 신뢰가 떨어진다.

완료 기준:

- 한국어 출시 빌드의 permission/safety-critical copy는 자연스러운 한국어다.
- 각 승인 카드가 "무슨 일이 일어나는지, 어떤 파일/명령이 관련되는지, 위험은 무엇인지, 거부하면 어떻게 되는지, 다시 시도는 어떻게 하는지"를 설명한다.
- approve/deny/edit의 keyboard/screen-reader behavior가 확인된다.

### P1. Accessibility와 hidden panel 동작이 아직 불안함

확인된 우려:

- `ProductShellLayout`의 lazy component가 `Suspense fallback={null}`을 사용해 로딩 중 빈 영역이 생긴다.
- `SlideInPanel`, `StepDetailSlideIn`, `RecoverySlideIn`은 custom dialog/aside 패턴이다.
- 이전 QA에서 닫힌 패널이 accessibility tree에 보인 기록이 있다.
- `StepDetailSlideIn`은 overlay처럼 보이지만 `aria-modal="false"`이고, `RecoverySlideIn`은 `aria-modal="true"`지만 custom focus handling이다.

완료 기준:

- 닫힌 panel/dialog는 accessibility tree에서 빠지거나 inert 처리된다.
- 열릴 때 focus trap/focus restore/Escape close가 동작한다.
- blank fallback 대신 보이는 loading state가 있다.
- keyboard-only로 project/session/settings/chat/roadmap/approval/recovery를 통과한다.

### P1. Preview panel의 기본 URL UX가 혼란스러움

`PreviewTab`은 `http://localhost:5173`을 placeholder로 보여주지만, 값을 입력하지 않고 `열기`를 누르면 `URL을 입력하세요.`가 뜬다. 최신 QA도 이를 UX fail로 기록했다.

완료 기준:

- placeholder가 active default URL처럼 보이지 않는다.
- 감지 가능한 dev server가 있으면 prefill하거나, 명시 입력이 필요하면 copy를 더 분명히 한다.
- preview empty state가 "dev server가 필요한 경우 / DIVE가 감지하지 못한 경우"를 설명한다.

### P1. IPC 오류가 user-message envelope 없이 raw string으로 노출될 수 있음

많은 IPC command가 `Result<_, String>`을 반환한다. raw DB/provider/HTTP detail이 UI에 그대로 나올 수 있고, 이미 Phase 10 quality item으로 남아 있다.

완료 기준:

- IPC boundary가 `code`, `user_message`, optional diagnostic detail을 갖는 구조화된 error를 반환한다.
- UI 기본 표시는 beginner-readable message만 보여준다.
- 로그에는 support에 필요한 detail이 남되 secret은 남기지 않는다.

### P1. 출시 evidence에는 signing과 별개의 installed-app smoke가 남음

사용자 요청대로 Windows signing은 제외한다. 하지만 installed-app smoke는 signing과 다른 문제이며, Windows를 target release platform으로 삼는다면 출시 evidence로 남겨야 한다.

release gate에 남길 것:

- Windows x64 installed-app smoke
- Windows ARM64 installed-app smoke 또는 명시적 blocker/deferral
- GitHub Release artifact authority와 release-owner publish decision

이번 감사에서 제외할 것:

- EV signing
- Azure Trusted Signing
- SmartScreen trust work

### P2. Maintenance quality carry-over

감독 파일럿은 막지 않지만 GA 품질로는 추적해야 한다.

- checkpoint git retention/gc
- Mermaid/code splitting과 bundle size
- MCP IPC가 남는다면 stdio child process cleanup
- plan router hook/panel 추가 테스트
- 한국어 외 출시를 한다면 full English i18n

## 추천 Stage Backlog

하나의 Wily Stage로 묶고 내부 Phase로 쪼개는 방식을 추천한다. 팀이 더 작은 단위를 원하면 아래 Phase별로 별도 Stage를 만들면 된다.

### Stage: DIVE v1 Beginner GA Readiness

목적:

초심자가 internal D/I/V/E, card, workmap, provider runtime, release engineering을 몰라도 DIVE를 로컬 코딩 에이전트 앱으로 쓸 수 있게 만든다. signing/trust work는 의도적으로 제외한다.

범위:

- first-run 및 provider readiness truth
- product-flow verifier와 connected-provider smoke
- agent approval, error, preview, recovery, accessibility polish
- 공개 beginner docs 재작성
- Windows signing을 제외한 release evidence

제외:

- Windows code signing, EV cert, Azure Trusted Signing, SmartScreen trust removal
- teacher dashboard
- full MCP product surface
- macOS/Linux packaging expansion
- release scope가 바뀌지 않는 한 full English localization

제안 Phase:

1. Provider Truth And First-Run Recovery
   - Settings/sidebar/top banner/chat composer/onboarding의 provider connected/runtime-ready 상태를 통일한다.
   - missing keyring/local-file secret, bad key, restart hydration을 정직하게 처리한다.
   - `provider not configured` 이후 misleading interview state를 막는다.

2. Beginner Golden Path Verifier
   - project -> AI -> goal -> interview -> plan -> roadmap -> step -> permission -> changed files -> preview/check -> recovery -> restart를 검증하는 `verify-product-flow`를 추가한다.
   - current build에 대해 connected-provider manual evidence를 1개 만든다.
   - release gate에 넣을 수 있을 정도로 verifier를 안정화한다.

3. Agent Execution UX Polish
   - permission cards와 tool explanation을 한국어/초심자 언어로 정리한다.
   - structured IPC error를 도입한다.
   - agent/provider failure의 retry/cancel/deduplicate behavior를 정리한다.
   - route-chat add-step UX를 beginner copy로 확인한다.

4. Preview, Recovery, And Accessibility
   - preview URL placeholder/default behavior를 고친다.
   - blank lazy-load fallback을 visible loading state로 바꾼다.
   - custom dialog focus/inert behavior를 고친다.
   - golden path keyboard-only/screen-reader QA를 수행한다.

5. Public Documentation Rewrite
   - quickstart, tutorial, troubleshooting, FAQ, pilot checklist를 current plan-first product로 재작성한다.
   - legacy classroom/card/workmap 자료는 이동하거나 historical 표시한다.
   - public docs가 product UI/README와 충돌하지 않게 한다.

6. Non-Signing Release Evidence
   - Windows signing은 제외한다.
   - Windows가 target release platform이면 installed-app smoke를 캡처하거나 deliberate deferral을 기록한다.
   - current branch push 이후 GitHub Release authority/publish evidence를 기록한다.

Stage acceptance:

- clean beginner path가 automated verifier와 connected-provider manual smoke를 통과한다.
- 실제 런타임 호출이 실패할 AI/model을 UI가 connected로 보여주지 않는다.
- 한국어 beginner build의 permission/safety-critical surface에 product name 외 영어 hard-code가 없다.
- public docs가 plan-first product flow와 일치한다.
- file-changing step 이후 recovery/undo가 보이고 동작한다.
- 닫힌 slide-in/dialog가 accessibility tree에 노출되지 않는다.
- release notes가 unsigned 상태를 설명하되 signing을 blocker로 취급하지 않는다.

## Draft Wily Payload

DIVE/DIVE-2 Wily project가 생기면 아래 payload를 Stage design input으로 쓰면 된다. 현재 서버에서는 `project_id="dive-2"`로 두 번 시도했지만 `422 Unprocessable Entity`가 반환되어 등록되지 않았다.

```json
{
  "project_id": "dive-2",
  "title": "DIVE v1 Beginner GA Readiness",
  "intent": "Make DIVE usable by true beginners for local vibe coding through a truthful first-run AI setup, proven plan-first golden path, beginner-safe agent approvals, recovery/preview polish, accessible UI behavior, and current public docs. Exclude Windows code signing and SmartScreen trust work.",
  "scope": [
    "Provider/runtime readiness truth across Settings, sidebar, top bar, onboarding, and chat composer",
    "Automated beginner product-flow verifier plus connected-provider manual smoke evidence",
    "Permission card, agent error, retry/cancel, route-chat, and IPC error UX polish",
    "Preview URL behavior, recovery/undo clarity, and slide-in/dialog accessibility fixes",
    "Public beginner docs rewrite from legacy card/workmap flow to plan-first flow",
    "Non-signing release evidence: installed-app smoke and release-owner artifact authority where applicable"
  ],
  "out_of_scope": [
    "Windows EV/code signing",
    "Azure Trusted Signing",
    "SmartScreen trust removal",
    "Teacher dashboard",
    "Full MCP product surface",
    "Full English localization unless release scope changes"
  ],
  "acceptance": [
    "A clean beginner can complete project -> AI connection -> goal -> interview -> plan approval -> roadmap step -> permission -> file change -> preview/check -> recovery -> restart.",
    "The UI never presents an AI provider/model as usable when runtime hydration or a real provider call would fail.",
    "Safety-critical permission and error surfaces are beginner-readable in Korean.",
    "The public quickstart/tutorial/troubleshooting docs match the current product flow.",
    "Closed slide-ins/dialogs are not exposed to assistive technology, and keyboard-only navigation works across the golden path.",
    "Windows signing is explicitly excluded; unsigned release messaging remains documented."
  ],
  "suggested_phases": [
    "Provider Truth And First-Run Recovery",
    "Beginner Golden Path Verifier",
    "Agent Execution UX Polish",
    "Preview, Recovery, And Accessibility",
    "Public Documentation Rewrite",
    "Non-Signing Release Evidence"
  ],
  "evidence": {
    "audit_doc": "docs/product-readiness-stage-audit-2026-05-30.md",
    "reviewed_head": "a289ca8",
    "signing_excluded": true
  }
}
```

## Opus Handoff Prompt

Opus에게는 아래 프롬프트로 독립 감사를 맡기면 된다.

```text
You are reviewing DIVE-2 for product/launch readiness. The target quality bar is: real beginners can use the app for local vibe coding without understanding D/I/V/E, cards, workmaps, provider runtime, or release engineering. Exclude Windows code signing, EV certificates, Azure Trusted Signing, and SmartScreen trust work.

Start by reading:
- docs/product-readiness-stage-audit-2026-05-30.md
- README.md
- dive/README.md
- docs/internal/DIVE_NEXT.md
- docs/internal/DIVE_NEXT_PHASE10_PLAN.md
- docs/internal/DIVE_PRODUCT_REFACTOR_QA.md
- dive/src/components/product/useProductShellController.ts
- dive/src/stores/project-session.ts
- dive/src/pages/settings.tsx
- dive/src/components/permission-card/*
- dive/src/components/slide-in/*
- dive/src-tauri/src/ipc/provider.rs
- dive/src-tauri/src/ipc/provider_runtime.rs
- dive/src-tauri/src/agent/permission.rs

Challenge the audit. Specifically verify:
1. Are provider truth/readiness issues correctly scoped?
2. Is the missing beginner golden-path verifier really the biggest launch gap?
3. Are there hidden agent/tool-safety regressions not listed?
4. Are public docs still contradicting the plan-first product path?
5. Are any proposed Stage phases too broad or missing acceptance criteria?

Return findings ordered by launch severity, then propose edits to the Stage payload.
```

---

# Opus 독립 검증 (2026-05-30)

- 검증자: Opus 4.8 (Claude Code)
- 검증 기준 HEAD: `a289ca8`
- 방법: Codex 1차 감사를 코드로 직접 검증/반박. 에이전트 활용·UI/UX 중심.
- 결론: **Codex 진단 방향은 맞음.** 근본 원인을 한 단계 좁혔고, 일부 항목은 완화/하향했다.

## 출시 준비도 종합 판정

뼈대(plan-first, 에이전트 안전, 명령 가드, 체크포인트, 런타임 정직성)는 출시 직전 수준으로 견고하다.
남은 진짜 게이트는 **"초심자가 깨끗한 PC에서 처음 켜서 앱 하나를 끝까지 만든다"는 골든 패스가 진실되게 통하고, 증거로 증명되는 것**이다.
추정 잔여량: 집중 2~3주(1인). 그중 P0-1(Provider 진실성)·P0-2(골든패스 검증기)가 출시 게이트.

## 검증 결과 (코드 근거)

### 🟢 에이전트 안전 — 견고, 숨은 회귀 없음

- 권한 모드 게이팅이 **실제로 배선됨**: `dive/src-tauri/src/ipc/mod.rs:895-929`. `effective_plan_accepted`는
  DB step context의 `plan_approved`에서 파생(하드코딩 아님), `safest_run_mode`로 backend/요청 모드 중 더
  안전한 쪽 선택. Build 모드는 승인된 plan + active step 없이는 mutation 차단(`agent/permission.rs`).
- `chat_send`는 런타임이 없으면 `snap.kind.is_none()` → `NotConfigured`로 정직하게 거부(`ipc/mod.rs:906-915`).
- 명령 가드(`tools/guard.rs`)는 `rm -rf /`, fork bomb, `curl|bash`, `sudo`, `mkfs`, 블록디바이스 dd 등
  포괄적이고 테스트 충실. 빌트인 레지스트리에 freeform `bash` 미노출 — read/list/search/write/edit/delete/run_process만
  (`tools/registry.rs:79-86`). explain.ts의 `bash` 케이스는 MCP 제공 툴 대비 방어용.

### 🔴 P0-1 Provider 진실성 — 정확한 근본 원인 (Codex보다 한 단계 좁힘)

UI가 호출하는 `provider_list` command(`ipc/provider.rs:152-159`, `lib.rs:115` 등록)는 `ConnectionCheck::ConfiguredOnly`를
사용 → 비-codex provider는 **키링 secret이 없어도 `is_connected = (auth_type=="api_key")` = true**.
secret을 실제 검증하는 `provider_list_impl`(`VerifySecrets`)은 **테스트에서만** 호출된다(`ipc/provider.rs:161-168`, 478/505/554/559).
반면 런타임 hydration(`ipc/mod.rs:357`)은 키 없으면 `continue` → `ProviderRuntime::none()`.
**결과: UI는 "연결됨 + 모델명"을 보여주는데 첫 메시지에서 `provider not configured`로 실패.**
핵심 수정: command가 `VerifySecrets`를 쓰게 하고 **command 레벨 테스트** 추가(현재 secret-검증 테스트는 wired 안 된 `_impl`만 덮는다).

### 🔴 P0-2 골든패스 검증기 부재 — 확정

`dive/scripts/`에 `verify-product-flow.mjs` / `verify-product-refactor.mjs` 둘 다 **없음**.
개별 verifier 40여 개는 green이지만 project→AI→goal→interview→plan→roadmap→step→permission→preview→recovery→restart를
한 번에 증명하는 건 없고, connected-provider smoke 증거 0개.

### 🔴 P0-3 공개 문서 drift — 심각(존재하지 않는 UI를 가르침)

`docs/student-quickstart.md`(L7-67), `docs/user-guide/tutorial.md`(L68-195)가 "카드 없으면 채팅이 안 됩니다",
"먼저 워크맵에 카드를 추가하세요", D/I/V/E 단계를 primary flow로 설명. 현재 plan-first UI와 정면 충돌.

### 🟠 P1 권한 카드 한국어 부재 — 더 정밀하게

Sidebar/StepDetailSlideIn/PreviewTab은 이미 한국어 i18n(`useT()`)인데 **권한 카드만 영어 하드코딩 섬**
("Quick safety check", "Allow high-risk action", "Review before DIVE changes anything"…).
`dive/src/components/permission-card/`에 i18n 사용 0건(키도 전무). 초심자가 에이전트를 신뢰할지 결정하는 가장 안전 중요한 순간.

### 🟠 P1 기타

- PreviewTab placeholder(`http://localhost:5173`)가 기본값처럼 보이지만 비우고 누르면 에러(`PreviewTab.tsx:41-42`).
- IPC `Result<_, String>` 158곳 — raw DB/provider 에러가 UI로 새어나갈 수 있음.

### 🟡 Codex 대비 하향/완화

- "닫힌 slide-in이 a11y 트리에 보임" 우려는 **상당 부분 해소**됨: slide-in이 `open ? … : null`로 조건부
  언마운트되고(`ProductShellLayout.tsx:97-110`) StepDetailSlideIn은 Escape+포커스 처리 있음.
  남은 건 `Suspense fallback={null}` 빈 깜빡임과 포커스 트랩 완성도 → P1보다 가벼움(Phase 4로 흡수).

## 확정 Stage 페이로드 (등록 대기)

Wily 프로젝트가 생기는 즉시 `design_stage` → `approve_stage` → `claim_stage` → `plan_stage` 순으로 제출한다.

`design_stage(payload)`:

```json
{
  "project_id": "dive-2",
  "title": "DIVE v1 Beginner GA Readiness",
  "intent": "Make DIVE usable by true beginners for local vibe coding without understanding D/I/V/E, cards, workmaps, provider runtime, or release engineering. Truthful first-run AI connection, a proven plan-first golden path, beginner-safe Korean agent approvals, recovery/preview polish, accessible slide-in behavior, and current public docs. Exclude Windows code signing and SmartScreen trust work.",
  "scope": [
    "Provider/runtime readiness truth: the wired provider_list command must verify keyring secrets (not just auth_type) so Settings/sidebar/top bar/onboarding/chat composer never show an AI model as connected when a real call would fail.",
    "Automated beginner product-flow verifier (project -> AI -> goal -> interview -> plan -> roadmap -> step -> permission -> changed files -> preview/check -> recovery -> restart) plus one connected-provider smoke evidence.",
    "Korean i18n for safety-critical permission cards (Safe/Warn/Danger/Summary/explain/PatchPreview/CommandExplainer) and structured IPC error envelope replacing raw Result<_, String>.",
    "Preview URL placeholder/empty-state fix, visible lazy-load state instead of Suspense fallback=null, and slide-in/dialog focus-trap/restore/inert verification.",
    "Public beginner docs rewrite from legacy card/workmap/D-I-V-E to plan-first flow.",
    "Non-signing release evidence: installed-app smoke and release-owner artifact authority where applicable."
  ],
  "out_of_scope": [
    "Windows EV/code signing",
    "Azure Trusted Signing",
    "SmartScreen trust removal",
    "Teacher dashboard",
    "Full MCP product surface",
    "Full English localization unless release scope changes"
  ],
  "acceptance": [
    "A clean-profile beginner completes project -> AI connection -> goal -> interview -> plan approval -> roadmap step -> permission -> file change -> preview/check -> recovery -> restart.",
    "The UI never presents an AI provider/model as usable when runtime hydration or a real provider call would fail (provider_list command verifies secrets; covered by a command-level test).",
    "Safety-critical permission and error surfaces are beginner-readable Korean with no English hard-code beyond the product name.",
    "Public quickstart/tutorial/troubleshooting/FAQ match the current plan-first product flow.",
    "Closed slide-ins/dialogs are not exposed to assistive tech and keyboard-only navigation works across the golden path.",
    "Windows signing is explicitly excluded; unsigned-release messaging stays documented."
  ],
  "evidence": {
    "audit_doc": "docs/product-readiness-stage-audit-2026-05-30.md",
    "reviewed_head": "a289ca8",
    "signing_excluded": true
  }
}
```

`plan_stage(payload)` — Phase별 수용 기준과 핵심 파일:

```json
{
  "stage_id": "S-...",
  "phases": [
    {
      "title": "Provider Truth And First-Run Recovery",
      "description": "provider_list command verifies keyring secrets (VerifySecrets) so configured-but-no-secret providers report is_connected=false. Unify the runtime-ready signal across Settings/Sidebar/TopBar/onboarding/chat composer. Handle restart hydration, bad key, and disconnected provider honestly with a reconnect CTA. Prevent duplicate error stacks or misleading interview state after 'provider not configured'. Add a command-level test (current test only covers provider_list_impl) plus restart-hydration test. Files: ipc/provider.rs:152, stores/project-session.ts, components/shell/Sidebar.tsx, pages/settings.tsx, product/ProviderSetupBanner.tsx, product/TopBar.tsx.",
      "source": "manual"
    },
    {
      "title": "Beginner Golden Path Verifier",
      "description": "Add verify-product-flow.mjs covering project -> AI -> goal -> interview -> plan approval -> roadmap -> step -> permission -> changed files -> preview/check -> recovery -> restart, via controlled Tauri IPC or DIVE_QA_APP_DATA_DIR + local-file secret backend. Capture one connected-provider smoke evidence on the current build. Wire into the release gate. Files: dive/scripts/, ipc/mod.rs:284-310 (QA env hooks).",
      "source": "manual"
    },
    {
      "title": "Agent Approval And Error UX (Korean)",
      "description": "Move permission card copy (Safe/Warn/Danger/PermissionSummary/explain/PatchPreviewPanel/CommandExplainer) to Korean i18n keys. Each card explains what happens, which files/commands are involved, the risk, what deny does, and how to retry. Introduce a structured IPC error envelope (code + user_message + optional diagnostic) at user-facing boundaries; UI shows beginner-readable Korean, logs keep detail without secrets. Verify approve/deny/edit keyboard + screen-reader behavior. Files: components/permission-card/*, i18n/ko.json + en.json, ipc/*.rs (158 Result<_, String>).",
      "source": "manual"
    },
    {
      "title": "Preview, Recovery, And Accessibility",
      "description": "Fix PreviewTab placeholder/empty-state so the default URL does not look active; prefill a detected dev server or clarify copy. Replace Suspense fallback=null with a visible loading state. Complete focus-trap/restore/Escape/inert for slide-ins and dialogs (already conditionally unmounted; finish focus trap). Run keyboard-only/screen-reader QA across the golden path. Files: slide-in/PreviewTab.tsx, product/ProductShellLayout.tsx, product/StepDetailSlideIn.tsx, product/RecoverySlideIn.tsx, slide-in/SlideInPanel.tsx.",
      "source": "manual"
    },
    {
      "title": "Public Documentation Rewrite",
      "description": "Rewrite student-quickstart, tutorial, troubleshooting, FAQ, and pilot checklist from legacy card/workmap/D-I-V-E to the plan-first flow. Move legacy classroom material to internal/legacy or mark it historical. Align public docs with README and product UI; prefer 'AI 연결/AI 도우미' over 'provider'. Files: docs/student-quickstart.md, docs/user-guide/*, docs/pilot-checklist.md.",
      "source": "manual"
    },
    {
      "title": "Non-Signing Release Evidence",
      "description": "Exclude Windows code signing explicitly. If Windows is a target platform, capture installed-app smoke for x64 and either ARM64 or a deliberate deferral. After the branch is pushed, record GitHub Release artifact authority and the release-owner publish decision. Files: docs/release-gate-2026-05.md, scripts/release-gate-smoke.mjs.",
      "source": "manual"
    }
  ]
}
```

## Wily 등록 블로커 + 런북

- **블로커**: Wily Server에 dive/dive-2 프로젝트 없음(`wily-plugin`/`hwpx`/`mac2win`만 존재).
  wily-client MCP에 `create_project` 툴이 없어 클라이언트에서 프로젝트 생성 불가.
  `design_stage(project_id="dive-2")` → `422 Unprocessable Entity`(프록시가 본문 가림, 상세 불명). 2026-05-30 Opus 재시도에서도 동일.
- **등록 순서(프로젝트 생성 후)**: ① `design_stage(payload)` ② `approve_stage(stage_id)`
  ③ `claim_stage(checkout evidence)` ④ `plan_stage(phases)` ⑤ Phase별 `start_phase`/`complete_phase`.
- **결정 대기**: 서버 측에서 dive-2(또는 dive) 프로젝트를 생성. 생성되면 위 페이로드를 그대로 제출.
