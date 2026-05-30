# DIVE 감독 멘탈 모델 결정 — D/I/V/E 완전 제거 & plan-first 단일화

- 작성일: 2026-05-30 KST
- 상태: 승인 (S-048 Phase 4 "D/I/V/E 정합 결정"의 결정 산출물)
- 종류: 설계 결정(ADR 성격)
- 관련:
  - Wily Stage: `S-048` "DIVE 감독 역량 학습 루프", Phase `PH-b3f607685fba`
  - 논지: `docs/research/vibe-coding-supervision-thesis.md` §5.5(D/I/V/E 정리 결정), §1·§2(재포지셔닝·감독 역량)
  - 측정: `docs/research-measures.md`
- 충족 수용기준: S-048 acceptance #4 — "레거시 D/I/V/E 게이트와 plan-first가 런타임에 공존하지 않고 단일 멘탈 모델로 수렴한다."

---

## 1. 배경 — 문제

DIVE 런타임에는 **같은 작업 루프를 두 번 인코딩한** 두 개의 통제 구조가 공존한다.

- **레거시 D/I/V/E 게이트**: `DiveStage {D,I,V,E}` + 카드 상태머신 `Decomposed→Instructed→Verifying→Verified→Extended`(+Rejected). `DiveGateEngine::check`가 카드 상태로 진입을 차단한다. (`dive/src-tauri/src/dive/gate.rs`, `state_machine.rs`)
- **신규 plan-first**: `AgentRunMode {Interview, Plan, Build, Verify}` + `plan_accepted` + `active_step_id` + `step_context`. permission hook이 *계획 승인 + 활성 step* 전까지 mutating tool을 차단한다. (`dive/src-tauri/src/agent/permission.rs:68`)
- **공존의 다리**: `ipc/mod.rs:839 run_mode_for_stage`가 `D→Plan, I→Build, V→Verify, E→Build`로 번역한다. `AgentLoop`에는 `stage`·`run_mode`·`plan_accepted`·`step_context`가 동시에 실리고, 매 `chat_send`마다 `check_gate`(D/I/V/E)와 permission(plan-first)이 **둘 다 발화**한다.

이미 한쪽으로 기운 "반쯤 남은 상태"의 증거:

- **UI**: 카드 상태 라벨은 이미 평이한 한국어(`대기/진행 중/검증 중/완료/거부`)로 탈-전문용어화됨(`card-state-meta.ts`). D/I/V/E 글자는 `DiveProgress` 진행바("DIVE 진행 상황")에만 잔존.
- **연구**: `DIVE_RESEARCH_ABLATION_GATES`(dev-mock) + 런타임 `research_gates_disabled` 정책으로 D/I/V/E 게이트만 끌 수 있게 이미 만들어둠 → 팀이 D/I/V/E를 ablation 대상으로 취급.
- **측정**: 학습흐름 설문 #2 "내가 어느 D/I/V/E 단계인지 알았다"가 측정 문항에 박혀 있음.

## 2. 핵심 관찰 — D/I/V/E는 전통적 저작 루프, plan-first와 동일

분해(D)·지시(I)·검증(V)·확장(E)은 전통적 개발 생애주기(설계→구현→테스트→반복)를 4글자로 라벨링한 것이다. AI 시대 변형은 단 하나, **"I=지시"가 "직접 짜기"에서 "AI에게 지시하기"로** 바뀐 것뿐이다.

plan-first(Interview→Plan→Build→Verify)도 같은 루프이며, `run_mode_for_stage`의 매핑(`D→Plan, I→Build, V→Verify, E→Build`)이 그 동일성을 증명한다. 즉 두 구조는 충돌하는 두 모델이 아니라 **같은 절차에 붙은 두 개의 이름표**다.

따라서:

- 전통 루프(D/I/V/E)는 *새로운 기여가 아니다* — "소프트웨어 생애주기에 글자만 붙인 것"이라는 비판에 약하다.
- AI 시대의 *진짜 새로움*은 루프 위에 얹히는 **감독 역량**(명세·조정·평가·신뢰보정; thesis §2)이며, 이것이 "코딩 도구 → 감독 훈련 환경" 재포지셔닝(thesis §1)의 핵심이다.
- 단, 분해는 thesis §4가 말한 "환원 불가능한 이해의 바닥"에 해당하는 전이 가능한 스킬이므로 *버리는 것이 아니라*, 교육모델의 간판을 전통 루프에서 감독 역량으로 올리고 전통 루프는 plan-first가 자동으로 태워주는 substrate로 둔다.

## 3. 결정

