# DIVE — Sarkar 검증 카드 신뢰성 + PRD 구체성 게이트 (Design Spec)

작성: 2026-06-23 · 브랜치 `feat/sarkar-card-prd-specificity` · 근거: 2026-06-23 rc.3 전수 점검(라이브 E2E + 코드 추적), `qa-sandbox/transu-2026-06-23/`.

승인된 설계 결정: ① Sarkar 카드는 **StepDetail에 제대로** 노출 · ② PRD는 **하이브리드(필드 게이트 + LLM 유도)** · ③ **교정적 하드게이트**.

---

## 1. 문제와 확정된 근본 원인 (코드 추적)

### A. Sarkar 검증 카드가 실사용에서 거의 안 뜬다
- StepDetail의 검증 카드는 **백엔드 supervisor 에이전트**가 생산한다(`evaluateProvocationSupervisor` → IPC `provocation_agent_evaluate` → `supervisor.rs`). 게이트는 **결정론적 규칙**(`p1_provoke_gate`)이며 spec-002 정합(LLM 억제 아님). **카드 액션은 이미 전부 배선됨**(`StepDetailSlideIn.tsx:807` — run_app/open_preview/run_tests→onVerifyFirst/continue_with_risk→onApprovalDecision).
- 안 뜨는 원인은 **다층 상태-배선 게이트**:
  1. `supervisorEvaluationRequest`는 `step && supervisorUiState && provocation.enabled && typeof provocation.sessionId === "number"`가 아니면 **null** (`StepDetailSlideIn.tsx:522-543`). sessionId가 number가 아니면 평가 자체가 안 나감.
  2. 백엔드 `p1_provoke_gate`(`supervisor.rs:1352`)는 `event==VerifyEntered && verification_state.ai_self_report && !concrete_evidence`. `ai_self_report` = `verifyLog?.intent_match`(프론트 `supervisorUiState.verification.aiClaimedDone`, `StepDetailSlideIn.tsx:495`). 즉 **모델이 intent_match를 안 세우면 게이트 실패** → 카드 없음.
  3. 평가 effect는 `[retryLoop, diffReady, supervisorEvaluation]` 순서로 돌며 **첫 "shown"만** 채택(`StepDetailSlideIn.tsx:705-743`).
- 백엔드 supervisor 카드 문자열이 **하드코딩 한국어**(`supervisor.rs:2349 "확인 필요 카드"`, `:2366`, `:1452-1453`, `:1466`) → en 로케일 누수.
- (별개) 채팅 경로 `aiSelfReportOnlyRule`(`rules.ts:513`, MessageList)은 키워드 게이트+死버튼이지만, **본 설계는 키스톤 카드를 StepDetail로 일원화**하므로 채팅 경로는 step 흐름에서 계속 suppress(변경 없음).

### B. PRD가 대충 입력해도 확정된다
- `canConfirmPrd = validateConfirmableProjectSpec(...).valid`(`PrdAuthoringBoard.tsx:222`)인데, `validateConfirmableProjectSpec`(`projectSpec.ts:325`)는 사실상 `validateMinimalProjectSpec`(`:306`)와 동일 — **goal 비어있지 않음 + 활성 acceptance criterion 1개**만 검사. `missing_intent_summary`·`missing_scope`는 타입에 선언만 되고 **구현 미사용**. **구체성 검사 전무**.
- 인터뷰 프롬프트(`plan_interview.rs:24`)는 "모호하면 다시 물어라"가 약하게 있으나 "어느 정도 구체화되면(3~6교환)" 바로 진행 제안 → 강제력 부족.

---

## 2. 설계

### Fix A — StepDetail 검증 카드를 신뢰성 있게 (상태 기반, spec-002 정합)

**목표 동작**: step이 review이고 변경이 생겼는데(에이전트가 작업·완료보고) 사용자가 **아직 외부 검증 증거를 안 모았을 때**(클릭≠증거, FR-030~033), criterion-linked 검증 카드가 StepDetail에 **반드시** 뜨고, (이미 배선된) 액션으로 검증/위험승인이 가능하며, 사용자 로케일로 표시된다. 증거를 모으면(프리뷰 확인 등) 카드는 사라지고 Decision이 열린다.

**변경 지점**:
1. **self-report 신호를 상태 기반으로** — 모델의 `intent_match` 유무와 무관하게 카드가 뜨도록. 프론트 `supervisorUiState.verification.aiClaimedDone`(`StepDetailSlideIn.tsx:495 영역`)을 `Boolean(verifyLog?.intent_match) || (isReview && actualChangedFiles.length > 0)`로 확장. "review 진입 + 변경 존재" = 암묵적 자가완료 보고.
2. **`supervisorEvaluationRequest`가 review에서 반드시 발사** — `sessionId` 게이트(`StepDetailSlideIn.tsx:527`)를 가드로 정리: review에는 항상 유효 sessionId가 실리도록 보장하고, 정말 없으면 조용한 no-op 대신 명시적 skip. (구현 시 라이브 실패의 실제 원인이 sessionId였는지 vs ai_self_report였는지 확인 — 후자가 유력.)
3. **요청 순서** — P1(verify_entered) 카드가 null 특수요청에 굶지 않도록 effect 순서/선택 정리(`:705`). 첫 "shown" 채택 로직은 유지하되 P1을 적절히 포함.
4. **spec-002 의미 보존** — criterion-linked + supervisor가 생성하는 질문(정적 폴백 금지) + non-blocking + **클릭≠증거**. `has_concrete_evidence`(`supervisor.rs:467`)의 정의(테스트 pass OR (app/preview 열림 AND criterion 확인) OR 수동 관찰)는 유지 — 즉 프리뷰만 열고 criterion 미확인이면 증거 아님 → 카드 유지. (P0-1 "클릭≠증거"와 일치 확인.)
5. **i18n** — 백엔드 supervisor 카드 문자열(`supervisor.rs:2349,2366,1452-1453,1466`)을 요청에 이미 실린 `locale` 기준으로 en/ko 분기. LLM 생성 질문은 supervisor 프롬프트가 이미 locale을 받으므로 사용자 언어로 산출되게 확인.

