# 07. DIVE-2 Product UX Refactor — Post-Implementation Fix Plan

> 선행 문서: `00_MASTER_PLAN.md` (PR 1~10이 구현 완료된 상태에서 발견된 회귀/UX 결함을 보정하기 위한 후속 계획)

## Context

`00_MASTER_PLAN.md`의 PR 1~10이 머지된 후 사용자 검토에서 6가지 이슈가 발견됐다.

1. 메인 `ChatInput`(중앙)과 `PlanInterviewPanel`(별도 Dialog)이 입력창 자체부터 분리되어 있어, 사용자는 “두 개의 채팅창”을 쓰는 느낌을 받는다. 메인 채팅 하나에서 모든 것을 해결해야 한다.
2. 우측 `RoadmapHost`가 `ProductShellLayout`의 3-column 그리드에 항상 마운트되어, 계획이 정해지기 전부터 빈 로드맵이 노출된다. 계획 확정 후에만 보여야 한다.
3. AI 비평/`prompt_check_review` IPC가 OpenAI 호환 endpoint에서 400을 반환한다. 응답이 `{"choices":[{"message":{"role":"assistant"},"finish_reason":null}]}` 형태로 비어 들어왔을 때 `to_openai_payload`가 빈 assistant 메시지를 그대로 다음 호출에 재전송한다.
4. 한국어 빌드인데 plan draft 본문에 영문 fallback이 노출된다. `features/planning/planDraft.ts`가 `locale !== "ko"`일 때 영문 하드코딩을 채워 넣고, LLM이 영문으로 답할 때 그 문자열이 그대로 화면에 떨어진다.
5. `RecoveryPanel`이 `RoadmapPanel.tsx:186`에 박혀 있어, “복구는 로드맵의 일부”라는 잘못된 정보 구조가 만들어진다.
6. `PlanInterviewPanel`이 `PLAN_INTERVIEW_QUESTIONS`(seedQuestions 3개)를 미리 정의해두고 textarea + 선택지 버튼으로 답을 받는 정적 머신이라, 사용자에게는 “템플릿 채워넣기”로 느껴진다. AI가 매 턴 자연어로 한 가지씩 묻는 Deep Interview 흐름이 필요하다.

## 사용자 결정사항 (확정)

- **Recovery 위치**: TopBar 트리거 → 슬라이드인 패널.
- **PlanDraft 표시**: 메인 채팅 위에 떠 있는 “계획 미리보기” floating card.
- **prompt_check**: 버그만 고치고 기능 자체는 유지.
- **모드 전환**: 사용자에게는 단일 채팅, 백엔드 `AgentRunMode`가 자동 전환.

## 원칙 (master plan에서 그대로 계승)

- DB schema 변경 금지.
- `AgentLoop` 재작성 금지. system prompt + tool 정의 + 기존 `RunModePermissionHook` 재사용으로 끝낸다.
- 한 PR로 끝내지 않는다. 작은 PR 5개로 나누고 각 PR에 검증 명령을 포함한다.
- 계획 승인 전 edit/write/bash는 Rust permission layer가 차단(이미 도입됨, 재사용).
- 영어 잔존은 i18n 키와 LLM system prompt 양쪽에서 막는다.

## PR 분해와 의존성

```
A → B → E → C → D
```

A는 백엔드 격리이고 가장 작아 먼저. B는 D의 floating card가 들어갈 레이아웃 인프라이므로 D 전. E는 D가 새 카드/메시지를 그릴 때 영문 fallback이 다시 따라붙지 않도록 D 전. C는 B의 동적 컬럼 unmount 패턴을 그대로 활용.

---

### PR A — Provider 빈 응답 & prompt_check 400 픽스

**왜**: `PromptCheckEngine::review`가 단발 tool_choice 호출인데, 모델이 `finish_reason: null` + 빈 `message`로 응답할 때 (1) stream 파서가 종료를 인식 못 하고, (2) 빈 assistant 메시지가 다음 호출 messages 배열에 그대로 들어가 OpenAI 호환 서버가 400으로 거부.

**변경 파일**

