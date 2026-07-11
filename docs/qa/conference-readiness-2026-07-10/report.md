# DIVE 학술대회 발표 전 종합 QA 보고서

- 실행일: 2026-07-10 (Asia/Seoul)
- 대상: macOS arm64 릴리스 앱과 현재 `main` 소스
- 판정: ~~무각본 신규 사용자 라이브 데모는 NO-GO~~ → **2026-07-11 갱신: macOS 무각본 신규 사용자 라이브 데모 GO**
- 제한적 판정(원문): 이미 계획이 승인된 프로젝트를 사용하고 Pi 호환 모델을 고정하면, 권한 승인 → 코드 수정 → 미리보기 → 검토 → 3/3 완료까지는 시연 가능

> **판정 갱신 (2026-07-11, 011 라운드 종결)** — 이 보고서의 P0/P1 전 항목이
> `011-conference-demo-readiness` 라운드(wily S-050~S-057)로 수정·검증되었다.
> 본 문서 §6의 GO 조건(완전히 새 앱 데이터에서 새 프로젝트 생성부터 3단계
> 완료까지 3회 연속 성공, 허위 오류 0회)을 2026-07-11 릴리스 빌드(`dc9564a`)가
> **3/3 PASS**로 충족했다 — 증거: `docs/qa/011-live-qa/s057-go-run-log.md`
> (모델: OpenRouter Claude Sonnet 5, 본 보고서에서 실패했던 바로 그 모델).
> 라이브 QA 3라운드 전체 기록은 `docs/qa/011-live-qa/tier1-run-log.md`.
> 잔여 조건: **Windows 현장 실기 조건 점검**(설치본 GO 여정 + 해상도·로케일 —
> CI x64 설치 smoke 13/13은 통과, `s055-windows-ci-evidence.md`)은 발표 리허설에서
> 확인한다 (`s057-fallback-package.md` 체크리스트).

## 1. 결론

신규 사용자가 DIVE에서 새 프로젝트를 만들고 PRD를 작성하는 초반 경험은 동작했지만, 계획 생성 단계가 결정론적 품질 검증에 반복해서 막혔다. OpenRouter의 기존 선택 모델 `anthropic/claude-sonnet-5`는 런타임 적합 판정을 통과한 뒤 Pi sidecar에서 `model not found`로 실패했고, Sonnet 4.6 및 GPT-5.4 Mini로 재시도해도 같은 계획 품질 오류가 발생했다. PRD를 보강하고 오류 화면이 제안한 문구를 반영해도 통과하지 못했기 때문에, 현재 신규 프로젝트 경로는 실제 구현 단계에 도달할 수 없다.

한편 이미 승인된 3단계 프로젝트에서는 다음을 실제로 완료했다.

1. 입력한 할 일 추가
2. `×` 버튼으로 삭제
3. 항목 클릭으로 완료/미완료 토글 및 취소선 표시
4. DIVE의 파일 수정 권한 카드 승인
5. 내장 미리보기 수동 검증
6. 근거 연결과 위험 감수 승인
7. 프로젝트 로드맵 `03/03 완료`

따라서 핵심 실행 기능이 전부 고장 난 것은 아니다. 그러나 신규 사용자 진입 차단과 성공 후 허위 오류 때문에 학술대회 현장에서 신뢰할 수 있는 라이브 데모 상태는 아니다.

## 2. 실제 사용자 여정 결과

| 여정 | 결과 | 비고 |
|---|---|---|
| 새 프로젝트 생성 | PASS | 이름·경로·목표가 명확함 |
| 온보딩/시작 화면 | PASS | 다음 행동이 비교적 분명함 |
| 자연어 PRD 인터뷰 | PARTIAL | 상세 답변 1회가 초안에 반영되지 않았고 원인/복구 안내 없음 |
| 수동 PRD 작성 및 확정 | PASS | 수동 입력으로는 확정 가능 |
| 신규 프로젝트 계획 생성 | **BLOCKED** | 3개 모델, PRD v2 보강, 재생성 모두 실패 |
| 신규 프로젝트 구현 | **NOT REACHED** | 계획 생성 차단의 연쇄 결과 |
| 기존 승인 프로젝트 구현 | PASS | Pi가 파일을 읽고 수정 권한을 요청함 |
| 편집 권한 게이트 | PASS | diff와 변경 파일을 확인한 후 승인 가능 |
| 생성 앱 미리보기 | PASS | 추가·삭제·완료 토글을 수동 확인 |
| 검토/승인 | PASS WITH FRICTION | 근거 연결 후에도 미연결 기준 때문에 위험 감수 사유 필요 |
| 전체 3단계 완료 | PASS | `03/03 완료` 확인 |
| 성공 후 상태 신뢰성 | **FAIL** | 정상 수정 후 허위 stall timeout 오류가 2회 표시됨 |
| Windows 설치 앱 smoke | NOT RUN | macOS arm64 환경에서는 NSIS/EdgeDriver 전체 게이트 실행 불가 |

