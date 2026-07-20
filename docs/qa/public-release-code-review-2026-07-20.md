# DIVE 공개 전환 대비 전체 코드 리뷰 (2026-07-20)

## 개요

- **목적**: 학회 발표와 동시에 repo를 public으로 전환하기 전, 외부 개발자의 "코드가 개판/비효율" 류 비판을 받을 지점을 전수 조사.
- **방법**: 14개 영역(Rust 7 · Frontend 3 · 시크릿/위생/의존성/데드코드 4) 병렬 리뷰 → 발견사항 124건 전건을 별도 검증 에이전트가 실제 코드 대조로 반박 시도(adversarial verification). 총 149개 에이전트, read-only.
- **대상**: Rust 74k줄 + TS/TSX 55k줄 (~130k줄) + repo 위생/히스토리/CI/의존성.
- **결과**: **CONFIRMED 124건 (P0 2 · P1 35 · P2 87)**, PLAUSIBLE 5건, 기각(REFUTED) 1건, 검증 미완 5건(세션 한도 — 이 중 3건은 루트에서 직접 재확인).

### 총평

기반 품질은 예상보다 좋다. 시크릿은 작업 트리·전체 히스토리 모두 **실키 0건**으로 이례적으로 깨끗하고, 보안 핵심부(FsGuard 심링크/TOCTOU 재검증, egress_guard DNS 리바인딩 방어, providers/auth의 키링+리댁션)는 수준급이며, 디버그 잔재(println!/dbg!/console.log/TODO 방치)가 사실상 전무하다. 프론트 중복률도 0.82%(jscpd)로 낮다.

다만 공개 시 비판이 집중될 표면이 뚜렷하다:

1. **하드 블로커 1건**: 저작권 있는 학술논문 PDF 18개(30MB)가 추적·히스토리·origin/main에 존재 → 히스토리 재작성 필수.
2. **거대 파일 6개**: workspace_plan.rs 7,724줄, supervisor.rs 4,217줄, pi_sidecar.rs 3,794줄, agent/mod.rs 3,227줄, useProductShellController.ts 2,365줄, StepDetailSlideIn.tsx 1,858줄.
3. **데드코드 은폐**: crate 루트 `#![allow(dead_code)]`가 `clippy -D warnings` 게이트를 무력화하며 죽은 코드 10건+를 숨김. Tauri 템플릿 `greet` 잔재 포함.
4. **복붙 중복**: loadTauri 헬퍼 18벌, 툴 승인 파이프라인 2벌(370줄), 사이드카 spawn 루프 4벌.
5. **일회성 잔재**: dive/scripts/ 44개 중 23개(~3,000줄)가 미참조 스프린트 잔재.

---

## P0 — 공개 전 반드시 처리 (하드 블로커)

### P0-1. 저작권 학술논문 PDF 18개(30MB)가 git 추적 + 히스토리 + origin/main에 존재

- `docs/research/conference-poster/references-pdf/` — ACM(Wing2006, Bucinca2021, Loksa2016, Kazemitabaar2023, Prather2024, Drosos2025), Elsevier(Bainbridge1983), Sage(Lee2004), Taylor&Francis(Reiser2004), O'Reilly류(Osmani2026, 단일 9.7MB) 등 **유료 출판사 논문 전문 18개, 총 30MB**.
- `git ls-tree origin/main`으로 원격에도 push 확인. 무관한 기능 커밋 `29d639f`(add -A 사고)로 유입. 이 PDF를 참조하는 추적 문서 0건 — repo 기능상 불필요.
- public 전환 즉시 무단 재배포 = DMCA takedown 대상. Dhanorkar2026 PDF 메타데이터에는 저자 개인 이메일도 포함.
- **처리**: 트리에서 삭제 + DOI/공식링크 목록 `references.md`로 대체 + **git filter-repo로 히스토리 퍼지** (.git 158MB → 클론 무게도 해소). 2026-06-11 185MB PNG 제거 때 히스토리 재작성 선례 있음.
- **같은 재작성 패스에서 함께 결정할 것**: ① 커밋 author 개인 이메일(kokyuhyun@hotmail.com) 공개 여부, ② 추적 문서 15개의 개인 홈 경로(~, ~) 정리 여부.

---

## P1 — 외부인이 보면 비판할 품질 문제 (35건, 테마별)

### A. 라이선스·위생·문서 (공개 직결, 수정 쉬움)