- `dive/src-tauri/src/providers/openai/stream.rs:41-84` — `delta.content`가 `None`이고 `tool_calls`도 비고 `finish_reason`도 `null`인 청크를 swallow. `[DONE]` 도달 시 마지막 청크의 finish_reason이 여전히 `null`이면 `Done { finish_reason: Stop }`로 폴백 emit.
- `dive/src-tauri/src/providers/openai/mod.rs:109-114` — `Message::Assistant` 직렬화에서 `tool_calls`가 있으면 `content`가 빈 문자열일 때 `"content": null`로 직렬화(OpenAI 스펙 준수). `tool_calls`도 없고 `content`도 빈 경우는 호출자가 push 자체를 안 하도록 강제.
- `dive/src-tauri/src/agent/mod.rs:173-180` — `content.is_empty() && tool_calls.is_empty()` 인 assistant 청크는 messages 배열에 push하지 않음.
- `dive/src-tauri/src/dive/prompt_check.rs:79-96` — 응답에 `prompt_review` tool call이 없을 때 `PromptCheckError::NoToolCall`을 명확히 반환(현재는 텍스트로 흡수해 후속 호출이 깨지는 경로 차단). `tool_choice: Specific("prompt_review")` 동작 그대로 유지.

**IPC**: 변경 없음.

**Acceptance Criteria**

- 빈 finish_reason 응답을 받아도 stream이 정상 종료하고 호출자에게 에러를 명확히 전달.
- `prompt_check_review` 재호출 시 messages 배열에 빈 assistant entry가 남지 않음.
- 직렬화 스냅샷 단위 테스트가 `tool_calls` 유무에 따른 `content` 처리를 보장.

**검증**

```bash
cd dive/src-tauri
cargo fmt --all -- --check
cargo test --features dev-mock --all-targets providers::openai
cargo test --features dev-mock --all-targets dive::prompt_check
cargo clippy --features dev-mock --all-targets -- -D warnings
```

**회귀 위험**: 빈 content 직렬화 변경이 OpenAI 호환 외 서버에 부작용. 완화: `tool_calls.is_some()`일 때만 `content: null`로 분기. 직렬화 스냅샷 단위 테스트 추가.

---

### PR B — 우측 RoadmapPanel 가시성 동적 전환

**왜**: 계획 확정 전엔 빈 로드맵이 시야를 차지하고, 사용자가 채팅에 집중하지 못함. 계획 확정 시점에만 슬라이드인되어야 “현재 흐름”을 보여준다는 본래 목적에 맞다.

**변경 파일**

- `dive/src/components/product/ProductShellLayout.tsx:13-38` — `grid-cols`를 정적 `[280px_minmax(0,1fr)_360px]`에서 `roadmap.visible` 기반 동적으로(`visible`이면 3-col, 아니면 `[280px_minmax(0,1fr)]`).
- `dive/src/components/product/RoadmapHost.tsx:9` — `roadmap.visible === false`일 때 `null` 반환. 마운트 자체를 막아 빈 상태 inline goal textarea도 노출되지 않게.
- `dive/src/components/product/useProductShellController.ts` (roadmap props 빌드 부근) — `visible = planAccepted || roadmapModel.steps.length > 0` 도출. `planAccepted`는 PR D에서 store에 추가될 플래그를 미리 정의(여기서는 `roadmapModel.steps.length > 0`만으로도 동작 가능).
- 슬라이드인 트랜지션은 CSS transform/opacity로 가볍게(필수 아님).

**IPC**: 변경 없음.

**Acceptance Criteria**

- 빈 프로젝트 첫 진입 시 우측 패널 미노출, 중앙 채팅 영역이 화면 폭을 더 차지.
- 첫 step 생성 또는 `planAccepted=true` 직후 우측 패널 마운트.
- 빈 상태 inline goal textarea가 사라지고 그 자리는 채팅 영역이 차지.

**검증**

```bash
cd dive
pnpm typecheck
pnpm lint
pnpm test -- ProductShellLayout RoadmapHost
```

**회귀 위험**: 기존 e2e가 `data-testid="roadmap-panel"` 존재를 가정. 완화: e2e fixture를 plan-accepted 상태로 시드, 빈 상태 케이스에 새 testid `roadmap-host-hidden`.

---

### PR E — i18n 잔존 정리 + LLM 응답 언어 강제

**왜**: PR D가 새 floating card와 chat-driven plan 메시지를 추가하기 전에 영문 fallback과 “LLM이 영문 답하는 경로”를 차단해야 새 surface로 영문이 다시 흘러들지 않는다.

**변경 파일**

