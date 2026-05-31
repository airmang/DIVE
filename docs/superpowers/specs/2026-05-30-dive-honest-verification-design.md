# DIVE 검증 정직성 (Honest Verification / Verify) — Phase 2 설계

- 작성일: 2026-05-30 KST
- 상태: 승인 (S-048 Phase 2 `PH-ce3883928855`의 설계 결정)
- 종류: 설계 결정 + 구현 spec
- 관련:
  - 상위 결정: `docs/superpowers/specs/2026-05-30-dive-supervision-mental-model-decision-design.md`
  - 선행/동반: `docs/superpowers/specs/2026-05-30-dive-judgmental-approval-design.md` (Phase 1)
  - 논지: `docs/research/vibe-coding-supervision-thesis.md` §5.2
  - Wily Stage: `S-048`, acceptance #2
- 충족 수용기준: "intent_match가 'AI 자가보고'로 표시되고, 외부 테스트 없는 검증을 '검증 완료'로 단정하지 않으며, 학습자가 의도 충족을 능동 확인한다."

---

## 1. 배경 — 문제

`VerifyEngine`는 `VerifyLog { intent_match, test_result, details }`를 만든다. `intent_match`는 변경을 수행한 그 모델이 자가 채점한 값이고, 외부 테스트가 없으면 `test_result`는 대개 `skipped`다. 현재 UI(`StepDetailSlideIn.tsx` `VerificationBlock`)는 `intent_match`를 **녹색 ✓ 배지**로만, `test_result`를 원단어로 표시하며, `skipped`여도 카드 상태는 **"검증 통과 — 변경 사항 확인"**(`card-state-meta.ts`)으로 단정한다. 학습자 자신의 의도 판정 입력은 없다. → AI 자기채점이 객관적 통과처럼 읽히는 자동화 편향 표면(thesis §3·§5.2).

## 2. 원칙

Phase 2 = AI 검증 결과의 **정직한 프레이밍** + Phase 1 판단을 그 위에서 내리게 함. **새 입력·새 DB 컬럼 없음.** `verify.rs` 백엔드와 `approve_eligible` 로직은 불변 — 라벨/프레이밍은 전부 프론트엔드.

## 3. `intent_match` 재라벨

`VerificationBlock`(`StepDetailSlideIn.tsx:291`)에서:

- 녹색 `✓` 단독 표시를 **"AI 자가보고: 의도 충족(주장)"**(intent_match=true) / **"AI 자가보고: 의도 불충족(주장)"**(false)로 교체.
- 색을 success 단정색에서 **중립/info 톤**으로 낮춰 객관적 통과처럼 보이지 않게 한다.
- `data-testid="step-detail-intent-match"` 및 `data-intent-match` 속성은 유지(테스트 호환).

## 4. `skipped` ≠ "검증 완료"

- test_result 배지 라벨: `pass`→"테스트 통과"(success), `fail`→"테스트 실패"(danger), `skipped`→**"외부 테스트 없음"**(warn/중립). "검증 완료" 단어 제거.
- `card-state-meta.ts`의 `verified` 표현 톤다운: 단일 "검증 통과 — 변경 사항 확인" 대신, 검증 출처를 구분한다 — 테스트 `pass`면 "테스트 통과", `skipped`면 **"AI 검토 통과 — 직접 확인 필요"**. (CardState enum은 불변; 표시 문자열만 verify_log 출처에 따라 분기.)

## 5. 학습자 능동 확인 — Phase 1 재사용 + sharpen

- 별도 입력을 신설하지 않는다. Phase 1 `ApprovalJudgment`의 프롬프트를 검증 결과 맥락에서 **"AI는 의도 충족이라 *주장*함. 직접 확인했을 때 동의하나요?"**로 재구성한다. 토글 "확인함/우려"는 유지(= 동의/이견).
- 따라서 Phase 2는 Phase 1 컴포넌트의 **copy/맥락을 확장**한다. → **Phase 1을 선행 또는 동반 구현해야 한다.**

## 6. 측정 연계 (Phase 5) — 신규 저장 불필요

- `verify_log.intent_match`(AI 주장) + `approval_judgment.outcome`(학습자 판정)을 **비교**해 "오류 포착(AI가 충족 주장했으나 학습자가 우려/수정요청)"·"동의율"을 도출한다. 두 값 모두 이미 저장되므로 Phase 5에서 집계만.

## 7. 비목표 (Non-goals)

- `approve_eligible()` 로직·`verify.rs` 백엔드 변경(라벨은 프론트 전용).
- 능동 확인용 별도 입력/컬럼 신설(Phase 1 재사용).
- 측정 집계·설문·`research-measures.md` 갱신 — Phase 5.
- CardState enum 변경.

## 8. 검증 기준

- `pnpm typecheck`/`lint` 그린.
- `VerificationBlock`이 `intent_match`를 "AI 자가보고…" 문구로 렌더(스냅샷/문자열 테스트, vitest 가용 시).
- `test_result==skipped`일 때 "검증 완료" 문자열이 어디에도 표시되지 않음(grep/렌더 확인).
- Phase 1 `ApprovalJudgment` 프롬프트가 검증 맥락에서 "AI는 의도 충족이라 주장…" 문구로 표시.
- 기존 `data-testid`/`data-*` 속성 유지로 e2e 회귀 없음.

## 9. 위험 / 열린 질문

- **Phase 1 의존**: Phase 2의 §5는 Phase 1 `ApprovalJudgment` 컴포넌트를 전제한다. Phase 1 미구현 상태로 Phase 2만 진행하면 §5는 보류되고 §3·§4(프레이밍)만 적용 가능 — 구현 순서는 Phase 1 → Phase 2 권장.
- **카드 상태 라벨 분기**: `card-state-meta.ts`는 현재 CardState만 받는다. verify_log 출처(test pass vs skipped)로 문구를 바꾸려면 호출부에서 verify_log를 함께 넘기거나, 표시 시 verify_log를 참조해야 한다 — 구현 시 `card-state-meta`를 순수 유지하고 호출부(StepDetail/타일)에서 출처 분기하는 편이 깔끔.