| # | 위치 | 내용 |
|---|------|------|
| A1 | `dive/src/assets/fonts/` | **OFL 폰트 3종(Pretendard, JetBrains Mono) 라이선스 고지 전무** — OFL은 재배포 시 라이선스 사본 동봉 요구. 루트 LICENSE는 MIT뿐. LICENSE-*.txt 추가 + THIRD-PARTY-NOTICES 필요 |
| A2 | `.gitignore:36` | **내부 KACE 전략 문서(07~10-*.md, 최종논문 hwpx, release-readiness/)가 로컬 전용 `.git/info/exclude`로만 차단** — 이 머신에서만 유효. `.orca/`, `.playwright-mcp/`, `decks/`, `.pnpm-store/`, `*.pptx` 등도 ignore 미등록. PDF 30MB가 실제로 이 패턴(add -A)으로 유입된 전례 |
| A3 | `dive/README.md:5`, 루트 `README.md:10` | **두 README 모두 버전 표기 드리프트** — dive/README는 rc.2(7릴리스 전), 루트 배지·로드맵은 rc.6, 실제는 rc.9. 단, release gate가 하드-read하는 마커 줄(rc.2 production wiring 등)은 보존하며 수정할 것 |

### B. 거대 파일 / 갓-모듈 (구조 분할 — 가장 큰 "개판" 인상 요인)

| # | 위치 | 내용 |
|---|------|------|
| B1 | `dive/src-tauri/src/ipc/workspace_plan.rs` | **7,724줄 단일 파일에 7개 관심사** (커맨드 28개, PRD 인터뷰 프롬프트, JSON 샐비지 파서, 패치 검증, plan CRUD, 대시보드, 품질 린트 + 인라인 테스트 1,520줄). S-033/S-047/S-050 주석 경계 그대로 서브모듈 분리 가능 |
| B2 | `dive/src-tauri/src/dive/supervisor.rs` | **4,217줄** (구현 2,580 + 테스트 1,636). context/evidence/decision/card/prompt로 분할 권장 |
| B3 | `dive/src/components/product/useProductShellController.ts:427` | **2,365줄 갓-훅** — useState/useRef 25개, useCallback/useMemo 54개, 훅 안에서 createElement로 뷰까지 생성 |
| B4 | `dive/src/components/product/StepDetailSlideIn.tsx` | **1,858줄** — 리사이즈 훅 + 재시도 지문 + 요청 빌더 3종 + 증거 게이트 + 서브컴포넌트 10개 혼재 |
| B5 | `dive/src/hooks/useChatSession.ts:534` | **1,537줄 갓-훅** — AgentEvent 타입 150줄 + 리듀서 350줄 + 채팅과 무관한 카드/체크포인트 IPC 래퍼까지 혼재. 3분할 시 본체 400줄 이하 |

### C. 데드코드 (삭제만 하면 되는 최고 가성비)

| # | 위치 | 내용 |
|---|------|------|
| C1 | `dive/src-tauri/src/lib.rs:1` | **crate 루트 `#![allow(dead_code)]`** — `clippy -D warnings`를 자랑하면서 데드코드 린트는 통째로 꺼놓은 조합. `--force-warn dead_code` 실측 시 경고 10건 은폐 중 |
| C2 | `dive/src-tauri/src/lib.rs:31` | **Tauri 템플릿 잔재 `greet` 커맨드**("Hello, {}! You've been greeted from Rust!")가 invoke_handler에 등록. 프론트 호출 0건 |
| C3 | `dive/src-tauri/src/agent/mod.rs:227` | **프로덕션 호출자 없는 ~800줄 레거시 인프로세스 에이전트 루프**(`AgentLoop::run`/`stream_assistant`) — 라이브 supervised 경로와 ~500줄 중복이며 이미 드리프트(S-032 체크포인트가 한쪽에만 있음) |
| C4 | `dive/src-tauri/src/ipc/assist.rs:52` | **호출자 없는 데모/디버그 IPC 커맨드가 프로덕션 표면에 노출** — openrouter_revoke_all/list_keys(마스터 키를 받는 API!), pi_sidecar_codex_smoke. dev-mock feature로 강등 또는 삭제 |
| C5 | `dive/src-tauri/src/ipc/state.rs:410` | 확정 죽은 함수들 — hydrate_provider_runtime, chat.rs:328 select_runtime, LateAfterFinalization variant |
| C6 | `dive/src/components/product/RationaleChallengePanel.tsx` | **230줄 컴포넌트 + 컨트롤러→레이아웃→RoadmapRail 배선 전체가 유령 기능** (PlanView가 안 읽음). RoadmapHost.tsx도 import 0건 |
| C7 | `dive/src/features/planning/prdPatch.ts:145` | **253줄 PRD 패치 검증이 프론트에서 호출 0건** — Rust에 1:1 미러 정본이 별도 존재, 상수 어긋나도 감지 불가. 삭제 권장 |
| C8 | `dive/scripts/` | **44개 중 23개(~3,000줄)가 어디서도 참조 안 되는 일회성 스프린트 잔재** (verify-chat, verify-codex-oauth, simulate-25-users 등) |