## 3. 우선순위별 문제와 버그

### P0 — 발표 전 반드시 수정

#### P0-01. 신규 프로젝트 계획 생성이 품질 게이트에서 반복 차단됨

- 재현: 정적 체크리스트 앱 PRD 작성 → 계획 생성 → Sonnet 4.6/GPT-5.4 Mini로 재시도 → PRD에 반응형·접근성·저장·취소선 기준까지 추가 → 동일 오류.
- 사용자 영향: 신규 사용자는 구현 단계에 진입할 수 없다.
- 관찰 근거: [09-plan-retry-blocked-english-implementation-detail.jpg](screenshots/09-plan-retry-blocked-english-implementation-detail.jpg)
- 코드 근거:
  - `workspace_plan.rs:4918-4945`는 전역 기준과 모든 단계 기준을 하나씩 검사하고 하나만 표식 목록을 벗어나도 전체 계획을 거부한다.
  - `workspace_plan.rs:4934-4938`의 오류 조언은 “숫자, 비교자, named UI element, state”를 요구한다.
  - `plan_quality_constants.rs:176-189`는 목표에 `화면`이나 `버튼`만 있어도 UI 목표로 분류해 반응형·영속성·접근성 기준을 모두 강제한다.
  - 오류 화면이 제안한 `CSS .done { text-decoration: line-through }` 문구 자체는 `criterion_has_observable_marker`의 허용 표식에 포함되지 않아 조언대로 고쳐도 다시 차단될 수 있다.
- 수정 방향:
  - 전체 기준 중 하나의 표현 문제를 계획 전체 차단으로 승격하지 말고, 전역 기준 묶음이 사용자 결과를 충분히 검증하는지 평가한다.
  - UI 분류 키워드를 `화면`/`버튼` 같은 일반어가 아닌 실제 요구 범주로 좁힌다.
  - 복구 화면의 예시가 동일 검증기를 실제로 통과하는 회귀 테스트를 추가한다.
  - 한국어 입력에는 한국어 복구 문구를 제공한다.

#### P0-02. 모델 선택 가능 상태와 Pi 실행 가능 상태가 불일치함

- 재현: 기존 OpenRouter 모델 `anthropic/claude-sonnet-5` 선택 상태에서 계획 생성.
- 결과: UI/백엔드 capability는 ready로 판단했지만 sidecar가 `model not found: openrouter/anthropic/claude-sonnet-5`로 즉시 실패했다. 사용자 화면에는 원인 toast가 없고 PRD 화면으로 되돌아갔다.
- 코드 근거:
  - `pi_sidecar/parity.rs:18-42`는 provider 단위 적합성만 확인한다.
  - `pi-sidecar/src/index.mjs:163-167`은 실제 실행 시점에야 `getModel(provider, modelId)`을 호출해 미등록 모델을 거부한다.
  - `ProviderModelSelector.tsx:47-54, 67-98`은 공급자 카탈로그 모델을 그대로 보여주며 Pi 등록 여부를 표시하거나 필터링하지 않는다.
- 수정 방향:
  - 모델 저장 시점 또는 실행 전 preflight에서 `provider + model` 조합을 검증한다.
  - 미지원 모델은 선택 불가/`Pi 미지원`으로 표시하고, 실패 시 호환 모델로 바로 전환하는 CTA를 제공한다.
  - 계획 생성 오류를 조용히 삼키지 말고 화면에 원인과 복구 행동을 표시한다.

