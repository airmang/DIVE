# DIVE 제품 리뷰 결과보고서 — 2026-06-10

- 리뷰 대상: `main` @ `b886f2e` (v1.0.0-rc.2)
- 리뷰 방법: ① 연구 문서(`docs/research/conference-poster/*`) 대조 → ② CI 게이트 전체 실행 → ③ 핵심 경로 코드 리뷰(런타임 선택·Pi sidecar·권한 승인·인터뷰·파일 도구 보안) → ④ 6/8 E2E QA 블로커(B1~B4) 현재 HEAD 재검증
- 리뷰 축: 정확성 · 가독성/아키텍처 · 보안 · 성능 · 제품(파일럿) 준비도

> **2026-06-10 갱신 (수정 라운드 + 실기기 E2E):** 본 보고서의 Critical/Major/Minor를 `fix/product-review-findings` 브랜치(`0a8931e`)에서 구현하고(구현 Codex, 검증 본 리뷰어), 빌드된 앱으로 독립 E2E를 수행했다. **정적 결함은 대부분 해소·게이트 통과했으나, 실기기 E2E에서 정적 리뷰가 못 잡은 신규 Critical(아래 §0)이 드러나 파일럿 freeze는 여전히 불가.** 상세는 `docs/research/conference-poster/evidence/student-e2e-2026-06-10.md`. 본문 §1~§8은 최초 `main @ b886f2e` 기준 기록으로 보존하고, 변경점은 §0과 각 항목의 **[수정됨]** 마커로 표기.

---

## 0. 수정 라운드 결과 요약 (2026-06-10 추가)

### 0-1. 해소·검증된 항목

| 항목 | 상태 | 검증 |
|---|---|---|
| Critical-1 승인 카드 소실 | ✅ **수정+E2E PASS** | `pending_tool_calls` IPC + FE 재수화. 실기기 Probe A: pending 중 이탈→복귀 시 카드 재수화 확인 |
| Critical-2 동시 턴 가드 | ✅ 수정+단위 PASS / 🟡 GUI BLOCKED | `ActiveTurnGuard` + 단위 테스트. 실기기에선 sidecar 타임아웃으로 live 동시턴 선결조건 미성립(가드 실패 아님) |
| Critical-4 freeze 게이트 | ✅ **수정** | `verify:product-flow` 21/21 PASS 복구, 죽은 컴포넌트 삭제 |
| Major-1~4, Minor m1~m6 | ✅ 수정 | 리스너 race, envelope 가드, 점프 배너, panic fallback, 설문 라우트, 익명화 표현 등. 게이트 green |
| 출시급(배치 D) | 🟡 코드 추가 | 인스톨러 smoke CI·a11y 스크립트 — Windows 러너 실증 미완 |
| 전 CI 게이트 | ✅ green | cargo fmt/clippy/test(lib 342, 0 fail), prettier/tsc/eslint, verify:product-flow 21/21, i18n 663/663 |

### 0-2. 🔴 신규 Critical-5 — Pi 턴 타임아웃(120초)이 인간 승인 시간을 포함 (정적 리뷰 미포착, E2E로 발견)

`PI_TURN_TIMEOUT=120s`가 턴 시작부터의 **벽시계 예산**이고, 인간 승인 대기(`execute_supervised_tool_call`)가 이 타이머와 같은 `tokio::select!`에서 경합한다 (`dive/src-tauri/src/pi_sidecar.rs:30, 200-203, 693, 742-744`). → **학생이 승인 카드를 숙고하는 시간이 턴 예산을 깎고, 120초를 넘기면 승인 대기 중이던 write가 폐기된다.** 실기기 로그에서 정확히 120초 간격으로 2회 재현, 학생 산출물(index.html/style.css/app.js) **0개**로 빌드 STALLED.

이것은 DIVE의 핵심 교수 원리("의도적 판단 지점에서 시간을 들여 감독")와 **런타임이 정면충돌**하는 설계 결함이다 — 감독을 열심히 할수록 작업이 죽는다. 수정: 승인 대기 구간을 턴 예산에서 제외(타이머 일시정지) 또는 모델-idle 타임아웃과 인간-승인 타임아웃 분리. **이것이 Critical-3(학생 산출물 도달) 미해소의 직접 원인이며, freeze 전 필수.**

