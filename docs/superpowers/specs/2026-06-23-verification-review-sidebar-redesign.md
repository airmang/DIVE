# 검증 "검토하기" 사이드바 재설계 — 디자인 노트

- Date: 2026-06-23
- Branch/worktree: `claude/angry-bardeen-aecc29` (`.claude/worktrees/angry-bardeen-aecc29`)
- Status: 설계 확정(사용자 승인 완료), 구현 대기
- Surface: `dive/src/components/product/StepDetailSlideIn.tsx` ("검토하기" 우측 슬라이드인)

## 배경

`StepDetailSlideIn`은 "검토하기" 진입 시 열리는 우측 슬라이드인(`<aside>`, `w-[520px]` 고정).
6/22 `f218379`로 rationale challenge가 plan-step 행으로 분리되어 **검증 전용**이 됨.
그 위에 아코디언 3섹션 WIP(uncommitted, 타입체크 통과)이 있었으나 — 본 재설계에서
**아코디언 → 순차 스테퍼로 교체**한다.

진단 근거: 아코디언은 학생이 펼쳐보지 않고 바로 승인 클릭 가능 → DIVE가 깨려는 "무지성 클릭"
여지를 남김. 순차 흐름은 "코드 보기 → 점검 → 관찰 기록 → 결정"을 차례로 밟게 해 감독 비계를 강화.

## 목표 (2)

1. **너비 조절(resizable)** — 사이드바 폭을 사용자가 드래그로 조절.
2. **순차 스테퍼 IA** — 검증 본문을 하나씩 수행하는 4단계 흐름으로.

## 결정

### D1. 너비 조절 — 먼저 랜딩(스테퍼와 독립)

- 좌측 가장자리 드래그 핸들(`<aside>`의 `border-l` 위치). 커서 `col-resize`.
- 기본 `520px` / 최소 `380px` / 최대 `min(900px, 80vw)`. 범위 밖은 클램프.
- `localStorage` 전역 단일 값으로 영속(key 예: `dive.review-sidebar.width`). 다음에 열 때 복원.
- 핸들 더블클릭 → 520px 리셋.
- a11y: 핸들 `role="separator"` + `aria-orientation="vertical"` + `aria-valuenow/min/max`,
  `←/→` 키로 16px씩 조절.
- 구현 메모: `w-[520px]`를 인라인 `style={{ width }}`(state)로 교체. `panelRef`(L741) 활용.
  `position: fixed`라 폭만 바뀌고 우측 고정 유지.

### D2. 순차 스테퍼 — 아코디언 교체

세로 스테퍼 4단계. 완료 단계는 한 줄 요약 + "다시 보기"로 접힘, 미래 단계는 muted.
**내용 패널은 전부 기존 컴포넌트 재사용** — 컨테이너(아코디언)만 스테퍼 셸로 교체.

| 단계 | 내용(기존 컴포넌트) | 비고 |
| --- | --- | --- |
| ① 코드 이해 | "변경 코드 보기" 액션 + `ChangeEvidenceBundle` 요약 | diff 확인 유도 |
| ② 점검·관찰 | `VerificationCoachPanel` (코치 가이드 + 관찰 기록 폼) | 관찰은 기준-연결 필수(기존 규칙) |
| ③ 검토 응답 | `ProvocationCardHost` | 카드 없으면 **단계 자동 스킵/비표시** |
| ④ 결정 | `DecisionGate` (`isReview`일 때만) | 승인/반려 |

- **초점 기준(`VerificationFocusPanel`)은 스테퍼 위에 고정 컨텍스트로 유지** — "무엇을 검증하는가"는
  전 단계에서 보여야 함. (구현 선택지: 완전 고정 헤더 ↔ Stage ①에 흡수. **고정 헤더 권장.**)
- **보조 "세부 정보"**(목표/기준 원문/지시·testCommand/타임라인/검증로그/changeSummary/회고)는
  흐름 밖 접이식 disclosure로 — 어느 단계서든 접근 가능, 선형 흐름은 가볍게 유지.
- 헤더 진행 표시: `검토하기 · n / N 단계`.

### D3. 진행 강도 = 하이브리드(비차단)

- 단계 간 **자유 이동**(이전/다음 자유, 완료 단계 재방문 가능).
- 단, ④ 결정의 **"승인"만** ②에서 기준-연결 관찰이 기록돼야 활성 —
  **기존 증거경계 규칙(BLK-015)과 동일**, 새 forcing-function 아님. `DecisionGate`가 이미
  `acceptanceCriterionConfirmed`/`observationEvidence`로 승인을 묶고 있으므로 그 상태를 스테퍼가
  반영만 하면 됨. **"반려"는 항상 가능.**
- provocation(③)은 게이트 아님 — 응답 없이도 ④로 진행 가능(Sarkar 비차단 원칙).

### D4. 카피 — "Sarkar" 제거

- 검토 카드 관련 사용자 노출 문구에서 연구자 이름 제거(초심자에게 의미 불명확).
  `progressive_review_card_title`("Sarkar 확인 필요"/"Sarkar needs review") →
  기준-중심 문구("확인 필요"/"Needs review")로. 기존 `review_card_label`과 톤 정렬.

## 파일 영향

- `dive/src/components/product/StepDetailSlideIn.tsx`
  - `<aside>` 폭 → state + 좌측 리사이즈 핸들.
  - 아코디언 `<section>`(VerificationAccordionItem ×3) 제거 → 스테퍼.
  - `VerificationAccordionItem` 컴포넌트 삭제(스테퍼 셸로 대체).