### D. 복붙 중복 (기계적 통합 가능)

| # | 위치 | 내용 |
|---|------|------|
| D1 | `dive/src/lib/tauri.ts:6` | **동일 loadTauri 헬퍼가 18개 파일에 복붙** — 정본 import는 단 2곳. 기계적 치환으로 수백 줄 제거 (fe-core/fe-features/deadcode-dup 3개 리뷰어가 독립적으로 발견) |
| D2 | `dive/src-tauri/src/agent/mod.rs:1153` | **보안 핵심인 툴 승인 파이프라인이 같은 파일에 두 벌(~370줄)** — run() 인라인 루프 vs execute_supervised_tool_call. 한쪽만 고치면 승인 정책이 조용히 갈라지는 구조 (C3 삭제 시 함께 해소) |
| D3 | `dive/src-tauri/src/pi_sidecar.rs:717` | **사이드카 spawn+stderr 수집 블록 4벌, JSONL 이벤트 read-loop 3벌** — spawn_sidecar 헬퍼 추출로 ~120줄 제거 |

### E. 실질 버그 (correctness)

| # | 위치 | 내용 |
|---|------|------|
| E1 | `dive/src-tauri/src/agent/mod.rs:2087` | **히스토리 로드가 '가장 오래된 200개'를 유지하고 최신을 버림** — `ORDER BY created_at, id LIMIT ?` 오름차순+LIMIT. 라이브 pi_sidecar 턴이 실사용하는 경로로, 200개 초과 세션에서 방금 입력한 메시지도 잘림 |
| E2 | `dive/src/components/product/ProductShellLayout.tsx:204` | **StepDetailSlideIn을 open일 때만 마운트 → 패널 닫으면 검증 증거 로컬 state(diff 열람·관찰 기록) 전부 소실**, S-029 게이트가 처음부터 다시 요구됨. 닫힘 애니메이션 CSS도 도달 불가 |
| E3 | `dive/src/pages/settings.tsx:253` | **API 키 연결 실패가 완전 무음** — catch 없음 + 스토어 error 필드를 렌더하는 컴포넌트 0개. 초보자 대상 도구의 주 설정 화면 |
| E4 | `dive/src/components/product/PlanAddStepPanel.tsx:631` | **단계 추가·관찰 기록 실패가 무통보** — catch 없는 async 핸들러 3곳 (PlanAddStepPanel, VerificationCoachPanel:215, ProductShellLayout:96) |
| E5 | `dive/src-tauri/src/tools/multi_replace.rs:502` | **stage_writes 실패 시 cleanup이 증명 가능한 no-op** (항상 빈 벡터 청소) — 임시파일 `.dive-multi-replace-*.tmp/.bak`이 학생 프로젝트에 잔류 |
| E6 | `dive/package.json:40` | **verify:version-sync가 rc.7 하드코딩으로 현재 실행 시 FAIL 4건** — 살아있는 문서가 이 커맨드 실행을 지시 중. 자매 이슈: verify-version-sync.mjs 632줄이 특정 날짜의 diffstat·SHA를 박제 검증(§4 wilyChecks 블록) |
| E7 | `dive/src/features/provocation/adapters.ts:92` | **파일 위험도 분류기 두 벌 + 라이브 경로 정규식 부분문자열 오탐** — `AuthorCard.tsx`가 'auth'로, `packages/` 전체가 routing으로 분류돼 근거 없는 high_risk 카드 사유 생성 (node로 재현 확인됨) |

### F. 보안 (P1급)

