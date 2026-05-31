# DIVE 감독 역량 측정 (Supervision Metrics) — Phase 5 설계

- 작성일: 2026-05-30 KST
- 상태: 승인 (S-048 Phase 5 `PH-b0c763aa18af`의 설계 결정)
- 종류: 설계 결정 + 구현 spec
- 관련:
  - 상위 결정: `docs/superpowers/specs/2026-05-30-dive-supervision-mental-model-decision-design.md`
  - 선행: Phase 1(`...judgmental-approval-design.md`), Phase 2(`...honest-verification-design.md`), Phase 3(`...trust-calibration-steering-design.md`)
  - 논지: `docs/research/vibe-coding-supervision-thesis.md` §6
  - 측정 팩: `docs/research-measures.md`
  - Wily Stage: `S-048`, acceptance #5
- 충족 수용기준: "감독 행위 지표(오류 포착·수정요청 질·계획 reject·맹목승인 anti-metric·신뢰보정)가 로깅되고 research-measures에 정의된다."

---

## 1. 배경 — 문제

종속변수가 "산출물 완성"에서 "감독 역량"으로 바뀌었으므로(thesis §1·§6), 측정이 *감독 행위*를 포착해야 한다. Phase 1~3이 신호를 만든다: `approval_judgment.outcome`(approved/approved_with_concern/revision_requested)+note, `verify_log.{intent_match,test_result}`, plan critique/steer 이벤트. 이를 5개 지표로 정의·로깅한다. 단, 일부 지표(신뢰 보정·수정요청 질)는 ground truth/질적 코딩이 필요해 자동화에 한계가 있다 — 자동인 척하지 않는다.

기존 자산: `export_session`(JSONL + 익명화 옵션 `hash_user_text`/`hash_file_paths`/`hash_ids`), `retrospective_metrics(text)`(원문 비노출 도출 패턴, `export/mod.rs:418`), plan activity 이벤트/event_log, `pnpm research:retrospective`(analyze-retrospective.mjs).

## 2. 원칙 / 아키텍처

라이브/교사 대시보드 없음(Stage 인텐트 제외). **export JSONL(원신호) + 분석 스크립트(자동 지표 집계) + research-measures.md(정의·코딩 프로토콜)**. `retrospective_metrics` 패턴을 재사용해 원문 노출 없이 비식별 지표를 도출한다. 자동 계산 가능한 지표와 인간 코딩이 필요한 지표를 명시적으로 분리한다.

## 3. 자동 도출 지표 (분석 스크립트가 JSONL에서 계산)

- **① AI 주장 이견율 (오류 포착 프록시)** = (`verify_log.intent_match==true` 카드 중 `approval_judgment.outcome ∈ {approved_with_concern, revision_requested}` 수) / (`intent_match==true` 카드 수). 높을수록 평가 능동성↑. 명칭 정직: 실제 오류 ground truth 없이 "AI 충족 주장에 대한 이견율"을 측정.
- **③ 계획 steer 빈도** = plan당 {`plan_critique` 이벤트 outcome="found" + draft 변경요청(`onRequestRevision`) + 승인 후 `appendStep`} 횟수. event_log/plan activity에서 집계.
- **④ 과신 anti-metric (맹목승인 프록시)** = (`test_result=="skipped"`로 승인된 카드 중 `outcome=="approved"`(우려 없음) 수) / (`test_result=="skipped"`로 승인된 카드 수). **낮을수록 좋음** — AI 미검증 주장을 우려 없이 수용한 비율.

## 4. 연구분석 지표 (원신호 로깅 + research-measures 코딩 프로토콜)