- 신규: 스테퍼 셸 컴포넌트(단계 머리/연결선/완료 요약/이전·다음). 내용은 props 주입.
- 신규(또는 인라인 훅): `useResizableWidth(storageKey, { default, min, max })`.
- `VerificationCoachPanel.tsx`: 이미 de-chrome(자체 헤더 제거)됨 — 스테퍼 배치에 맞춰 미세조정만.
- `dive/src/i18n/en.json` / `ko.json`: 미사용 아코디언 키 정리(`progressive_*`), 스테퍼 단계
  라벨/요약/네비/진행 키 추가, "Sarkar" 제거. **en/ko 키 패리티 유지.**

## 테스트

- 단위(vitest): 단계 전환; ④ 승인 비활성↔활성(관찰 기록 전/후); ③ provocation 없을 때 스킵;
  반려 항상 가능; 완료 단계 요약/재방문.
- 너비: 드래그 클램프(min/max), 더블클릭 리셋, localStorage 저장·복원, 키보드(←/→) 조절.
- i18n: en/ko 키 패리티, "Sarkar" 문자열 부재.
- 게이트: `pnpm typecheck` + `pnpm lint --max-warnings 0` + 기존 `verify-product-flow` 회귀.
- **네이티브 실앱 확인 필수**(메모리 원칙: 단위테스트만으로 "완료" 금지 — Tauri webview는 macOS AX
  미노출로 자동화 불가, 수동 또는 `?demo=` 브라우저 데모 활용).

## 작업 순서

1. **D1 너비 조절** 랜딩(작고 독립) → 커밋.
2. **D4 카피**(Sarkar 제거) → 빠르게.
3. **D2/D3 스테퍼 IA** → 커밋.

## 비고

- 작업은 워크트리 브랜치에서. main 머지/푸시는 별도(사용자 확인 후).
- 관련 메모리: provocation=criterion-linked·비차단(Sarkar), 감독 비계 ①/provocation ② 분리.

## v2: 차분한 평탄화 (2026-06-23, 사용자 피드백 — v1 스테퍼가 너무 cluttered)

문제: v1(스테퍼)이 **박스 4중 중첩 + 중복 칩**으로 "정신없음". 초점 기준 개념은 유지 가치.
방향 확정(사용자 승인): 박스 제거 + 중복 dedupe + 초점기준 슬림 + 시퀀스는 가벼운 점 표시.

- **D5 평탄화**: 본문 = 단일 컬럼 + 0.5px 구분선만. 제거 대상 — 초점패널 accent 박스 테두리,
  스테퍼 `<section>` 박스, 스테이지별 `border-l` 박스(→ 점 마커로).
- **D6 초점 슬림**: `VerificationFocusPanel` = "먼저 확인할 기준" 라벨 + 기준 + 주 액션 1개만.
  evidence 칩은 단일 dedupe 라인으로, criterion-confirm(preview/app 버튼)은 ②점검·관찰 단계로 이동.
- **D7 중복 칩 버그**: 칩 렌더에서 `verificationStatuses`+`agencyItems`를 **id로 dedupe**(한 항목만).
- **D8 시퀀스=점 마커**: `VerificationReviewStepper`를 박스 없는 dot+제목 흐름으로 재작성
  (완료=success 체크, 진행=accent 점, 미래=빈 점). 단계 콘텐츠는 박스 없이 들여쓰기.
- **D9 결정 슬림**: `DecisionGate` 승인/반려만 전면, 나머지(검증 먼저·되돌리기·중단·연기·위험 승인)는
  "더보기" disclosure로. 게이트/정책 로직(`decisionGatePolicy`, 관찰 전 승인 비활성)은 불변 — 표현만.
- **D10 세부 정보**: 접힌 채 하단(현행 유지).

비목표: 백엔드/IPC/evidence/`decisionGatePolicy` 로직 불변 — 표현/레이아웃만. en/ko 패리티, 테스트 갱신.

## v3: 실앱 피드백 폴리시 + rationale challenge 제거 (2026-06-23)

실제 앱 확인 후 사용자 피드백으로 직접 수정:

- **상태 칩 아이콘 겹침 버그 수정**: `statusIcon`이 크기 없는 lucide 아이콘을 12px 칸에 넣어
  넘치던 문제 → 아이콘에 `h-3 w-3` 직접 지정.
- **"코드 이해" 단계 슬림화**: `ChangeEvidenceBundle`(파일 그리드 6박스)을 단계 전면에서 제거 →
  버튼 + "변경 파일 N개" 한 줄 + (고위험 시) 빨간 한 줄 경고만. 상세 번들은 "세부 정보"로 이동.
- **rationale challenge UI 제거(★스펙 일탈)**: plan-step 행의 "이 단계가 왜 필요한가요?" 챌린지 +
  "나눈 이유" 표시를 제거. 근거: **이미 확정되어 실행 단계로 넘어온** 계획 행에서 매 단계 "왜
  필요하냐"를 되묻는 것은 타이밍·위치가 부적절하고, Sarkar의 "도발은 *드물게*" 원칙에 어긋남
  (사용자 판단). **수용 기준(linked criteria) 칩은 정보용이라 유지.**
  - **specs/005 (rationale-challenge offer)와의 일탈**: UI 진입점만 제거. 백엔드 핸들러
    (`onChallenge`/`onAcceptOffer`/`onDismissOffer`, IPC, `RationaleChallengePanel.tsx`)는
    **dormant로 보존**(삭제 아님) — 추후 PRD 작성 단계로 재배치 시 재사용 가능. 005 갱신/재배치는
    후속 과제.
