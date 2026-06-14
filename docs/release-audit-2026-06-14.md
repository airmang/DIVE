# DIVE 출시 준비 감사 보고서

작성일: 2026-06-14 · 브랜치: provocation-redesign · 방법: 7차원 멀티에이전트 정적 감사(후보 26) → P0/P1 적대적 재검증(확정 15) + P2(11)

> 한계: 이 감사는 **정적(코드)** 이다. 실제 화면 깨짐·흐름 막다른 길 같은 런타임 문제는 띄운 앱에서 클릭으로 확인해야 한다. dead-wiring은 정적으로도 잘 잡혔다.

---

## 1. 종합 판정

**현 상태로는 출시(공개 데모) 불가.** P0 3건이 모두 제품 핵심 논지(criterion-linked verification)와 keystone provocation 화면에 직격한다. 특히 "기준 체크박스가 검증 증거를 부여한다"는 카피가 실제로는 동작하지 않아, 데모에서 학생이 안내대로 따라가도 막다른 길에 도달하고 승인 버튼이 회색으로 멈춘다. 영어 로케일에서는 주요 출력 패널(코드/미리보기/터미널) 전체가 한국어로 표시된다.

---

## 2. P0 출시차단

### P0-1. 기준 체크박스가 "검증 증거 있음"을 약속하지만 실제로 부여하지 않음 (핵심 루프 단절)
`StepDetailSlideIn.tsx:442-461` + `ko.json roadmap.step_detail.criterion_confirm_hint` + `decisionGatePolicy.ts`/`verificationGrade.ts`

힌트 카피는 "확인한 기준을 체크하면 '검증 증거 있음'으로 인정됩니다"인데, `hasConcreteVerification`은 `manualOrPreviewObserved && acceptanceCriterionConfirmed`을 요구한다. `previewChecked`/`appLaunched` 신호가 **어디서도 기록되지 않아** 체크해도 게이트는 `requiresReason=true`로 고정 → 일반 승인 비활성 → "위험 감수 승인"만 남는다. 가장 흔한 스텝(수동/테스트 skip)에서 안내대로 따라가도 막다른 길이고, 정당한 수동 검증을 "위험"으로 호명한다.

**수정**: (a) `onOpenPreview` 시 `previewChecked`를 verification context에 기록, 또는 (b) `verificationKind==='manual'`이면 `acceptanceCriterionConfirmed`를 observed 신호로 전달. + 체크박스 단독으로 "검증 증거 있음"을 약속하는 카피 정직화(자기 확인 ≠ 외부 증거).

### P0-2. 슬라이드인 패널(코드/미리보기/터미널) 전체 하드코딩 한국어
`SlideInPanel.tsx` (+ `PreviewTab.tsx`, `TerminalTab.tsx`) — `useT()` 미사용(0건)

탭 라벨·헤더·학습 힌트·aria-label·미리보기 URL 오류/상태·터미널 라벨 전부 한국어 리터럴. 영어 데모에서 앱 절반은 영어, 이 패널만 한국어. 같은 디렉터리 형제 파일은 `useT()`를 쓰므로 시스템 부재가 아닌 이 3파일 누락.

**수정**: 3파일에 `useT()` 추가, 가시 텍스트·aria-label을 `slide_in.*` 키로 이전. AI로 보내는 composer-seed 프롬프트는 하드코딩 유지 가능.

### P0-3. PlanDraft 승인 화면: oversized_scope 주 액션 "기능으로 나누기"·"첫 기능만 요청하기" no-op
`PlanDraftApprovalScreen.tsx:149-159`

`handleProvocationAction`이 `add_acceptance_criteria`·`add_verification_step`만 처리, `split_scope`는 fall-through. 가장 강조된 주 CTA가 무반응.

**수정**: `split_scope` 분기 추가 — 기존 패턴대로 `setFeedback`에 "더 작게 나눠주세요" 프롬프트 seed.

---

## 3. P1 중요 결함

| # | 제목 | 파일 | 영향 | 수정 |
|---|---|---|---|---|
| P1-1 | StepDetail 핸들러가 `continue_with_risk`·`run_tests` 무시 (thesis 핵심 카드 죽은 버튼) | `StepDetailSlideIn.tsx:225-260` vs `rules.ts:538-545` | verify 단계 `aiSelfReportOnlyRule`("AI 완료 보고만 있음")의 "테스트 실행"·"미검증 승인"이 죽음. 이유 작성 후 승인해도 무반응 — supervision 핵심 순간 막다른 길 | `run_tests`→`onVerifyFirst`, `continue_with_risk`(+reason)→`onApprovalDecision({outcome:'approved_with_concern', note})`. 핸들러에 reason 인자 수신 |
| P1-2 | 위험명령 차단목록(`rm -rf /`, `dd`, fork bomb, `sudo`, `curl\|bash`)이 죽은 코드 | `guard.rs:138`, `agent/mod.rs:348` | 광고·테스트된 하드블록이 런타임 미적용(`block_as_error`를 어떤 tool도 호출 안 함). `chmod -R 000 .`·`git reset --hard` 단일 명령이 1클릭 승인으로 백스톱 없이 통과(쉘 메타문자류는 run_process가 별도 차단) | `RunProcess::validate`에서 `classify_bash_command` 호출 후 매치 시 `Blocked` 반환, 또는 가드 모듈·주장 삭제. 파괴적 명령 통합 테스트 추가 |
| P1-3 | 기본 "익명화" 내보내기에서 어시스턴트 메시지 본문 평문 노출 | `export/mod.rs:300-305` | `hash_for_role = role=="user"` — 어시스턴트/툴/시스템 본문은 verbatim. 응답은 읽은 파일·터미널 출력·소스·노출 키를 인용 → 공유 JSONL에 평문. spec §9.4 위반(로컬 전용→P1) | 본문을 `anonymize_value`/`redact_text` 통과. `sk-...`+경로 seed 회귀 테스트 |
| P1-4 | 체크포인트 복원이 키보드/스크린리더 도달 불가 (hover 전용) | `CheckpointTimeline.tsx:138-186` | "복원" 버튼이 `onMouseEnter`로만 뜨는 `hovered`에 의존, `onFocus`/`onBlur` 없음. 키보드로 복원(헤드라인 supervision 기능) 도달 불가 | wrapper에 `onFocus`/`onBlur` 추가, 또는 hover 무관하게 복원 컨트롤 렌더 |