| # | 위치 | 내용 |
|---|------|------|
| F1 | `dive/src-tauri/src/tools/run_process.rs:73` | **run_process가 자매 도구(terminal_script)는 차단하는 env 덤프·.env 읽기를 통과시킴** — `{"command": "env"}` 한 번에 앱이 상속한 전체 환경변수(API 키 포함 가능)가 LLM으로 전송. env_clear/env_remove 부재 |
| F2 | `dive/src-tauri/src/pi_sidecar/transport.rs:188` | **redact_line이 JSON 라인에서 no-op** — 공백 분리 토큰 전체 매치 방식이라 컴팩트 JSON(`{"access":"eyJ..."}`)은 한 글자도 리댁션 안 됨. mjs 쪽 redactError는 올바른 부분문자열 방식 — 비대칭 |
| F3 | `dive/src-tauri/src/tools/run_process.rs:95` | **프로세스 출력 무제한 메모리 버퍼링 후 16KB truncate** — verbose 출력 명령 승인 시 OOM 경로. web_fetch의 read_bounded_byte_stream 패턴 재사용 가능 |

### G. 성능 (P1급)

| # | 위치 | 내용 |
|---|------|------|
| G1 | `dive/src-tauri/src/dive/card_metrics.rs:10` | **카드 1개 카운트에 전체 Message 테이블 로드(JSON 파싱 포함) + 메시지별 추가 쿼리(N+1)** — 카드별 IPC 호출이라 O(카드 수 × 전체 메시지). 단일 JOIN COUNT로 대체 가능 |
| G2 | `dive/src-tauri/src/ipc/workspace_plan.rs:4990` | **대시보드가 프로젝트마다 EventLog(append-only 무한 성장) 풀스캔 + 전 행 JSON 파싱** — 렌더 1회 = 원장 전체 로드 × 프로젝트 수 |
| G3 | `useProductShellController.ts:2106` | **54개 useCallback/useMemo가 전부 무효** — 반환 객체·인라인 클로저를 매 렌더 재생성 + product/에 React.memo 0개. 스트리밍 청크마다 셸 트리 전체 리렌더. '반쯤 메모이제이션'이 최악의 인상 |
| G4 | `dive/src-tauri/src/ipc/workspace_plan.rs:1193` | 인터뷰 no-patch 턴이 LLM 호출 전 stale draft를 재저장 — 동시 편집 유실 레이스 (E군에 준함) |

### 기타 P1

- `dive/src-tauri/src/mcp/registry.rs:131` — MCP 어댑터가 프로덕션에서 에이전트 레지스트리에 미등록 (반쪽 통합, PLAUSIBLE→P1 유지)
- `dive/src-tauri/src/ipc/workspace_plan.rs:3560` — 감독 증거 이벤트 기록 실패 `let _ =` 무시 (감사 원장 일관성)

---

## P2 — 개선 권장 (87건 요약)

전체 목록은 리뷰 원본 데이터 참조. 대표 항목:

**Rust**
- `ipc/preview.rs:497` 정적 프리뷰 서버 Host 헤더 미검증(DNS rebinding으로 프로젝트 파일 노출 가능) / `ipc/codex_oauth.rs:264` OAuth 콜백 서버가 accept 1회로 종료 — 잡음 연결에 로그인 실패 / `ipc/mcp.rs:81` MCP 인증 헤더 SQLite 평문 저장(프로바이더 키는 키링 — 비일관)
- `checkpoint/mod.rs:774` 복원 실패 무시하고 성공 보고 / `:789` 제외 필터가 루트 레벨만 적용 — 하위 node_modules가 스냅샷마다 커밋
- `providers/factory.rs:190` localhost 판정 IPv6 미매치·'127.' 프리픽스 도메인 통과 / `openai/stream.rs:127` Usage가 Done 뒤 방출 — 토큰 집계 0 / `tools/runtime.rs:646` `host == "::1"` 죽은 조건
- `dive/event_log.rs:1598` 리댁션이 모든 로그의 개행 구조 파괴 / `:61` JSON 따옴표 형태 비밀값 미매치
- busy-poll 2곳(10ms), 정규식 핫패스 재컴파일, glob 엔진 2벌 복붙, ipnet 죽은 의존성, preview Auto 분기 70줄 복붙, NewCard 15필드 복사 ×4, 동일 기능 커맨드 쌍 2벌, 문자열 substring 에러 분류, UTC+9 하드코딩 달력 산술
- `pi_sidecar.rs` 파일의 70%가 인라인 테스트 / spikes 디렉터리 잔존 / builtins-absent 보안 테스트가 CI 미연결 / SEA Node 바이너리 체크섬 미검증 다운로드