### P1 — 발표 신뢰성을 크게 훼손

#### P1-01. 정상 편집 뒤 허위·중복 stall timeout 오류가 발생함

- 재현: step-2 파일 편집 권한 승인 → 실제 미리보기에서 추가/삭제 성공 → 약 45초 뒤 stall timeout 표시 → 이후 동일 오류 한 번 더 표시.
- 영향: 성공한 작업을 실패처럼 보이게 하며, 사용자가 재시도하면 중복 변경 가능성이 생긴다. 학술대회 시연에서 가장 눈에 띄는 신뢰성 결함이다.
- 관찰 근거: [16-successful-edit-followed-by-stall-error.jpg](screenshots/16-successful-edit-followed-by-stall-error.jpg), [18-completed-generated-app-3-of-3.jpg](screenshots/18-completed-generated-app-3-of-3.jpg)
- 코드 근거: `useChatSession.ts:720-730`은 일부 종료 이벤트에서 타이머를 지우지만, 그 뒤 도착하는 다른 이벤트는 다시 타이머를 건다. `useChatSession.ts:590-595`의 45초 타이머는 세션이 이미 성공 종료됐는지 확인하지 않고 오류 메시지를 추가한다.
- 수정 방향: run ID별 종료 상태를 보존하고, terminal event 이후의 telemetry/progress가 stall timer를 다시 활성화하지 못하게 한다. 중복 오류 ID/활성 run 검증 테스트를 추가한다.

#### P1-02. PRD 인터뷰의 상세 답변이 초안에 반영되지 않아도 이유와 복구가 없음

- 재현: 사용자·범위·비범위·제약·완료 기준을 포함한 상세 한국어 답변 1회 전송.
- 결과: 필드는 비어 있고 “방금 대화는 PRD 초안에 바로 반영하지 않았습니다”만 표시됨.
- 관찰 근거: [05-prd-first-turn-not-applied.jpg](screenshots/05-prd-first-turn-not-applied.jpg)
- 코드 근거: `workspace_plan.rs:2474-2502`는 모델 응답에서 유효 JSON patch를 추출하지 못하면 `patch: None`으로 처리한다. UI `PrdAuthoringBoard.tsx:602-606`은 `applied`와 `held_for_student` 이외의 상태를 모두 같은 거절 문구로 표시한다.
- 수정 방향: `none`, JSON parse 실패, 정책 거절을 구분하고 원인·원문 보존·“다시 구조화” 버튼을 제공한다. 한 번의 상세 답변을 실제 patch로 변환하는 provider 통합 테스트가 필요하다.

#### P1-03. AI 생성 provenance가 실제 편집 이력과 어긋남

- 관찰: AI patch가 실패한 뒤 사용자가 직접 모든 PRD 필드를 입력했지만 검토 카드는 “AI가 대화를 정리한 요약”이라고 표시했다.
- 영향: 사람 편집과 AI 추론을 구분해야 하는 연구/학술 발표에서 데이터 해석을 오염시킨다.
- 관찰 근거: [06-prd-manually-completed-review-card.jpg](screenshots/06-prd-manually-completed-review-card.jpg)
- 수정 방향: 필드별 출처(`student`, `AI patch`, `AI suggestion accepted`)를 보존하고 카드 문구와 EventLog에 반영한다.

#### P1-04. 정적 release verifier 3개가 현재 실패함

- `verify:audit-fixes`: 17/19 통과. quota/rate-limit 시 active step blocked 전환과 resume action 검사가 실패.
- `verify:quality-followup`: 21/23 통과. `DIVE_QA_APP_DATA_DIR` 격리 미구현, initial chunk 예산 실패.
- `verify:route-chat-cancel-quality`: 30/31 통과. initial chunk 500 KiB 예산 실패.
- 실제 빌드 initial chunk: 535,278 bytes, 약 523 KiB.
- 추가 결함: `verify-quality-followup.mjs:141-143`의 문구는 “previous 534KB baseline”이라고 쓰지만 실제 임계치는 `520 * 1024`다. release 판정 문구와 수치가 불일치한다.
- 수정 방향: rate-limit 복구 상태를 제품에 연결하고, QA 앱 데이터 격리를 구현하며, route/code splitting으로 초기 chunk를 500 KiB 미만으로 낮춘다. verifier 설명과 실제 임계치를 일치시킨다.