> 병합: 입력의 StepDetail `run_tests` no-op / `continue_with_risk` 미처리 / 둘 합친 ux 항목은 **같은 핸들러의 같은 누락** → P1-1로 통합. 한 번 수정으로 해소.

---

## 4. P2 개선

**검증된 P2**
- SocraticInterviewPanel "그대로 진행"(`continue_with_risk`) 무음 no-op — caution이라 X 탈출구는 동작 (`SocraticInterviewPanel.tsx:83-91`)
- 실패 테스트가 `externalTestRun`로 "구체 증거" 집계 — grader 불일치(승인은 별도 가드로 차단됨) (`verificationStatus.ts:191-199`)
- `automated_tests_passed`가 약한 `userHasViewedTestResult`로 설정 가능 — 현재 도달 불가 잠복 버그 (`verificationStatus.ts:131-138`)
- 토스트/다이얼로그 aria-label 한국어 하드코딩 (`ToastProvider.tsx`, `ui/dialog.tsx`)
- 설정 페이지 base-url 보안경고·연결해제 confirm·모델 셀렉터 한국어 (`settings.tsx`, `ProviderModelSelector.tsx`)
- 채팅 메시지 편집/재전송 aria-label 한국어 (`UserMessage.tsx:28,39`)

**미검증 P2 (출시 전 확인 권장)**
- AgencyStateChip 명령형 라벨("검증 필요")이 클릭 불가 span — affordance 없음 (`StepDetailSlideIn.tsx:558-573`)
- `onOpenPreview` optional 호출 — 미바인딩 caller에서 무음 no-op 위험 (`StepDetailSlideIn.tsx:230-233`)
- `diffScopeDrift` 필터가 goal의 generic 키워드 하나("ui")로 무력화 (`rules.ts:297-310`)
- `regenerationLoop` repeatedErrorCount 경계 모호 (`rules.ts:561-577`)
- 체크포인트 dot kind 색상 단독 신호 (`CheckpointTimeline.tsx:45-59`)
- ApprovalJudgment concern textarea 접근 이름 없음 (`ApprovalJudgment.tsx:61-67`)
- chat-demo `as never` 4개 — 데모 페이지, 타입 안전 smell (`chat-demo.tsx:237-244`)
- 내보내기 secret 탐지가 `sk-`만 — `ghp_`/`AKIA`/`Bearer`/`password=` 미탐지, evidence/decision은 anonymize 미통과(P1-3과 함께 처리) (`anonymize.rs:78-85`)
- DecisionGate 녹색 evidence 블록이 diff-reviewed를 증거로 표시 (`DecisionGate.tsx:73-123`)
- provocation 'mark irrelevant'가 녹색 체크 아이콘 — approve로 오독 (`ProvocationCard.tsx:113-125`)
- DangerCard Approve가 diff-ack 전까지 무음 비활성 — 인라인 사유 없음 (`DangerCard.tsx:23-161`)

---

## 5. 차원별 요약

- **dead-wiring**: provocation 주/탈출 버튼이 여러 host에서 핸들러 누락으로 죽음 — keystone에 P0 1건.
- **logic**: 검증 grader가 둘로 갈려 실패/미검증을 "구체 증거"로 오집계하나, 승인 게이트는 별도 가드로 보호됨.
- **i18n**: 영어 로케일에서 주요 출력 패널 전체(P0) + a11y 속성·설정 문자열이 한국어.
- **a11y**: 헤드라인 복원이 키보드/SR 도달 불가(P1) + 색상단독·라벨없는 textarea.
- **backend-security**: 광고된 위험명령 하드블록 미적용(P1) + 기본 내보내기 어시스턴트 본문·비OpenAI 시크릿 평문 유출(P1).
- **ux-principle**: 중심 검증 루프 카피가 동작과 모순(P0), evidence 표시·아이콘이 과신 유도.
- **type-safety**: 데모 페이지 `as never`가 유일 smell, 런타임 영향 낮음.

---

## 6. 권장 수정 순서

1. **P0-1 핵심 루프 복구** (체크박스↔verification context + 카피) — 제품 논지의 심장, 데모 막다른 길.
2. **P0-3 PlanDraft `split_scope` + P1-1 StepDetail `run_tests`/`continue_with_risk`** — 같은 dead-wiring 패턴, 함께 처리.
3. **P0-2 슬라이드인 i18n** — 기계적 작업, 영어 데모 직전 필수.
4. **P1-3 export 평문 노출 + secret 탐지 강화 / P1-2 guard 런타임 적용(또는 주장 삭제)** — 데이터 유출·안전 백스톱.
5. **P1-4 체크포인트 복원 a11y**.
6. **P2 마무리** — i18n 잔여, ux 폴리시, logic 정합성, 미검증 P2 대조.

**핵심**: 학술 기여(criterion-linked verification)를 시연하는 바로 그 화면에서 P0가 난다. 데모 전 P0 3건 필수, P1까지 처리해야 "감독 역량" 논지가 코드로 입증된다.
