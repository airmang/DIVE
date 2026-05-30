# DIVE 프론트엔드 D/I/V/E 표면 제거 — stage 인지형 도움 → plan-first 맥락형

- 작성일: 2026-05-30 KST
- 상태: 승인 (S-048 후속 plan #1의 설계 결정)
- 종류: 설계 결정 + 구현 spec
- 관련:
  - 상위 결정: `docs/superpowers/specs/2026-05-30-dive-supervision-mental-model-decision-design.md`
  - 선행 plan(백엔드): `docs/superpowers/plans/2026-05-30-dive-plan-first-unification.md`
  - Wily Stage: `S-048`, acceptance #4(단일 멘탈 모델)의 *학습자 표면* 절반

---

## 1. 배경 — 문제

상위 결정에서 D/I/V/E를 런타임에서 제거하기로 했다. 백엔드 단일화는 별도 plan이 처리한다. 프론트엔드에는 D/I/V/E `stage`가 여러 표면에 퍼져 있어, "stage 인지형 도움"을 무엇으로 대체할지가 유일하게 열린 설계 질문이었다.

context 조사 결과, "stage 인지형"의 실체는 좁다:

- **`inferStageFor`** (`src/stores/workmap.ts:93`): `stage`는 독립 개념이 아니라 **CardState에서 파생된 뷰**다(cardCount·currentCard.state·allVerified → d/i/v/e). CardState는 유지하므로 stage는 카드 생애주기의 다른 이름일 뿐.
- **stage 배너** (`useProductShellController.ts:439`): 이미 `currentCard.state` 기반 평이 한국어 메시지 — D/I/V/E 글자와 무관.
- **ambiguity** (`lib/ambiguity.ts:51`): `detectAmbiguity(text, _stage?)`의 stage 파라미터는 이미 미사용(`_` 프리픽스). 순수 정규식.
- **`DiveProgress`** (`src/components/workmap/DiveProgress.tsx`): 순수 D-I-V-E 진행바 위젯.
- **`templatesForStage`** (`lib/prompt-templates.ts:61`): **유일하게 진짜 stage 인지형** — D/I/V/E별 스타터 프롬프트 필터링.

## 2. 원칙

`stage`(D/I/V/E)는 CardState 파생 뷰이므로, **CardState는 그대로 두고 D/I/V/E라는 이름·글자·파생 타입만 제거**한다. "맞는 순간 맞는 도움"의 가치는 plan-first 맥락 키로 보존한다.

## 3. 결정 — prompt-helper 재키잉 (유일한 실질 설계)

prompt-helper 스타터 프롬프트는 그 자체로 감독 행동(분해·검증·엣지·통합점검)을 모델링하는 교육 표면이므로 **유지하되 키를 plan-first 맥락으로 교체**한다.

- `inferStageFor`(d/i/v/e 반환) → **`promptContextFor`**(`"plan" | "build" | "verify"`) 로 이름·반환 변경.
  - CardState→맥락 매핑: 카드 없음 또는 계획 미승인 → `plan`; `instructed` → `build`; `verifying` → `verify`; 전부 검증됨(`verified`/`extended`) → `verify`.
- `PromptTemplate.stages: DiveStage[]` → `contexts: PromptContext[]`. `templatesForStage` → `templatesForContext`.
- 템플릿 재태깅: 기존 `D`→`plan`, `I`→`build`, `V`→`verify`, `E`(통합점검·리팩토링)→`verify`.
  - **결정 1**: E 템플릿은 `build`가 아니라 `verify`로 묶는다 (평가/Inspect 성격이 검증 맥락에 더 부합).
- **학습자에게 새 분류 라벨은 노출하지 않는다.** 템플릿은 현재 맥락에 맞게 *나타날* 뿐. Direct/Inspect/Verify/Entrust 그룹 라벨을 UI에 띄우지 않는다.
  - **결정 2**: 니모닉을 *보이는 분류*로 만들지 않는다 — 단일 멘탈 모델을 유지하고 새 4분류 표면 재생성을 방지. 니모닉은 브랜드 설명 용도로만.

## 4. 기계적 제거/정리 (설계 결정 없음)

- `DiveProgress` 위젯 + 사용처(`CardTileExpanded`, `CardTileCollapsed`, `workmap/index.ts`) 제거.
- `DiveStage` 타입(`lib/ambiguity.ts`) 제거. `detectAmbiguity`의 미사용 `_stage` 파라미터 제거(동작 불변).
- `sendUserMessage`/`SendUserMessageContext`(`useChatSession.ts`)/`chat_send` invoke의 `stage` 인자 제거. auto-run 호출(`useProductShellController.ts:436`)의 `"i"` 인자 제거(`runMode:"build"` 유지).
- `ChatInput`/`ChatArea`의 `stage` prop 제거. `ProductShellLayout`의 `current-stage` 히든 인풋 및 `hiddenState.stage` 제거(테스트 훅이면 plan 맥락 또는 step 상태로 대체).
- **stage 배너는 유지** (CardState 기반, D/I/V/E 무관).

## 5. DiveProgress 교체

카드 타일의 D-I-V-E 진행바를 **plan step 진행 표시**로 교체한다. `planRoadmap.steps`의 step 상태(done/total)를 재사용하고, 전용 위젯이 없으면 `완료 N / 전체 M` 텍스트 인디케이터로 최소 구현한다.

## 6. 측정 설문 교차참조

in-app 설문(`?route=research-survey`)의 학습흐름 문항 #2 "어느 D/I/V/E 단계인지 알았다" 수정은 **Phase 5(감독 역량 측정) 소관**이다. 이 plan은 코드 표면만 다루며, 설문 문항/`research-measures.md` 갱신은 Phase 5에서 처리한다.

## 7. 비목표 (Non-goals)

- 백엔드 plan-first 단일화 (선행 별도 plan).
- S-048 feature phase 1(판단 승인)·2(검증 정직성)·3(신뢰 보정).
- Phase 5 측정 문항·`research-measures.md` 갱신.
- CardState DB enum 변경.

## 8. 검증 기준

- `pnpm test`(또는 프로젝트 프런트 테스트 러너) 그린.
- `pnpm build`/타입체크 그린 — `DiveStage` 잔존 참조 0건(`grep -rn DiveStage src` → 빈 결과).
- prompt-helper가 plan/build/verify 맥락에서 기존과 동등한 템플릿을 노출(맥락 매핑 테스트).
- ambiguity 동작 불변(기존 테스트 그린).

## 9. 위험 / 열린 질문

- **`promptContextFor` 매핑의 "전부 검증됨→verify" 선택**: 기존 `inferStageFor`는 이 경우 `e`(확장)를 반환했다. E 템플릿을 verify로 묶기로 했으므로 맥락도 verify로 둔다. 완료 후 "다음 작업 추가" 흐름은 plan-first의 새 step 추가(plan_router)가 담당하므로 별도 맥락 불필요.
- **테스트 훅 `current-stage`**: 제거 시 깨지는 e2e/단위 테스트가 있으면 step 상태 기반 훅으로 대체(테스트도 함께 갱신).