**Frontend**
- `MessageList.tsx:85` 스트리밍 델타마다 JSON.parse 포함 전체 재계산 / `useWorkmap.ts:180` 카드별 stats IPC N+1 + 뮤테이션마다 전체 refresh
- `project-session.ts:177` 프로덕션 스토어의 ~40%가 localStorage 목 분기 / `:745` 무한루프 footgun 죽은 셀렉터
- `rules.ts:722` 725줄 룰 엔진이 프로덕션에서 항상 빈 배열 반환 / `priority.ts:54` 무조건 true 스텁
- ChatArea 12필드 prop 타입 3중 복제(드리프트 발생) / PlanDraftApprovalScreen ko-KR 하드코딩 / PrdAuthoringBoard 9단 중첩 삼항 + localStorage 키 무한 누적 / DangerCard·WarnCard 푸터 UI 복붙(미검증)
- `PreviewTab.tsx:261` catch 없는 무음 실패 / `StepDetailSlideIn.tsx:850` 평가 'checking…' 영구 고착 가능 레이스

**CI/의존성/위생**
- build.yml: rev 미고정 `cargo install --git`(서드파티 개인 repo) / permissions 블록 부재 / release-gate 사이드카 이중 빌드
- pnpm audit high 2건 포함 7건(vite fs.deny 우회 등) / axe-core 미사용 dev 의존성 / packageManager·engines 미선언
- `dive/test-results/.last-run.json` 추적 중(내용도 "failed") / 루트 `images/` 18개(1.0MB)는 아카이브 스펙에서만 참조 / 추적 문서 15개에 개인 홈 경로

---

## 검증에서 걸러진 것

- **REFUTED 1건**: roadmap_step_update_state 무검증 저장 주장 — DB CHECK 제약이 존재해 기각.
- **미검증 5건** (검증 에이전트 세션 한도, 루트가 직접 재확인): lib.rs allow(dead_code) ✓확인(C1과 동일), RationaleChallengePanel 죽음 ✓확인(C6과 동일), test-results 추적 ✓확인(P2와 동일), run_codex_smoke 중복·DangerCard/WarnCard 복붙 — 미확인(PLAUSIBLE 취급).
- **PLAUSIBLE 5건**: guard.rs reject_symlink fail-open, index.mjs abort 레이스, useChatSession 하드코딩 문자열 ×2, MCP 반쪽 통합(P1 승격).

---

## 권장 처리 순서

### 1단계 — 공개 전 필수 (P0 + 히스토리 패스)
1. references-pdf/ 삭제 → references.md(DOI 목록) 대체
2. git filter-repo 히스토리 퍼지 (개인 이메일·홈 경로 처리 여부 동시 결정)
3. 내부 KACE 문서 트리 밖 이동 + .gitignore 정비 (A2)
4. OFL 폰트 라이선스 파일 추가 (A1)

### 2단계 — 공개 전 강력 권장 (삭제·소규모 수정 위주, 리스크 낮음)
- 데드코드 일괄 제거: C1~C8 (allow(dead_code) 제거 → 컴파일러 안내 따라 삭제, greet, 레거시 AgentLoop::run, 죽은 IPC 커맨드, RationaleChallengePanel, prdPatch.ts, 죽은 스크립트 23개)
- loadTauri 18벌 → 정본 치환 (D1)
- README 버전 드리프트 (A3), verify:version-sync 수정 (E6)
- 무음 실패 catch 추가 (E3, E4), run_process env 규칙 승격 (F1), redact_line 수정 (F2)
- multi_replace 임시파일 누수 (E5), load_history 정렬 (E1)

### 3단계 — 공개 후 점진 (구조 리팩터링, 별도 브랜치)
- 거대 파일 분할: B1~B5 (기계적 서브모듈 분리, 동작 불변)
- 승인 파이프라인 단일화 (D2 — C3 삭제와 연계), 사이드카 spawn 공통화 (D3)
- 성능: card_metrics/EventLog 쿼리 교체 (G1, G2), 메모이제이션 정리 (G3)
- P2 백로그 소화

---

*리뷰 원본 데이터(발견 124건 전문 + 검증 사유): 세션 스크래치패드 review-result.json. 방법론: 14영역 finder → 발견별 adversarial verifier (CONFIRMED만 본 문서에 수록).*