#### P1-05. 설치형 앱 전체 release gate가 이 환경에서 증명되지 않음

- `release:smoke:preflight`는 통과했지만 Windows x64/ARM64 NSIS 설치·실행 smoke는 macOS arm64에서 수행할 수 없었다.
- 학술대회 데모 장비가 Windows라면 Windows 러너/실기에서 설치, 첫 실행, WebView2/EdgeDriver, provider 설정, 새 프로젝트, 복구/재실행을 별도 확인해야 한다.

### P2 — 개선 권장

#### P2-01. 활성 세션이 생성됐는데 빈 상태 문구가 계속 노출됨

- step 세션 시작 직후 “세션을 시작해 대화를 시작하세요 / + 새 세션”이 보였다.
- 활성 세션 생성과 메시지 히스토리 로딩 사이의 상태 문구를 분리해야 한다.

#### P2-02. 모델 선택기가 초보자에게 지나치게 넓고 호환성 정보가 없음

- OpenRouter 모델 수백 개가 검색 가능한 native select에 그대로 노출된다.
- 추천/검증됨/비용/속도/Pi 지원 상태로 그룹화하고 기본 추천 모델을 제공하는 편이 안전하다.

#### P2-03. 계획 단계가 겹치고 구현 범위를 앞당겨 수행함

- 기존 3단계 프로젝트에서 step-1은 scaffold 단계였지만 Add 동작까지 이미 구현했고, step-2가 다시 Add JavaScript 구현을 요구했다.
- 단계별 예상 변경 파일과 비중복 acceptance criteria를 계획 검증에 포함해야 한다.

#### P2-04. 검토·승인 흐름의 마찰이 과도함

- 실제 미리보기에서 기능을 확인해도 각 기준 연결이 완전하지 않으면 위험 감수 사유를 다시 입력해야 했다.
- 안전성은 장점이지만, 동일 미리보기 관찰을 여러 acceptance criteria에 연결하거나 “이번 관찰을 관련 기준 모두에 적용”하는 기능이 필요하다.

#### P2-05. 한국어 UI 안에 영문 오류·단계 설명이 혼재함

- 계획 복구 안내와 생성된 단계/AC가 영어로 표시됐다.
- 모델 출력이 영어여도 사용자 로케일에 맞춰 복구 메시지는 제품 소유 번역으로 제공해야 한다.

#### P2-06. 프로젝트 사이드바가 과거 QA 프로젝트로 과밀함

- 새 사용자 관점에서는 현재 작업을 찾기 어렵다.
- 최근/고정/보관, 검색, QA 프로젝트 숨김 또는 별도 workspace가 필요하다.

## 4. 자동 QA 결과

### 통과