### Fix B — PRD 구체성 (하이브리드: 필드 하드게이트 + LLM 유도)

1. **`validateConfirmableProjectSpec` 강화**(`projectSpec.ts:325`) — 현행(goal 비어있지 않음 + criterion 1개)에 더해 필수:
   - `goal`: 실질(비어있지 않음 + 최소길이 ≥12자 + 모호어 단독 거부: "대충/적당히/알아서/뭔가/그냥" 등 denylist) → 미달 시 `vague_goal`.
   - `intentSummary`: 존재 + 실질 → `missing_intent_summary`.
   - `scope`: ≥1 실질 항목 → `missing_scope`.
   - `nonGoals`: ≥1 실질 항목 → `missing_non_goals`.
   - `acceptanceCriteria`: 활성 ≥2개, 각 실질(최소길이, 가급적 관찰가능) → `insufficient_acceptance_criteria`.
   - reasonCode 추가, 각각 i18n 안내 메시지 매핑.
2. **확정 enablement**(`PrdAuthoringBoard.tsx:222`): `canConfirmPrd = validation.valid && noPendingUnresolvedQuestions && !busy`. 하단 카피를 "Ready to confirm"/"goal is still empty" 대신 **남은 모호 항목 목록 + 다음 질문**으로 교체. `noPendingUnresolvedQuestions`는 최신 인터뷰 emit의 `unresolved_questions`에서 도출(보드까지 전달 필요 시 thread — 구현 시 확인).
3. **인터뷰 시스템 프롬프트 강화**(`plan_interview.rs:24`, ko·en 둘 다):
   - 필드별 구체성 요구: 누구를 위해, 관찰가능한 done-state, 범위 경계, 명시적 제외(non-goals), 독립 검증 가능한 acceptance criterion ≥2개, 엣지케이스.
   - 필수 필드 중 하나라도 모호하거나 criterion이 비관찰적이면 **진행 제안/확정 표시 금지** — 대신 `unresolved_questions`에 채움.
   - 기존 envelope 규칙(2~6 step 등)·locale 규칙 유지.

---

## 3. 테스트

- `projectSpec.ts`: 신규 reasonCode별 단위테스트(vague_goal/missing_intent_summary/missing_scope/missing_non_goals/insufficient_acceptance_criteria) + 유효 케이스 통과.
- `plan_interview.rs`: ko·en 프롬프트에 신규 구체성 지시문 포함 assert(기존 prompt 테스트 패턴 따름).
- StepDetail: isReview + changedFiles + 무증거 → 카드 노출(supervisorEvaluationRequest non-null + p1 게이트 통과), 증거 있으면 suppress. 액션 배선 테스트(run_tests→onVerifyFirst, continue_with_risk→onApprovalDecision).
- `supervisor.rs`: 확장된 ai_self_report 신호로 p1_provoke_gate 통과 테스트 + en 로케일 카드 문자열 영문.
- `PrdAuthoringBoard`: 필드게이트+unresolved 미충족 시 Confirm 비활성 + gap 메시지 노출.
- 회귀: `pnpm typecheck/lint(--max-warnings 0)/format:check/build/vitest` + `cargo fmt/clippy(-D warnings)/test --features dev-mock --all-targets` 전부 green.

## 4. 비목표 (Out of scope)

- 채팅(MessageList) ai_self_report 경로 전면 개편 — step 흐름에선 계속 suppress(키스톤은 StepDetail). regeneration_loop 카드 불변.
- 전수 점검의 다른 i18n 누수(로드맵 칩 등) — Wily S-025에서 별도.
- provocation/spec-002 광범위 재설계.

## 5. 예상 파일

- 프론트: `components/product/StepDetailSlideIn.tsx`(supervisorUiState/aiClaimedDone·request 게이트·순서), `components/product/PrdAuthoringBoard.tsx`(확정 게이트+gap 카피), `features/planning/projectSpec.ts`(검증+reasonCode), `i18n/en.json`·`ko.json`(신규 키).
- 백엔드: `dive/src-tauri/src/dive/supervisor.rs`(카드 i18n·ai_self_report 신호), `dive/src-tauri/src/dive/plan_interview.rs`(인터뷰 프롬프트), `dive/src-tauri/src/ipc/provocation_agent.rs`(locale 전달 필요 시).
- 각 변경에 인접 테스트.

## 6. 리스크 / 구현 중 확인 필요

- Fix A의 라이브 실패 1차 원인이 sessionId vs ai_self_report 중 무엇인지 구현 착수 시 계측으로 확정(둘 다 가드).
- `unresolved_questions`가 PRD 보드까지 도달하는지 — 미도달 시 thread 추가.
- 백엔드 i18n: supervisor 카드의 정적 문자열 vs LLM 생성 질문 경계 — 정적 폴백 문자열만 i18n 분기, LLM 질문은 locale 프롬프트 의존.