### 0-3. 갱신된 판정

| 기준 | 판정 |
|---|---|
| 교실 파일럿 투입 (freeze) | 🔴 **여전히 불가** — Critical-5(턴 예산) + Critical-3(산출물 미입증) |
| 남은 freeze 차단 | Critical-5 수정 → 재 E2E로 학생 산출물 green 입증 (그 외 정적 Critical은 모두 해소) |

### 0-4. 수정 라운드 2 결과 (2026-06-10 오후, `2e9381c`·`1fb0855` — 실기기 재검증 완료)

| 항목 | 상태 |
|---|---|
| **Critical-5 턴 예산** | ✅ **수정 + E2E PASS** — 승인 숙고 포함 턴 정상 완료, 타임아웃 0회, 회귀 테스트 고정 |
| **Critical-3 학생 산출물** | 🟡 **부분 해소** — index.html/style.css/app.js 실생성 입증(디스크 확인). 단 전체 5-step 완주는 신규 F2가 차단 |
| 인터뷰 JSON 채팅 노출(사용자 지적) | ✅ 수정(구조 감지) + E2E PASS — 대화형 수락 경로 포함 |
| envelope 하드거부→재시도(사용자 지적) | ✅ 수정(sanitize) + E2E PASS — 계획 첫 시도 생성 |
| **🟠 신규 F2** | 정상 경로에서 step이 verified/판단형 승인에 도달 불가 — `handleVerify`가 복구 경로에만 배선(`useProductShellController.ts:646,940`). 핵심 학습 장치가 happy path에서 비활성. UX 결정 필요 |
| **🟡 신규 n1** | Pi sidecar의 node PATH 의존 — GUI 기동 시 sidecar spawn 실패. `externalBin` 번들 통합이 freeze 전 필요 |
| 갱신 freeze 잔여 | **F2 배선 + n1 externalBin + 전체 5-step 완주 green E2E** (상세: `evidence/student-e2e-2026-06-10.md` Run 2/3) |

### 0-5. 수정 라운드 3 결과 (2026-06-10 저녁, `51d0110`·`728e6b9` — Run 4 검증)

| 항목 | 상태 |
|---|---|
| **🟠 F2 verify 게이트** | ✅ **수정 + 검증** — 빌드 완료 시 `enter_instruct→request_verify→card_verify` 자동 구동 후 step detail 자동 표면화(`useProductShellController.ts`, isStreaming 하강 엣지·Pi는 Done 미emit이라 런타임 무관). E2E: 게이트 자동 표출 PASS(204), DB Card 3 `verified`+`approved` 영속 확인. **사용자 선택=자동 표면화** |
| **F2 후속(intent_match=false 승인)** | ✅ **수정** — `card_verify`가 의도 불충족(주장) 보고 시 인간 명시 승인(확인함/그래도 승인)이 막히던 것을, honest-verify 논지(AI 자가보고는 *주장*, 인간이 최종 평가자)에 따라 approveForce로 override(`728e6b9`). judgment 필수는 유지, 맹목 승인은 anti-metric으로 측정 |
| **Critical-3 골든패스** | 🟡 **단일 step 완주 입증(DB verified+approved), 풀 5-step green E2E는 깨끗한 환경에서 1회 더 필요**(Run 4는 stale 파일 오염으로 단일 step까지만 깨끗) |
| **🔴 n1 → Critical 격상** | 릴리스 번들에 **`dive-pi-sidecar` 바이너리 누락**. 패키징 앱엔 `node <script>` 폴백 스크립트 경로도 없음 → 릴리스에서 Pi 런타임 전면 불통(검증자 수동 복사 후 동작). in-tree dev에선 폴백이 동작해 미노출됐던 것. **externalBin 번들 통합이 freeze 전 필수 Critical** |
| 갱신 freeze 잔여 | **n1(externalBin 번들) + 깨끗한 환경 풀 5-step green E2E**. (정적 Critical·F2·사용자 지적·Critical-5 모두 해소) |