- `dive/src/features/planning/planDraft.ts:99-148` — `locale !== "ko"` 영문 하드코딩 fallback 전부 제거. 시그니처를 `formatPlanDraft(brief, t)`로 바꿔 i18n key(`planning.draft.*`)로 치환. ko/en i18n에 누락 키 추가.
- `dive/src/components/chat/ChatInput.tsx:106-160` — placeholder/aria-label/단축키 힌트의 한글 하드코딩(L106, 127, 139, 150, 160)을 `t("chat.input.*")`로.
- `dive/src-tauri/src/dive/prompt_check.rs:83` `build_system_prompt` — `현재 사용자 언어: {locale}. 모든 응답은 그 언어로 작성하라`를 시스템 프롬프트에 추가.
- 신규 `dive/src-tauri/src/dive/plan_interview.rs`에서도 동일 locale hint 적용(파일은 PR D에서 생성).
- `dive/src-tauri/src/ipc/mod.rs` `chat_send`/`prompt_check_review` — `locale: Option<String>` 파라미터 추가(additive, default `"ko"`). 프론트는 `useLocale()`에서 읽어 전달.

**IPC**: 옵셔널 필드 추가만. 하위호환 유지.

**Acceptance Criteria**

- PlanDraft 본문에서 `locale !== "ko"` 분기 호출 0건(grep 검증).
- ChatInput placeholder/aria-label이 i18n key를 통해 렌더.
- LLM 응답 언어가 사용자 locale과 어긋나는 빈도 ≤ 1/20 (수동 샘플링).

**검증**

```bash
cd dive
pnpm typecheck
pnpm lint
pnpm test -- planDraft ChatInput
cd src-tauri
cargo test --features dev-mock --all-targets ipc::chat_send dive::prompt_check
cargo clippy --features dev-mock --all-targets -- -D warnings
```

**회귀 위험**: 영문 fallback 제거로 비-ko 사용자 깨짐. 완화: en i18n 번들에 동일 키 채워넣기를 같은 PR에 포함. LLM이 가끔 영문 답할 가능성 → system prompt에 negative example 1줄 추가.

---

### PR C — Recovery TopBar 슬라이드인

**왜**: Recovery는 “로드맵의 일부”가 아니라 앱 전역 안전장치. TopBar 인디케이터에 두면 빌드 진행 중에도 한 클릭으로 접근하면서 RoadmapPanel을 가리지 않는다.

**변경 파일**

- `dive/src/components/product/RoadmapPanel.tsx:15, 186` — `RecoveryPanel` import/렌더 제거. `RoadmapPanelProps`에서 `recovery` prop 제거.
- `dive/src/components/product/useProductShellController.ts` — `recovery` prop을 별도 surface로 노출(`shell.recovery`).
- `dive/src/components/product/useProductShellDialogs.ts` — `recoveryOpen` 상태 + setter 추가.
- `dive/src/components/product/ProductShellLayout.tsx` — TopBar 영역(별도 행 또는 absolute header)에 “되돌리기 N건” 트리거 버튼 통합. 기존 `ProviderSetupBanner` 자리와 같은 행을 재사용해 layout 변경 최소화.

**신규 파일**

- `dive/src/components/product/TopBar.tsx` — 최소 헤더. 프로젝트명/AI 연결/되돌리기 트리거. ProviderSetupBanner는 이 안의 슬롯으로 흡수 가능.
- `dive/src/components/product/RecoverySlideIn.tsx` — fixed-right `<aside>` 또는 기존 `SlideInPanel` 래퍼. 내부에 기존 `RecoveryPanel`을 그대로 마운트.

**IPC**: 변경 없음.

**Acceptance Criteria**

- RoadmapPanel 안에서 RecoveryPanel을 렌더하는 경로 0건.
- TopBar 트리거 클릭 → RecoverySlideIn open → 되돌리기 가능 항목 노출.
- 로드맵이 보이지 않는 상태에서도(PR B 빈 프로젝트) Recovery 트리거 접근 가능.

**검증**

```bash
cd dive
pnpm typecheck
pnpm lint
pnpm test -- TopBar RecoverySlideIn RoadmapPanel
pnpm build
```

**회귀 위험**: 기존 RoadmapPanel 단위 테스트가 recovery 섹션 존재 가정. 완화: 해당 단언 제거 후 RecoverySlideIn 단위 테스트로 동치 검증.

---

### PR D — PlanInterview를 메인 채팅으로 통합 + Floating PlanDraft

**왜**: 입력창 분리(이슈 1)와 “템플릿 같다”(이슈 6)는 같은 뿌리 — 정적 인터뷰 머신이 별도 modal에 격리되어 있다는 점. 단일 채팅에 흡수하고 LLM이 한 턴씩 자연어로 묻게 하면 둘 다 해결된다.

**변경 파일**

