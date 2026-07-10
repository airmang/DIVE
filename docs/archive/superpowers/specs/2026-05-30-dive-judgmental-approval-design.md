# DIVE 승인을 판단으로 (Judgmental Approval / Inspect) — Phase 1 설계

- 작성일: 2026-05-30 KST
- 상태: 승인 (S-048 Phase 1 `PH-4a7e9dd0e0fb`의 설계 결정)
- 종류: 설계 결정 + 구현 spec
- 관련:
  - 상위 결정: `docs/superpowers/specs/2026-05-30-dive-supervision-mental-model-decision-design.md`
  - 논지: `docs/research/vibe-coding-supervision-thesis.md` §5.1
  - Wily Stage: `S-048`, acceptance #1
- 충족 수용기준: "승인이 맹목 원클릭이 아니라 경량 판단을 거치며, 그 판단이 저장된다."

---

## 1. 배경 — 문제

DIVE에는 세 종류의 승인이 있다: (1) 도구 권한 카드, (2) 계획 승인, (3) 스텝/카드 승인(`card_transition` Approve: Verifying→Verified, `approve_eligible()` 게이트). 현재 (3)은 **원클릭**이며 학습자의 평가 판단을 한 번도 요구하지 않는다(thesis §3). `card_save_retrospective` IPC와 `Card.retrospective`/`retrospective_metrics` 인프라는 있으나 학습자 작성 입력 표면이 없다(retrospective는 AI 생성 read-only).

## 2. 범위 가정 (확정)

1. 대상 = **스텝/카드 승인**(Verifying→Verified)만. 도구 권한 카드·계획 승인은 Phase 1 범위 밖.
2. 경량 판단은 **기본 필수**(승인이 판단을 거치는 통과 의례). 연구 ablation으로 끌 수 있음.
3. 저장 = **새 구조화 필드 신설**(아래 §5). `Card.retrospective`(AI 요약)는 그대로 두고 역할 분리.

## 3. 결정 — 판단 형태와 흐름

승인 직전(카드가 `Verifying`, `verify_log` 존재) 경량 판단을 강제한다.

판단 토글: **[확인함 | 우려 있음]**. 흐름:

```
검증 끝(Verifying) → 판단 토글 [확인함 | 우려 있음]
  ├─ 확인함                  → [승인] 활성 → Approve, 저장(outcome=approved)
  └─ 우려 있음 + 메모(필수)    → 분기:
        ├─ [그래도 승인]      → Approve, 저장(outcome=approved_with_concern, note)
        └─ [수정 요청]        → Reject(→Instructed 재지시), 저장(outcome=revision_requested, note=다음 지시 seed)
```

**근거:** 모든 우려를 강제 reject로 돌리면 "사소한 우려인데 진행"을 못 받아 마찰·짜증으로 무의식적 '확인함' 클릭(고무도장 회귀)을 유발한다. 분기(우려 후 "그래도 승인" vs "수정 요청")가 현실적이며, 결과가 **3분류**가 되어 측정에도 더 풍부하다. 우려 경로의 **메모 강제**가 "그래도 승인"이 새 탈출구가 되는 것을 막는 마찰이다.

## 4. 게이트 / 강제성

- 판단(토글 선택)이 기록되기 전에는 **Approve/Reject 액션 비활성**. acceptance #1 충족.
- 기존 `approve_eligible()`(intent_match + test 비-fail) 게이트와 **AND**로 공존 — 판단을 거쳐도 `approve_eligible`이 false면 Approve 불가는 유지.
- **연구 ablation 스위치**: 기존 research-controls 패턴(`AppState.research_*` 토글, `policy.rs`)을 따라 `require_approval_judgment` 류 플래그를 추가해 control 조건에서 강제를 끈다. 끄면 판단 없이 기존 원클릭 동작.

## 5. 데이터 모델

`cards` 테이블에 nullable 컬럼 **`approval_judgment` (TEXT, JSON)** 을 가법적 마이그레이션으로 추가한다(데이터 변환 없음).

```json
{
  "outcome": "approved" | "approved_with_concern" | "revision_requested",
  "note": "string | null",
  "decided_at": 1700000000
}
```

- `note`는 `outcome != "approved"`일 때 필수(비어 있으면 액션 비활성).
- `Card`/`NewCard` 모델, DAO insert/update, IPC 직렬화에 필드 추가.
- 신규 IPC(또는 `card_transition` 확장): Approve/Reject 시 판단 페이로드를 함께 받아 원자적으로 저장. 권장: `card_transition`에 선택적 `judgment` 인자를 추가해 전이와 저장을 한 트랜잭션으로(부분 저장 방지).

## 6. 측정 연계 (Phase 5)

`outcome` 3분류는 맹목승인 anti-metric + 신뢰 보정의 1차 신호다. export `retrospective_metrics` 옆에 `approval_judgment` 집계를 추가하는 작업은 **Phase 5 소관**. 본 Phase는 저장까지만.

## 7. 비목표 (Non-goals)

- 도구 권한 카드·계획 승인의 판단화.
- "수정 요청"의 비평/steering prompt 기계(빠진 단계 지적 등) — Phase 3.
- `approval_judgment` 집계·설문·`research-measures.md` 갱신 — Phase 5.
- `Card.retrospective`(AI 요약) 변경.

## 8. 검증 기준

- `cargo test -p dive` 그린(상태머신·DAO·IPC 단위 테스트 추가).
- 마이그레이션이 기존 DB에서 멱등 적용(컬럼 추가, null 허용).
- 흐름 테스트: (확인함→Approve+outcome=approved), (우려+메모→그래도승인=approved_with_concern), (우려+메모→수정요청=revision_requested + Reject 전이), 메모 없는 우려는 액션 차단.
- ablation 플래그 on이면 판단 없이 Approve 가능(기존 동작).
- `pnpm typecheck`/`lint` 그린(프론트 토글/메모/분기 UI).

## 9. 위험 / 열린 질문

- **`card_transition` 시그니처 변경 vs 별도 IPC**: 전이와 판단 저장을 원자적으로 묶으려면 `card_transition`에 `judgment` 인자를 더하는 편이 안전(부분 상태 방지). 별도 IPC 2회 호출은 경합·부분저장 위험.
- **"그래도 승인"의 고무도장화**: 메모 강제 + `approved_with_concern`을 별도 outcome으로 로깅해 Phase 5에서 비율을 모니터(높으면 마찰 재설계 신호).
- **UI 위치**: 판단 토글/메모/분기 버튼은 검증 결과가 보이는 표면(StepDetailSlideIn 또는 챗 내 승인 액션)에 배치. 구현 시 현행 승인 진입점 확인 후 결정.