### 0-6. 수정 라운드 4 (2026-06-10 야간, `311cab0`·`a446057`)

| 항목 | 상태 |
|---|---|
| **승인 plan 막다른 길 (사용자 발견)** | ✅ **수정 + 검증** — 승인된 plan이 있는 프로젝트에서 새 인터뷰 완료 시 하드 에러 대신 교체 확인 모달(`PlanReplaceConfirmModal`). 백엔드 `replace_approved` 플래그(opt-in cascade 삭제), 거부 기본 유지. 회귀 테스트 추가. 사용자 GUI 확인("project 6에서 잘 된다"). `311cab0` |
| **🔴 n1 externalBin → 해소** | ✅ **수정 + end-to-end 검증** — `externalBin`을 base `tauri.conf.json`에 두되, **모든 cargo 잡(빌드뿐 아니라 lint/test)에서 sidecar를 먼저 빌드**해 `build.rs`의 externalBin 검증이 통과하도록 CI를 배선(`.github/workflows/build.yml`·`release-gate.yml`에 "Build Pi sidecar … cargo checks" 선행 스텝). `build:sidecar`가 `install:sidecar`(npm ci)+SEA 빌드로 묶임, Node 22.19.0 고정. 번들에 `dive-pi-sidecar` 자동 포함 확인, 전체 cargo test 0-fail. 130MB 바이너리 gitignore 유지. (병행 작업 `a9d1e7f`와 reconcile — 본 리뷰어의 오버레이 방식은 중복으로 폐기) |
| **갱신 freeze 잔여** | **깨끗한 환경 풀 5-step green E2E 1회**(증거 캡처)만 남음. 모든 Critical(1·2·3·4·5)·F2·n1·사용자 지적 전부 해소 — freeze 후보 도달 임박 |

---

## 1. 한 줄 결론

**코드 품질·보안·교육 설계의 코드 구현은 기대 이상으로 견고하지만, 제품의 심장인 "승인 게이트"가 화면 전환 한 번에 영구히 사라지는 결함(6/8 QA의 B2)이 HEAD에 그대로 살아 있고, 자체 freeze 게이트(`verify:product-flow`)도 현재 깨져 있어 — 파일럿 freeze는 아직 불가.** 이 결함과 그 파생(동시 턴 실행)을 고치고 실제 빌드 E2E를 한 번 green으로 통과시키면 파일럿 투입 가능 수준이다.

| 기준 | 판정 |
|---|---|
| 목적 적합성 (감독 역량 학습 환경) | ✅ 설계 원칙이 코드에 실제로 구현됨 |
| 빌드/테스트 건강도 | ✅ 전 게이트 green (아래 §3) |
| 교실 파일럿 투입 (freeze) | 🔴 **불가** — Critical 3건 + freeze 게이트 red |
| 일반 사용자 제품 출시 | 🔴 불가 (서명·인스톨러 smoke·a11y 등은 의도적 비범위 — 명세 §8과 일치) |

---

## 2. 목적 적합성 — "기능 명세의 주장이 코드에 실재하는가"

연구의 핵심 주장(자동화 편향 방지 설계)이 마케팅 문구가 아니라 실제 코드로 존재함을 확인했다. 이 부분은 학회 발표에서 자신 있게 주장해도 된다.

- **승인 = 판단**: `ApprovalJudgment` FE/Rust 양쪽 타입 존재, `require_approval_judgment` 기본 ON (`src-tauri/src/ipc/policy.rs`).
- **정직한 검증 라벨**: `intent_match`를 "AI 자가보고: 의도 충족(주장)"으로, `skipped`를 "외부 테스트 없음"으로 표기 (`src/i18n/ko.json`). `skipped`를 검증 완료로 위장하지 않음.
- **계획 비평 rep**: 승인 전 비평 단계가 approve 버튼을 실제로 차단 가능 (`PlanDraftApprovalScreen.tsx`).
- **실행 envelope**: 턴당 10 iteration, `run_process` 60초 상한·셸 금지·16KB 절단 — 명세 §6-B와 일치.
- **Pi 감독 불변식**: sidecar의 도구 호출이 DIVE allowlist 검증(`expected_tools.contains`)을 거쳐 Rust가 실행자가 됨. 빌트인 우회 없음. 크래시 후 자동 재실행 없음(테스트로 고정).
- **텔레메트리 없음**, 키는 OS keyring, 미성년 대상 설계와 정합.