- **② 수정요청의 질** — 소스: `approval_judgment.note`(outcome=revision_requested) + draft 변경요청 텍스트. *자동 보조*: `approval_judgment_metrics`(char/word count·구체성 프록시 — `retrospective_metrics` 패턴). *질적*: 표적성·구체성("그냥 다시" 대비 구체적 수정) 인간 코딩 — research-measures에 루브릭 정의.
- **⑤ 신뢰 보정** — 학습자 우려(우려/이견)가 *실제 AI 오류*와 일치하는 정도. 오류 라벨(ground truth) 필요 → **인간 코딩**. 자동 프록시(우려 ∧ `test_result==fail` 일치율)는 *보조 지표*로만 보고. 로깅 신호: outcome+note+verify_log.

## 5. 구현 표면

- **export** (`export/mod.rs`): 카드 export 레코드(라인 203-219)에 `approval_judgment`(익명화) + `approval_judgment_metrics(note)` 추가. `CardEmit` 구조체·카드 SELECT에 `approval_judgment` 컬럼 반영. note 텍스트는 `hash_user_text` 시 해시.
- **분석 스크립트**: `scripts/analyze-supervision.mjs` 신설 — JSONL을 읽어 ①③④ 집계(세션별·전체 평균) 출력. `package.json`에 `research:supervision` 스크립트 추가.
- **research-measures.md**: 5지표 정의(자동 공식 + ②⑤ 코딩 루브릭), 데이터 소스 표, 재현 절차 갱신.
- **설문 #2 재작성**: research-measures.md 문서 + in-app 설문 컴포넌트(`?route=research-survey`) 양쪽.

## 6. 설문 #2 재작성

기존 "I knew which D/I/V/E step I was in" 폐기. 대체(택1, 구현 시 확정):

- (권장) 감독 지향: **"AI 결과가 외부 테스트로 검증됐는지, AI 주장인지 구분할 수 있었다."** (출처 구분 — 기존 #4 "검증됐는지 알았다"와 차별.)
- 대안 process: "어느 작업 단계(계획/실행/검증)인지 알았다." (plan-first 단계 인지.)

본 spec은 권장안을 기본으로 한다.

## 7. 프라이버시

- `approval_judgment.note`는 `hash_user_text` 시 해시(=`retrospective` 처리와 동일). `approval_judgment_metrics`는 비식별 집계(count/bucket)만.
- 자동 지표는 익명화 export 위에서 집계 — 행 단위 원문 없이 산출.

## 8. 비목표 (Non-goals)

- 라이브/교사 대시보드.
- ⑤ 신뢰 보정의 완전 자동 판정(오류 ground truth 부재 — 프록시만 보조 제공).
- 백엔드 verify/approve 로직·DB 스키마(approval_judgment 외) 변경. (approval_judgment 컬럼은 Phase 1에서 생성됨 — Phase 5는 export에만 추가.)
- 새 식별정보 export.

## 9. 검증 기준

- `cargo test -p dive` 그린(export에 approval_judgment + metrics 포함 테스트).
- `pnpm research:supervision`이 샘플 JSONL에서 ①③④를 NaN/에러 없이 산출.
- export 익명화 옵션 ON 시 note 원문 미노출(해시), metrics는 비식별.
- `pnpm typecheck`/`lint`(설문 컴포넌트 변경) 그린.
- research-measures.md에 5지표 정의·소스·②⑤ 코딩 루브릭·설문#2 신문항 존재.

## 10. 위험 / 열린 질문

- **Phase 1~3 선행**: 자동 지표는 `approval_judgment`(Phase 1)·plan critique 이벤트(Phase 3)에 의존. 미구현 시 export 컬럼은 비고 자동 지표는 0/NaN → Phase 1~3 구현 후 의미. research-measures 정의·설문 재작성은 선행 무관하게 가능.
- **이벤트 스키마**: `plan_critique` 이벤트(Phase 3 §5 선택)가 없으면 ③의 critique 성분은 빠지고 onRequestRevision/appendStep만으로 집계 — 정의에 명시.
- **표본·타당도**: 자동 지표는 프록시임을 research-measures에 명시(특히 ①④). 인용/주장 시 한계 서술(thesis §7 정직성).