- `dive/src/components/product/ProductModalHost.tsx:18` — `PlanInterviewPanel` 라인 제거. `PlanReviewPanel`은 “자세히 보기” 경로에서만 열리도록 유지.
- `dive/src/components/product/PlanInterviewPanel.tsx` — export 제거(파일은 잠시 남기되 사용처 0). 후속 cleanup PR에서 삭제.
- `dive/src/components/product/useProductShellController.ts:507-571` — `!canChat`일 때 `setPlanInterviewOpen(true)` 트리거 제거. 대신 `chat_send` 호출 시 `run_mode: "plan"` + interview 컨텍스트(브리프 누적 상태)를 함께 전달. `planAccepted` 플래그를 store에 추가, “수락” 시 `true`로 전환.
- `dive/src/components/product/ConversationPanel.tsx` — chat 영역 위에 `PlanDraftFloatingCard` 슬롯(sticky/floating positioning).
- `dive/src/features/planning/planDraft.ts` — `PLAN_INTERVIEW_QUESTIONS` deprecate. `usePlanInterview` 정적 머신 호출처 제거.

**신규 파일**

- `dive/src/components/product/PlanDraftFloatingCard.tsx` — 채팅 영역 상단에 floating으로 떠 있는 “계획 미리보기” 카드. PlanDraft 요약(목표/MVP/단계 수) + “자세히 보기”(→ 기존 `PlanReviewPanel` modal open) + “이대로 진행”(`planAccepted = true`, RoadmapPanel 슬라이드인 트리거) + “수정 요청”(채팅으로 “이 부분을 바꿔달라” 메시지 보내기). PlanDraft가 없으면 mount 안 함.
- `dive/src/features/planning/usePlanInterviewLLM.ts` — chat 메시지 stream에서 assistant tool call `emit_plan_draft`를 수신하면 store의 `planDraft`를 갱신. 평문 assistant 메시지는 통상 채팅으로 표시.
- `dive/src-tauri/src/dive/plan_interview.rs` — system prompt(“사용자가 만들고 싶은 것을 들으면 한 턴에 한 가지만 자연어로 물어본다. 정보가 충분하다고 판단하면 `emit_plan_draft` tool을 호출해 PlanDraft를 제출한다. PlanDraft에는 goal, MVP, non-goals, steps[name+intent], success_criteria, risks가 포함된다. 응답 언어는 사용자 locale을 따른다.”). `emit_plan_draft` tool schema 정의.

**AgentRunMode 자동 전환 (이 PR에 묶음)**

- 기존 `dive/src-tauri/src/agent/run_mode.rs` 또는 `permission.rs:88` `RunModePermissionHook` 재사용.
- `dive/src-tauri/src/ipc/mod.rs` `run_mode_for_stage` 분기 갱신: `plan_accepted=false`이면 `Plan`(read-only) 강제, `plan_accepted=true && stage in {I, V}`이면 `Build`/`Verify`. 프론트는 `currentStage` + `planAccepted`를 `chat_send`에 함께 전달, 최종 결정은 백엔드.
- AgentLoop 본체 미변경. system prompt + tool 정의 + 기존 hook 재사용.

**IPC**: 새 surface 불필요. 기존 `chat_send`에 `run_mode`/`plan_accepted` 옵셔널 추가(이미 `run_mode`는 PR 6에서 도입됨). `emit_plan_draft` tool 결과는 `AgentEvent::ToolCallEnd { name: "emit_plan_draft", arguments }`로 도달 → 프론트 hook이 파싱.

**Acceptance Criteria**

- PlanInterviewPanel modal이 더 이상 마운트되지 않음.
- 빈 프로젝트에서 “할 일 관리 앱 만들고 싶어”라고 채팅 입력 → AI가 1-3턴 자연어 질문 → PlanDraftFloatingCard 등장.
- “이대로 진행” 클릭 → RoadmapPanel 슬라이드인 + Build mode로 전환.
- PlanDraft 미생성 상태(`plan_accepted=false`)에서 edit/write/bash 도구 호출 시 권한 거부.
- “계획 다시 짜자” 의도 감지 시 `planAccepted=false`로 되돌리고 RoadmapPanel은 그대로 유지(데이터 보존).

**검증**

```bash
cd dive/src-tauri
cargo fmt --all -- --check
cargo test --features dev-mock --all-targets dive::plan_interview agent::permission
cargo clippy --features dev-mock --all-targets -- -D warnings

cd ..
pnpm typecheck
pnpm lint
pnpm test -- PlanDraftFloatingCard usePlanInterviewLLM useProductShellController
pnpm build
```

수동 회귀: 빈 프로젝트에서 채팅 시작 → AI가 자연어로 1-3턴 질문 → PlanDraft 카드가 채팅 위에 뜸 → “이대로 진행” → 우측 RoadmapPanel 슬라이드인 → 첫 단계에서 파일 수정 도구가 사용 가능해짐 확인.