단, §5의 교육 타당도 관점에서 보면 **아래 Critical-1이 곧 "교육 사고" 유형의 결함**이다: 학생이 승인 게이트 자체를 잃어버리면 감독 연습 루프가 끊기고, "DIVE가 멈췄다"는 경험은 신뢰 보정 학습을 왜곡한다. 제품 버그이자 연구 타당도 리스크로 취급해야 한다.

---

## 3. 검증 실행 결과 (2026-06-10, 본 리뷰에서 직접 실행)

| 게이트 | 결과 |
|---|---|
| `cargo fmt --check` | ✅ PASS |
| `cargo clippy --all-targets --features dev-mock -- -D warnings` | ✅ PASS |
| `cargo test --all-targets --features dev-mock` | ✅ PASS (0 failed) |
| `pnpm format:check` / `typecheck` / `lint --max-warnings 0` | ✅ PASS |
| ko/en i18n key parity | ✅ 661/661, drift 0 |
| **`pnpm verify:product-flow`** (freeze 게이트) | 🔴 **FAIL — 21개 중 1개 실패** (아래 Critical-4) |

---

## 4. 버그 및 결함

### 🔴 Critical-1 — pending 승인 카드가 화면 전환/재진입 시 영구 소실 (6/8 QA B2의 근본 원인, HEAD에 그대로 존재)

원인 체인 (전부 코드로 확인):

1. 백엔드는 승인을 **in-memory oneshot 채널**로 무기한 대기한다 — `PendingApprovals`(`src-tauri/src/agent/permission.rs:239-273`), `AwaitUserHook::intercept`의 `rx.await`(타임아웃 없음, `permission.rs:294-299`).
2. 세션 재진입 시 UI는 `message_list`로 히스토리를 복원하는데, `history_message_from_row`(`src-tauri/src/ipc/mod.rs:896-917`)는 **`user`/`assistant`/`system`만 매핑하고 tool_call 행을 버린다.**
3. pending 승인을 다시 UI로 보내주는 IPC·재방출 경로가 **존재하지 않는다** (전수 검색으로 확인).

