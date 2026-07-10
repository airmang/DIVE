# DIVE 신뢰보정 & steering 리프 (Trust Calibration & Steering / Entrust) — Phase 3 설계

- 작성일: 2026-05-30 KST
- 상태: 승인 (S-048 Phase 3 `PH-708f0003f9f3`의 설계 결정)
- 종류: 설계 결정 + 구현 spec
- 관련:
  - 상위 결정: `docs/superpowers/specs/2026-05-30-dive-supervision-mental-model-decision-design.md`
  - 선행/동반: `docs/superpowers/specs/2026-05-30-dive-judgmental-approval-design.md` (Phase 1)
  - 논지: `docs/research/vibe-coding-supervision-thesis.md` §5.3·§5.4
  - Wily Stage: `S-048`, acceptance #3
- 충족 수용기준: "계획 승인 전 비평(빠진 단계)·step 결과의 신뢰보정 prompt가 (튜토리얼 모드로) 제공된다."

---

## 1. 배경 — 문제

DIVE는 학습자에게 *의심·비평 근육*을 연습시키지 않는다. 계획은 한 번에 승인되고(빠진 단계 점검 없음), step 결과는 AI 검증을 그대로 수용한다. thesis §5.3(신뢰 보정)·§5.4(steering rep)는 "계획 승인 전 빠진 단계를 한 번 묻고", "AI가 틀렸을 수 있는 지점을 노출"하라고 권고한다.

기존 자산: `useUiPreferencesStore.tutorialEnabled`(기본 true) + `useTutorialEnabled()` 훅, `LearningHint`(이미 tutorial 게이트), `PlanDraftApprovalScreen`(계획 승인), `StepDetailSlideIn`(step 결과 + Phase 1/2 판단 표면), chat→`plan_router`→`appendStep`(계획 수정 경로).

## 2. 원칙

기존 `useTutorialEnabled()` 게이트 위에 **두 prompt**를 얹는다. 새 DB 스키마 없음, 거의 프론트엔드. 튜토리얼을 끄면(숙련자·연구 control) 둘 다 사라지고 기존 흐름으로 복귀.

## 3. A — 계획 비평 rep (steering)

`PlanDraftApprovalScreen`에서 튜토리얼 모드일 때 승인 버튼 앞에:

- **"이 계획에 빠진 단계가 있나요?"** 두 선택: **[없음]** → 승인 버튼 활성 / **[있음]** → 승인 비활성 유지 + "빠진 단계를 채팅으로 요청하세요" 안내 + 채팅 입력 포커스.
- "있음" 후 실제 단계 추가는 **기존 chat→`plan_router`→`appendStep` 경로 재사용**(새 기계 없음).
- 비튜토리얼 모드: 기존 승인 버튼 그대로(질문 없음).

## 4. B — step 신뢰보정 힌트 (trust calibration)

`StepDetailSlideIn`의 Phase 1 `ApprovalJudgment` 위에, 튜토리얼 모드일 때 `LearningHint`로:

- **"AI가 틀렸을 수 있는 지점이 있다면 어디일까요?"** — 별도 입력/저장 없이 학습자 판단을 *점화*만 하는 비차단 힌트(의심 근육).
- → Phase 1 `ApprovalJudgment` 컴포넌트를 전제(의존성).

## 5. 측정 / 저장

- 새 DB 스키마 없음. "계획 reject/steer 빈도"는 **기존 plan activity 이벤트**(`appendStep`/`approve`)로 Phase 5가 도출.
- 계획 비평 선택(없음/있음)을 신호로 남기려면 **기존 event log에 `plan_critique` 이벤트**를 선택적으로 기록(스키마 변경 없음). 정식 집계·anti-metric은 Phase 5.

## 6. 의존성 / 비목표

- **B는 Phase 1 `ApprovalJudgment` 전제** → Phase 1 선행/동반. **A는 독립.**
- 비목표:
  - 계획 비평을 **AI가 자동 생성**(빠진 단계 자동 지적)하지 않는다 — *학습자가* 비평하는 것이 목적(자동화 편향 대응).
  - step 신뢰보정의 별도 입력/저장 신설 안 함(Phase 1 판단 재사용·점화만).
  - 측정 집계·설문·`research-measures.md` 갱신 — Phase 5.
  - 백엔드 verify/approve 로직·DB 스키마 변경 없음.

## 7. 검증 기준

- `pnpm typecheck`/`lint` 그린.
- 튜토리얼 ON: `PlanDraftApprovalScreen`에 "빠진 단계가 있나요?" 질문 표시; [없음] 선택 전 승인 비활성; [있음] 선택 시 채팅 안내.
- 튜토리얼 OFF: 질문 없이 기존 승인 버튼만(회귀 없음).
- 튜토리얼 ON: step 판단 위에 "AI가 틀렸을 수 있는 지점…" 힌트 표시; OFF면 미표시(`LearningHint` 기본 동작).
- 기존 `data-testid`/승인 경로 회귀 없음.

## 8. 위험 / 열린 질문

- **계획 승인 차단의 강도**: 튜토리얼 모드에서 [없음/있음] 미선택 시 승인 비활성으로 두되, 과도한 마찰이면 "건너뛰기"를 허용할지(튜토리얼 한정이라 기본은 한 번 선택 요구). 구현 시 사용자 반응으로 조정.
- **A의 "있음" 채팅 포커스**: 현행 채팅 입력 ref/포커스 유틸 확인 후 연결. 없으면 안내문만 표시하고 사용자가 채팅으로 요청(기능적으로 동일).
- **세 prompt의 표면 밀집**: Phase 1(판단)+Phase 2(정직 라벨)+Phase 3(B 힌트)이 step 결과 한 곳에 모임 → B는 한 줄 힌트로 최소화해 시각 과밀 방지.