- Frontend: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`
- Unit: 72 files, 480 tests 통과
- Rust: `cargo fmt --check`, `cargo clippy --all-targets --features dev-mock -- -D warnings`
- Rust tests: main library 639 통과, 8 ignored; integration suites 통과
- Production build: 통과, 단 initial chunk 예산 경고/검증 실패
- `verify:production-wire`: 24/24
- `verify:product-flow`: 24/24. 단 스크립트 자체가 connected-provider smoke는 증명하지 않는다고 명시
- `verify:v4`: 통과
- `verify:a11y`: 11/11
- `verify:quality-iteration`: 22/22
- `release:smoke:preflight`: 통과

### 실패/미증명

- `verify:audit-fixes`: 2 failures
- `verify:quality-followup`: 2 failures
- `verify:route-chat-cancel-quality`: 1 failure
- Windows NSIS installed-app smoke: 미실행
- 새 프로젝트의 PRD → 계획 → 구현 → 검증 full E2E: 계획 단계에서 차단

## 5. 접근성·UX 감사

### 강점

- 새 프로젝트 대화상자는 필수 정보와 기본 경로가 명확하다.
- 편집 전 diff와 파일명을 보여 주고 명시 승인을 요구하는 권한 카드가 좋다.
- 미리보기와 코드 검토가 제품 안에서 연결돼 있다.
- 검토 카드가 실제 변경/미리보기 근거 주변에 나타난다.
- 자동 a11y 검증 11/11 통과.

### 위험

- 3열 레이아웃과 우측 검토 패널의 작은 글자/높은 정보 밀도로 발표 화면과 저시력 사용자에게 부담이 크다.
- 동일한 관찰을 기준별로 다시 연결하는 과정이 키보드/스크린리더 사용자에게 특히 길 수 있다.
- 한국어/영어 혼재는 인지 부담과 오류 복구 실패 가능성을 높인다.
- 수백 개 모델을 native select로 탐색하는 경험은 초보자에게 어렵다.

### 감사 한계

`verify:a11y` 자동 검사와 실제 앱의 접근성 트리를 확인했지만 VoiceOver 전체 여정, 고대비/색각, 200% 확대, 모든 키보드 포커스 순서, Windows Narrator는 수행하지 않았다. 따라서 이 결과를 전체 WCAG 적합성으로 해석하면 안 된다.

## 6. 발표 전 수정 순서와 합격 기준

### 1차: 라이브 데모 차단 제거

1. P0-01 계획 품질 게이트 수정 및 실제 복구 문구 통과 테스트
2. P0-02 provider+model Pi 호환성 preflight와 사용자 표시
3. P1-01 terminal event 이후 stall timer 재활성화 방지
4. P1-02 PRD patch 실패 원인/복구 UI

합격 기준: 완전히 새 앱 데이터 디렉터리에서 새 프로젝트 생성부터 3단계 완료까지 3회 연속 성공, 허위 오류 0회.

### 2차: release gate 정리

1. 실패 verifier 5개 항목 모두 통과
2. initial chunk < 500 KiB
3. Windows x64/ARM64 NSIS smoke 통과
4. QA app data 격리로 기존 사용자 데이터/과거 프로젝트 영향 제거

### 3차: 발표 UX polish

1. 한국어 오류/복구 문구 통일
2. Pi 검증 모델 추천 목록 제공
3. 근거 다중 연결로 검토 마찰 축소
4. 발표용 빈 workspace 또는 보관된 프로젝트 상태 제공

## 7. 발표 운영 권고

- 현재 상태에서는 신규 사용자 전체 여정을 현장에서 무각본으로 시연하지 않는다.
- 불가피하면 `live-interactive-01`처럼 이미 계획이 승인된 로컬 프로젝트, GPT-5.4 Mini, 정적 HTML 앱을 사용한다.
- 네트워크/모델 장애에 대비해 완성된 로컬 결과와 짧은 녹화본을 준비한다.
- 단, 이 우회는 제품 준비 완료를 의미하지 않는다. P0 수정 후 clean app-data E2E를 다시 통과해야 GO로 바꿀 수 있다.

## 8. 증거 화면

1. [새 프로젝트 대화상자](screenshots/02-new-project-dialog.jpg)
2. [PRD 상세 답변 미반영](screenshots/05-prd-first-turn-not-applied.jpg)
3. [계획 생성 반복 차단](screenshots/09-plan-retry-blocked-english-implementation-detail.jpg)
4. [파일 편집 권한 카드](screenshots/14-supervised-edit-permission-card.jpg)
5. [성공 후 허위 stall timeout](screenshots/16-successful-edit-followed-by-stall-error.jpg)
6. [실제 생성 앱 동작](screenshots/17-final-generated-app-done-toggle.jpg)
7. [로드맵 03/03 완료와 중복 오류](screenshots/18-completed-generated-app-3-of-3.jpg)

전체 원본 스크린샷 18장은 `docs/qa/conference-readiness-2026-07-10/screenshots/`에 보존했다.

## 9. 환경 변경 및 저장 범위

- QA 도중 기존 OpenRouter Sonnet 5가 Pi에서 실패해 현재 선택 모델을 GPT-5.4 Mini로 전환했다.
- 생성 앱 샌드박스는 repo의 ignore 대상 `qa-sandbox/` 아래에 두었다.
- 이 보고서와 스크린샷만 새 untracked 파일이다.
- 커밋, 병합, push는 하지 않았고 HWPX 파일은 생성하거나 원격에 올리지 않았다.