→ 결과: 로드맵 RESUME(=`selectSession`, `PlanDashboardPanel.tsx:92-118`), 세션 전환, 화면 이동, 앱 재시작 어느 것이든 채팅 뷰가 리마운트되면 승인 카드가 사라지고, 백엔드 루프는 영원히 대기한다. 6/8 QA에서 관찰된 "mkdir warn 승인 대기 + 카드 안 보임 + step 진행 중 고착"과 정확히 일치한다. **이후 커밋(#9~#14)은 이를 고치지 않았다.**

수정 방향(권고): `pending_approvals`에 메타(tool, params_preview, risk, args, session_id)를 함께 보관하고 ① 세션 mount 시 `pending_tool_calls(session_id)` IPC로 내려주거나 ② `message_list`가 tool_call 행(상태 포함)을 복원하게 한다. 둘 중 ①이 더 작고 안전한 변경.

### 🔴 Critical-2 — 동시 턴 실행 가드 부재: stall 상태에서 메시지를 보내면 같은 세션에 에이전트 루프가 2개 돈다

- `chat_send`(`src-tauri/src/ipc/mod.rs:1019-1145`)에는 세션별 "턴 진행 중" 가드가 없다.
- 프런트의 입력 차단은 컴포넌트 state(`isStreaming`)뿐이라 리마운트되면 풀린다(`useChatSession.ts`). 즉 Critical-1 상황에서 사용자가 "계속해줘"를 보내면(6/8 QA 스크린샷 012가 정확히 이 행동) 첫 턴이 승인 대기 중인 채로 **두 번째 루프가 병행 실행**된다.
- 게다가 `state.cancels.insert(session_id, …)`가 첫 턴의 취소 토큰을 **덮어써** 첫 턴은 취소 불가능해지고, 두 번째 턴 종료 시 `remove`로 맵이 비어 정합성이 깨진다 (`ipc/mod.rs:1076-1079, 1146-1149`).

수정 방향: 세션별 turn-lock(이미 있는 `cancels` 맵을 occupied 체크로 활용 가능). 진행 중이면 "승인 대기 중인 작업이 있습니다" 에러 + pending 카드 재표시로 연결하면 Critical-1 UX 회복과 맞물린다.

### 🔴 Critical-3 — 마지막 실기기 E2E 판정이 "blocked"인 채로 미갱신 — 학생 골든패스가 입증되지 않음

- 6/8 built-app E2E(`evidence/student-e2e-computer-use-2026-06-08.md`)의 verdict: **freeze candidate: blocked**. 학생이 실제 프로그램 파일을 하나도 만들지 못한 채 종료.
- 이후 B1(OpenRouter가 Legacy로 라우팅)은 커밋 #9(`parity.rs` allowlist에 OpenAI/Anthropic/OpenRouter 추가)로 해소됐고, #10·#12가 그 과정에서 드러난 sidecar 결함을 고쳤다 — 그러나 **수정 후 green E2E 증거가 없다** (evidence 폴더의 020~023 스크린샷은 sidecar 오류→패치 과정만 담고 있고 보고서는 미갱신).
- 명세 §6-B의 정직성 원칙("allowlist 확장은 실키 end-to-end 스모크 통과 후")과 비교하면, 현재 allowlist 확장은 SDK probe(`getModel` 해석) 기반으로 선행된 상태다.

수정 방향: QA 보고서의 "Next Iteration Targets" 4번 그대로 — 작은 통제 과제(index.html/style.css/app.js 정적 퀴즈 앱)로 재실행해 "학생이 실행 가능한 산출물 도달"을 증거로 남길 것. 이것이 freeze의 전제 조건.

### 🔴 Critical-4 — 자체 freeze 게이트 `verify:product-flow`가 HEAD에서 깨져 있음

- 실패 체크: "tool permission approval path renders permission cards and calls approve/deny IPC" — 검증기가 `MessageList`에서 `<ToolCallMessage`를 찾는데(`scripts/verify-product-flow.mjs:270-285`), 커밋 #11 재설계로 실제 렌더러는 `<ToolActivity>`로 바뀌었다.
- 실제 승인 경로는 `ToolActivity`에 존재하므로 제품 결함이 아니라 **검증기 stale**이지만, 파일럿 freeze 절차가 이 검증기 통과를 요구하므로 절차상 freeze 불가 상태다. 또한 #11이 게이트 red인 채로 merge됐다는 뜻이라 프로세스 구멍이기도 하다.
- 부수 발견: `ToolCallMessage.tsx`/`ToolResultMessage.tsx`는 제품 경로에서 더 이상 쓰이지 않는다(mock 데모와 index export만 잔존). 죽은 코드 정리 대상.

### 🟠 Major-1 — 이벤트 리스너 등록 전 이벤트 유실 race

`useChatSession.ts:232-264`: `message_list` await **후에** `api.listen`을 등록한다. 진행 중인 턴에 재진입하면 히스토리 로드와 리스너 등록 사이에 도착한 이벤트(delta, tool_call_start 등)가 유실된다. 리스너를 먼저 등록하고 버퍼링 후 히스토리와 병합하는 순서로 바꿔야 한다. (Critical-1과 결합하면 재진입 UX가 이중으로 깨진다.)

### 🟠 Major-2 — `DIVE_RUNTIME=pi` + 미지원 프로바이더 = panic

`select_runtime`은 `Some("pi")`이면 무조건 Pi를 반환하고(`ipc/mod.rs:974-986`), 호출부는 `.expect("select_runtime guarantees eligibility")`로 descriptor를 푼다(`ipc/mod.rs:1108-1109`). OpencodeZen/CustomOpenAi에서 env override 시 **panic**. dev escape라지만 파일럿 PC에 env가 남아 있으면 앱이 죽는다. graceful 에러나 legacy fallback으로 바꿀 것 (1줄 수정).

### 🟠 Major-3 — 계획 생성에 실행 envelope 가드가 없음 (6/8 QA B4 → B3의 구조적 원인)

인터뷰→계획 생성 경로(`workspace_plan.rs`)에 step 수·검증 명령 실행시간·작업 규모에 대한 어떤 제약/경고도 없다. 6/8 QA에서 "일정 관리 데스크톱 앱(CRUD+알림+캘린더)" 같은 envelope를 초과하는 계획이 그대로 승인 단계까지 갔다. 제품이 스스로 "완성 격차"를 만드는 구조다. 최소한 ① step 수 상한 경고 ② 인터뷰 프롬프트에 envelope 명시(60초·셸 없음 작업으로 분해) ③ 파일럿 과제 카탈로그 중 하나는 필요하다.

### 🟠 Major-4 — 승인 카드로의 시선 유도 부재

`MessageList.tsx`: 사용자가 위로 스크롤해 있으면(autoScroll off) 새 승인 카드가 viewport 밖에 생기고, sticky "승인 대기 중" 배너나 점프 버튼이 없다. 6/8 QA의 "카드가 화면에 안 보임"의 UI 측면. 입력창 위 고정 배너 + 클릭 시 카드로 스크롤을 권고.

### 🟡 Minor

| # | 내용 | 위치 |
|---|---|---|
| m1 | 설문 라우트가 DEV 빌드 전용(`import.meta.env.DEV`) — 릴리스 빌드에서 학생이 SUS/NASA-TLX 설문에 접근 불가. 연구 측정 프레임(연구개요 §6) 의존 항목 | `src/App.tsx:17-21,73` |
| m2 | 45초 stall 타이머가 승인 후 장시간(45~60초) 도구 실행 중 거짓 "응답 지연" 에러를 띄울 수 있음 (`tool_call_approved`가 타이머를 재무장) | `useChatSession.ts:199-261` |
| m3 | 파일럿 체크리스트가 stale 인스톨러 파일명(`dive_0.0.1_*-setup.exe`) 안내 — 현재 1.0.0-rc.2 | `docs/pilot-checklist.md` |
| m4 | export 익명화는 "user_text/file_paths/ids 해시"이지 임의 event payload 전체 해시가 아님 — 연구 문서의 표현을 좁혀야 함 (6/8 감사 P1 항목, 미반영) | `src-tauri/src/export/anonymize.rs` |
| m5 | `ToolActivity.tsx:201-207`의 AssistantDelta 이벤트 재생성-재구조분해 패턴 등 소소한 가독성 잡티 | `ToolActivity.tsx` |
| m6 | 인터뷰 시스템 프롬프트가 locale 무관 한국어 본문 — en locale 학생에게는 모델의 지시 준수에만 의존 | `src-tauri/src/dive/plan_interview.rs:24-43` |

---

## 5. 보안 검토 (교실·미성년 환경 기준)

전반적으로 **강함**. 별도 지적 사항 없이 통과한 항목:

- **경로 샌드박스** `FsGuard`: 절대경로·`..` 탈출·심링크 traversal 차단 + 쓰기 직전 부모 디렉터리 재검증(TOCTOU 대응) + Windows 경로 문자열(`\\?\`, ADS `:stream`) 교차 차단 + `.git` 쓰기 차단. 테스트로 고정됨 (`src-tauri/src/tools/fs_guard.rs`).
- **명령 가드**: `rm -rf`/fork bomb/`curl|bash`/`sudo` 차단, 셸 메타문자·셸 실행파일 자체 거부 (`tools/guard.rs`, `tools/run_process.rs`).
- **자격증명**: OS keyring 보관, sidecar에는 stdin JSON으로만 전달(argv/env 노출 없음), OAuth 임시 디렉터리 0700 + Drop 시 삭제, 로그 redaction (`pi_sidecar.rs:243-309`).
- **Pi 불변식**: 빌트인 도구 비활성, DIVE 커스텀 도구만, sidecar 도구 호출은 Rust 측 allowlist 재검증.
- 외부 텔레메트리 없음 (로컬 파일 로깅만).

---

## 6. 제품화 준비도 판정

### 교실 파일럿(freeze) 기준 — 🔴 현재 불가, 그러나 근거리

freeze 전 필수(P0) 작업과 예상 규모:

| # | 작업 | 근거 | 규모 |
|---|---|---|---|
| 1 | pending 승인 재수화 (IPC 또는 message_list 복원) | Critical-1 | 중 (1~2일) |
| 2 | 세션별 동시 턴 가드 + cancel 맵 정합성 | Critical-2 | 소 |
| 3 | `verify-product-flow.mjs` ToolActivity 반영 + 죽은 컴포넌트 정리 | Critical-4 | 소 |
| 4 | 작은 통제 과제로 built-app E2E 재실행 → green 증거 문서화 | Critical-3 | 실행 1회 |
| 5 | 실키 Pi 스모크(OpenAI/Anthropic/OpenRouter) 증거화 또는 allowlist 축소 | 명세 §6-B 정직성 원칙 | 실행 1회 |
| 6 | `DIVE_RUNTIME=pi` panic 제거 | Major-2 | 1줄 |

P1(파일럿 품질): Major-1(리스너 race), Major-3(envelope 가드 — 최소 파일럿 과제 카탈로그로 대체 가능), Major-4(승인 배너), m1(설문 라우트 릴리스 노출 또는 지면 설문 결정), m3(체크리스트 버전 정정).

### 일반 제품 출시 기준 — 🔴 불가 (의도된 상태)

Windows 서명·SmartScreen·인스톨러 published smoke·풀 a11y·대형 프로젝트 robustness(S-005 P4)는 명세 §8이 명시적으로 비범위로 선언했고 코드 상태도 그와 일치한다. "학회 데모 + 통제된 교실 파일럿용 연구 도구"로 포지셔닝하는 한 문제없으며, 포스터에서 자율 코더 경쟁자로 과대주장하지 말라는 명세 §6-B의 자기 경고를 유지하면 된다.

---

## 7. 잘 된 점 (유지할 것)

1. **명세-코드 정합 문화**: spec-conformance audit(6/8) 같은 자기 감사 문서, 정직성 원칙(검증 라벨, "기능 존재 ≠ 학습효과" 구분)이 코드 리뷰 관점에서도 실제로 지켜지고 있다.
2. **테스트 표면**: Rust 테스트 417+개, 크래시 후 비재실행·취소·패리티 같은 감독 불변식이 테스트로 게이트됨.
3. **보안 레이어 깊이**: 단순 차단 목록이 아니라 TOCTOU 재검증까지 들어간 샌드박스는 이 규모 프로젝트에서 드물다.
4. **i18n 위생**: key parity drift 0.
5. **Pi 임베드 아키텍처**: "엔진이 아니라 도구·안전 레이어 소유가 경쟁점"이라는 결정이 코드 구조(Rust가 실행자, sidecar는 brain)로 정확히 구현됨.

---

## 8. 종합

DIVE는 "감독 역량 학습 환경"이라는 목적에 대해 **설계와 구현이 정합하는, 연구 도구로서 신뢰할 수 있는 코드베이스**다. 남은 문제는 분산된 품질 문제가 아니라 **단일 임계 경로(승인 대기 → 화면 전환 → 영구 stall)에 집중**되어 있고, 그 경로는 이미 6/8 QA가 정확히 짚었다. P0 6건은 상호 독립적이고 규모가 작으므로, 집중하면 수일 내 freeze 후보에 도달할 수 있다. 반대로 이 경로를 고치지 않고 파일럿에 들어가면 — 25명 중 누군가는 반드시 step 고착을 겪고, 그것은 버그 리포트가 아니라 연구 데이터 오염과 "신뢰 보정 학습 왜곡"으로 돌아온다.