**회귀 위험**

- LLM이 tool call 없이 평문으로만 응답해 PlanDraft가 영원히 안 만들어질 가능성. 완화: system prompt에 “정보 충분 시 반드시 `emit_plan_draft` 호출” 강제 + 8턴 누적 시 “지금 계획 만들기” 사용자 버튼이 PlanDraftFloatingCard 위치에 fallback 등장.
- 기존 PlanInterview e2e/dialog 의존. 완화: 해당 e2e를 chat-driven flow 시나리오로 교체.
- 사용자가 빌드 도중 “계획 다시” 원할 때. 완화: 채팅에서 “계획 다시 짜자” 같은 의도가 감지되면 `planAccepted=false`로 되돌리고 RoadmapPanel은 그대로 표시(데이터 보존), 다음 turn부터 Plan 모드로 동작.

---

## Critical Files

### Backend (Rust)
- `dive/src-tauri/src/providers/openai/stream.rs` (PR A)
- `dive/src-tauri/src/providers/openai/mod.rs` (PR A)
- `dive/src-tauri/src/agent/mod.rs:173-180` (PR A)
- `dive/src-tauri/src/dive/prompt_check.rs` (PR A, E)
- `dive/src-tauri/src/dive/plan_interview.rs` *(신규, PR D)*
- `dive/src-tauri/src/agent/run_mode.rs` / `agent/permission.rs:88` (PR D, 재사용)
- `dive/src-tauri/src/ipc/mod.rs` `chat_send`, `prompt_check_review` (PR E, D)

### Frontend
- `dive/src/components/product/ProductShellLayout.tsx` (PR B, C)
- `dive/src/components/product/RoadmapHost.tsx` (PR B)
- `dive/src/components/product/useProductShellController.ts` (PR B, C, D)
- `dive/src/components/product/useProductShellDialogs.ts` (PR C, D)
- `dive/src/components/product/RoadmapPanel.tsx:186` (PR C)
- `dive/src/components/product/ProductModalHost.tsx` (PR D)
- `dive/src/components/product/ConversationPanel.tsx` (PR D)
- `dive/src/components/product/TopBar.tsx` *(신규, PR C)*
- `dive/src/components/product/RecoverySlideIn.tsx` *(신규, PR C)*
- `dive/src/components/product/PlanDraftFloatingCard.tsx` *(신규, PR D)*
- `dive/src/features/planning/usePlanInterviewLLM.ts` *(신규, PR D)*
- `dive/src/features/planning/planDraft.ts:99-148` (PR E, D)
- `dive/src/components/chat/ChatInput.tsx:106-160` (PR E)
- `dive/src/i18n/ko.json`, `dive/src/i18n/en.json` (PR E)

## 재사용할 기존 함수/컴포넌트

- `RecoveryPanel`(PR C에서 위치만 이동, 내부 재사용)
- `PlanReviewPanel`(PR D에서 “자세히 보기” 경로로만 열림, 내부 그대로)
- `SlideInPanel`(PR C `RecoverySlideIn`의 베이스로 재사용 가능)
- `RunModePermissionHook` / `PolicyAwareHook`(PR D에서 그대로 재사용)
- `AgentLoop`(절대 재작성 금지, system prompt + tool 추가만)
- `useRoadmap`, roadmap adapter(PR B에서 visibility 도출에만 사용)

## 전체 검증 (모든 PR 종료 후)

```bash
cd dive
pnpm install
pnpm typecheck && pnpm lint && pnpm build

cd src-tauri
cargo fmt --all -- --check
cargo test --features dev-mock --all-targets
cargo clippy --features dev-mock --all-targets -- -D warnings
```

수동 검증 시나리오:

1. 빈 프로젝트에서 “할 일 관리 앱 만들고 싶어”라고 채팅에 입력 → AI가 자연어 1-3턴 질문(데이터 어디 저장? 누가 쓰나? 언어?) → PlanDraftFloatingCard 등장 → “이대로 진행” → 우측 RoadmapPanel 슬라이드인.
2. AI 비평/`prompt_check_review` 트리거 시도 → 400 없이 정상 결과 반환.
3. 한 단계 빌드 → diff preview → 적용 → TopBar의 “되돌리기 N건” 인디케이터 증가 → 클릭 → RecoverySlideIn에서 되돌리기 가능.
4. PlanDraft 본문/단계 설명/리스크 텍스트가 모두 한국어. ChatInput placeholder도 한국어.
5. 사용자 locale을 en으로 바꾸면 동일 흐름이 영어로 동작(영문 fallback 의존이 아니라 i18n 키 + LLM 응답 언어로).