1. **런타임 멘탈 모델을 plan-first 하나로 단일화한다.** Interview→Plan→Build→Verify, step 단위. 게이팅은 plan-first permission hook 하나로 수렴.
2. **레거시 D/I/V/E를 학습자 표면에서 완전 제거한다.** 단계 선택·진행바·`stage` 분기·D/I/V/E 게이트 엔진을 제거.
3. **브랜드 "DIVE"는 유지하되 의미를 재해석한다** — Direct · Inspect · Verify · Entrust (감독 역량 니모닉).
4. **교육모델의 핵심을 감독 역량 프레임워크로 둔다.** D/I/V/E(전통 루프)는 간판에서 내린다.

## 4. 범위 (Scope)

### 제거
- **이중 게이팅**: `ipc/mod.rs run_mode_for_stage`의 D/I/V/E→런모드 번역, `agent/mod.rs check_gate`의 `DiveGateEngine` 경로. 게이팅은 plan-first permission hook(`denies_pre_plan_mutation`)으로 일원화한다 — 이 hook이 이미 D게이트(계획 전 변경 금지)와 "활성 step 필요"를 포섭한다.
- **`DiveStage` / `gate.rs`**: 호출부 제거 후 dead code로 삭제. `DiveStage`에 의존하던 런모드 도출은 plan-first 상태(interview/plan/build/verify)에서 직접 도출.
- **`chat_send`의 `stage` 파라미터**: 프론트가 D/I/V/E stage로 분기하지 않도록 제거.
- **`DiveProgress`(D-I-V-E 진행바)**: plan step 진행률 표시로 교체.

### 유지
- **`CardState` enum**(Decomposed/Instructed/Verifying/Verified/Extended): DB 스키마·마이그레이션 비용 대비 가치가 낮아 **그대로 둔다.** "D/I/V/E 모델"이라는 정체성만 떼어내 generic step 생애주기로 본다.
- **카드 상태 라벨**(`대기/진행 중/검증 중/완료/거부`): 이미 평이한 한국어 → 유지.
- **plan-first 전체**(Interview/Plan/Build/Verify, step_context, permission hook): 단일 모델의 본체.

### 비목표 (Non-goals)
- `CardState` DB enum의 마이그레이션/삭제.
- 출시 품질 항목(S-046), 교사 대시보드, 전체 영어 i18n.

## 5. DIVE 재해석 — Direct · Inspect · Verify · Entrust

| 글자 | 의미 | 감독 역량(thesis §2) | 연계 Phase |
|------|------|----------------------|------------|
| **D**irect | AI에게 의도·방향을 제시 | 명세 + 조정 | Interview/Plan |
| **I**nspect | AI 산출물(계획·변경)을 능동적으로 들여다봄 | 평가(맹목 승인의 반대) | Phase 1 판단 승인 |
| **V**erify | 결과가 진짜 맞는지 근거로 확인 | 평가(정직한 검증) | Phase 2 검증 정직성 |
| **E**ntrust | 얼마나 믿고 맡길지 보정 | 신뢰 보정 | Phase 3 신뢰 보정 |

**정직성 원칙**: "DIVE"는 제품 이름 + 기억용 니모닉으로 제시하고, 논문의 *실제 기여*는 "감독 역량 프레임워크 + 측정"이라고 분리해 서술한다. "우리 이론이 DIVE 모델이다"라는 과장은 하지 않는다.

## 6. 측정 영향 (Phase 5 연계)

- research-measures 학습흐름 설문 **#2 "어느 D/I/V/E 단계인지 알았다" 폐기 또는 재작성**(plan step 인지 여부 또는 삭제).
- 종속변수 = 감독 행위 지표: 오류 포착률·수정 요청의 질·계획 reject/steer 빈도·맹목 승인 anti-metric·신뢰 보정. (thesis §6)

## 7. 실행 함의 — 이 결정이 0번 Phase인 이유

Phase 1~3은 전부 같은 표면(승인·검증·step 리뷰)에 붙는다. 이 결정이 그 표면을 plan-first로 확정하므로, **Phase 1~3보다 먼저 잠가야 재작업이 없다.** Wily phase 정렬 순서는 4번째지만 실행상으로는 선행 결정이다. (Wily에서 phase 순서를 바꿀 필요는 없고 실행만 4→1·2·3·5 순.)

## 8. 위험 / 열린 질문

- **검증 정직성은 이 결정과 독립**: `intent_match`의 AI 자가채점 문제(`verify.rs:66` `approve_eligible()`가 `test_result==skipped`여도 통과)는 어느 결정을 택해도 Phase 2에서 별도로 다뤄야 한다.
- **이름 회귀 위험**: 발표/문서에서 D/I/V/E를 옛 의미(분해·지시·검증·확장)로 되살리면 방금 버린 전통-루프 프레이밍으로 회귀한다. 항상 Direct·Inspect·Verify·Entrust로 기술.
- **`CardState` 잔존의 인지 부채**: enum 이름(Decomposed 등)이 코드에 남아 미래 기여자가 D/I/V/E 모델로 오해할 수 있음 → 코드 주석/문서로 "generic step lifecycle"임을 명시.
