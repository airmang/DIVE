# PHASE 4 진입 핸드오프

Phase 3 PHASE_GATE를 사용자가 승인하여 Phase 4 진입. 새 세션에서 이 파일만 보고 **Phase 4 전체 마무리(4-1 ~ 4-6)**에 바로 진입할 수 있도록 정리했다.

---

## 현재 위치 (이 핸드오프 커밋 기준)

- **브랜치**: `main` — origin/main 동기화됨
- **최종 Phase 3 커밋**:
  - `c712bb9` style: prettier format verify-export.mjs
  - `3bdbb67` docs(sot): close task 3-6 and mark [PHASE_GATE] for Phase 3 end
  - `65f21ea` feat(export): anonymized JSONL export + teacher demo UI (task 3-6)
- **Phase 3 상태**: 3-1 ~ 3-6 완료 ✓ / Phase 4-1 ~ 4-6 미시작
- **Phase 3 종료 시 검증 수치 (Phase 4 회귀 기준선)**:
  - Rust `cargo test --all-targets`: **163 passed / 0 failed / 1 ignored**
  - `cargo fmt --all -- --check` / `cargo clippy --all-targets -- -D warnings`: clean
  - 프론트: `pnpm typecheck` / `pnpm lint --max-warnings 0` / `pnpm format:check` / `pnpm build` 전부 통과
  - Playwright **11 스위트 191 assertions** 전부 통과 (workmap 16 / chat 17 / permission 14 / slide-in 21 / integration 21 / state-machine 22 / tool-guard 16 / verify-engine 19 / checkpoint 6 / provisioning 15 / export 24)

---

## 새 세션 첫 프롬프트 (추천)

```
PHASE4_HANDOFF.md 읽고 4-1부터 4-6까지 Phase 4 전부 마무리해.
각 작업 완료 시 feat + docs(sot) 커밋 2개. 4-6 후 [PHASE_GATE] 마킹.
모든 확인 질문은 핸드오프에 명시된 권장안 따라.
```

더 간단히:

```
4-1 진행해줘
```

---

## 실행 계획 (권장 순서 + 이유)

| 순서 | 작업 | 이유 / 의존성 | 예상 규모 |
|---|---|---|---|
| 1 | **4-1** 온보딩 + 프로젝트·세션 관리 UI | 현재 메인 화면에서 "+ 새 세션" / "+ 새 프로젝트" 버튼이 `disabled`. 이게 안 풀리면 4-2~4-6을 **실제 파일럿 환경**에서 쓸 수 없다. 가장 큰 UX 잠금 해제 | 큼 |
| 2 | **4-2** 설정 화면 (프로바이더 + 자동 승인 + 테마 + 체크포인트 타임라인) | 4-1의 프로바이더 카드를 확장. OpenRouter 일등 시민화(3-5 산출물 소비). §6.4.2 자동 승인 정책 UI. §5.8 체크포인트 타임라인 슬라이드 인 | 큼 |
| 3 | **4-3** 에러 처리 + 네트워크 재시도 | 2-3 AgentLoop 확장. 지수 백오프 3회(§9.6), 명시적 에러 토스트, 다른 프로바이더 전환 옵션. 실제 테스트 실행(V 검증에서 `bash` 도구 opt-in) 포함 | 중간~큼 |
| 4 | **4-4** 빈 상태·로딩·토스트 폴리싱 | Ctrl+S 체크포인트 토스트, 복원 확인 다이얼로그, 스켈레톤 로딩, 에러 상태 UI 일관성. 의존성 없지만 4-3 토스트 인프라 뒤에 오면 중복 작업 감소 | 중간 |
| 5 | **4-5** 파일럿 환경 검증 | 학교 PC 사양에서 Tauri 빌드·실행. OpenRouter 자식 키 25명 시뮬레이션. 차시 종료 export. Cloudflare Workers 짧은 URL(§7.5) | 큼 |
| 6 | **4-6** 사용자·교사 매뉴얼 + 차시 시나리오 테스트 | 학생 빠른 시작, 교사 운영 매뉴얼, 6차시 워크스루. 문서 중심 + 발견된 버그 수정. PHASE_GATE 마킹 | 중간 |

**이 순서를 바꿀 수 있는 경우**:
- 실제 학교 PC 접근 불가 → 4-5 검증 일부는 Phase 5로 연기
- EV 코드 서명 인증서 부재 → SmartScreen 경고 감수 + Phase 6으로 연기 (명세 §11.3 이미 승인됨)

---

## 작업별 상세 — 이번 세션에서 수행할 내용

### 4-1. 온보딩 + 프로젝트·세션 관리 UI

**명세 참조**: §5.7 (온보딩), §6.1 (프로젝트 관리), §6.2 (세션 관리), §5.1.1 (사이드바).

**백엔드 (이미 있음 → 활용만)**:
- `Project` / `Session` / `Workmap` DAO 전부 존재 (1-3). 추가 작업 없음.
- `ProviderConfig` DAO + `SecretScope::ProviderApiKey` keyring 전부 존재 (1-5). 추가 작업 없음.

**백엔드 (신규)**:
- IPC `project_create(name, path) -> ProjectRow` — 폴더 선택 다이얼로그는 프론트에서 Tauri `dialog.open`, 백엔드는 DB insert + `.dive/` 디렉터리 생성 + `CheckpointEngine::init` 호출
- IPC `project_list() -> Vec<ProjectRow>` / `project_delete(project_id, delete_folder: bool)`
- IPC `session_create(project_id, title?) -> SessionRow` — title이 None이면 "새 세션 {timestamp}" 자동 생성
- IPC `session_list(project_id) -> Vec<SessionRow>` / `session_delete(session_id)` / `session_archive(session_id)`
- IPC `provider_connect(kind, api_key) -> ProviderConfigRow` — keyring 저장 + DB row insert
- IPC `provider_list() -> Vec<ProviderConfigSummary>` — API 키는 "is_connected: bool"로만 표시 (`.key` 노출 금지)
- IPC `provider_disconnect(provider_config_id)` — keyring + DB 동시 삭제

**프론트**:
- **온보딩 모달** (`src/components/onboarding/OnboardingDialog.tsx`) — 첫 실행 감지는 `window.localStorage.getItem('dive:onboarded')` 또는 `project_list()`가 빈 배열일 때. 미니멀 1스텝 (§5.7): 프로바이더 kind 선택 + API 키 입력 + [연결하기] 버튼. "나중에 설정"으로 skip 가능.
- **Sidebar 재작성** (`src/components/shell/Sidebar.tsx`):
  - `+ 새 프로젝트` → `disabled` 제거, Tauri `dialog.open({ directory: true })` → `project_create` IPC
  - 프로젝트 목록 렌더 (최근 사용 순)
  - 프로젝트 선택 시 세션 목록 로드
  - `+ 새 세션` → `session_create` IPC → 사이드바에 즉시 추가
  - 세션 클릭 시 활성 세션 전환 (Zustand `currentSessionId` 스토어)
  - 우클릭 컨텍스트 메뉴 — "닫기", "이름 변경", "삭제"
  - 하단 "현재 모델" 카드 → `disabled` 제거, 클릭 시 `?route=settings` 또는 모달
- **브라우저 데모 환경 대응**: Tauri IPC 부재 시 `localStorage` 기반 mock 프로젝트·세션 (기존 `__TAURI_INTERNALS__` 감지 패턴 재사용)

**테스트**:
- Rust `tests/project_lifecycle.rs` / `tests/session_lifecycle.rs` — IPC 엔드투엔드 (tempdir + 인메모리 DB)
- Playwright `scripts/verify-onboarding.mjs` — 첫 실행 모달 → 프로바이더 mock 연결 → 메인 화면 전환. `localStorage.removeItem('dive:onboarded')`로 재초기화해 재현 가능
- Playwright `scripts/verify-project-session.mjs` — 프로젝트 생성 → 세션 생성 → 세션 전환 → 삭제

**확인 질문 답 (권장)**:
1. **프로젝트 생성 시 폴더 위치**: 기존 폴더 선택(빈/비어있지 않음 모두 허용) ✓. `.dive/` 자동 생성. 이미 있으면 "기존 프로젝트 열기"로 처리(명세 §6.1).
2. **세션 자동 제목**: 첫 메시지로부터 AI 자동 생성은 Phase 4-2 또는 4-3 (모델 호출 1회 필요). 4-1에서는 `"새 세션 {YYYY-MM-DD HH:mm}"` 고정.
3. **온보딩 "나중에 설정"**: 허용 ✓. 단 프로바이더 미연결 시 채팅 input 비활성 배너는 3-1에서 이미 있음 — 온보딩 skip 후 자동 반영.
4. **프로젝트 삭제 시 코드 폴더**: 체크박스로 선택 — 기본값은 **false**(`.dive/`만 삭제, 사용자 코드 보존). 명세 §6.1의 위험 옵션.
5. **localStorage key 이름**: `dive:onboarded` (boolean) + `dive:current-session-id` (number) + `dive:current-project-id` (number) — 세션·프로젝트 전환 상태가 탭 새로고침에 살아남음.

### 4-2. 설정 화면 (프로바이더 · 자동 승인 · 테마 · 체크포인트 타임라인)

**명세 참조**: §5.9 (프로바이더 설정), §6.4 (권한 시스템), §8.3 (자동 승인 정책), §5.8 (체크포인트 타임라인).

**백엔드**:
- `ProviderConfig.config` JSON 컬럼 확장 — `auto_approve: { [tool_name]: "always" | "never" }` 저장
- IPC `provider_policy_get() -> AutoApprovePolicy` / `provider_policy_set(policy) -> ()`
- `PermissionHook`의 기본 구현을 `PolicyHook(policy, fallback=AwaitUserHook)`으로 교체 (이미 `policy.rs`에 있음, 연결만)
- IPC `checkpoint_timeline(session_id) -> Vec<CheckpointTimelineItem>` — `checkpoint_list` + 각 체크포인트의 tree diff(파일 변경 수)
- OpenRouter를 프로바이더 5종 중 일등 시민으로 등록 — 기본 `ProviderConfig` seed에 OpenRouter 포함

**프론트**:
- `/?demo=settings` → `src/pages/settings.tsx` (설정 화면 전용 페이지)
- 섹션 3개:
  - **프로바이더 카드 5종** — Anthropic / OpenAI / OpenRouter / Codex (OAuth placeholder) / Mock. 연결 상태 점(초록/회색/빨강) + [연결하기]/[재인증]/[✕]
  - **자동 승인 정책** — 안전 도구(read_file, list_dir, search_files)만 옵트인 토글. "다음 차시 초기화" 스위치
  - **테마 토글** (기존 Sidebar에서 이동)
- **체크포인트 타임라인** (`src/components/slide-in/CheckpointTimeline.tsx`) — §5.8 슬라이드 인 패널 하단에 가로 띠. 각 점 호버 툴팁 + 클릭 미리보기 + [복원] 버튼
- `MainShell`의 `DEMO_CHANGED_FILES` mock → `checkpoint_timeline` IPC 결과로 교체

**테스트**:
- Rust `tests/auto_approve_policy.rs` — 정책 우선순위 3단계(블록리스트 → 자동 승인 → 수동) 검증
- Rust `tests/checkpoint_timeline.rs` — 3개 체크포인트 생성 → `checkpoint_timeline` 응답 형태 검증
- Playwright `scripts/verify-settings.mjs` — 프로바이더 연결 mock, 자동 승인 토글, 테마 전환
- Playwright `scripts/verify-timeline.mjs` — scenario-b에서 3번 Approve → 타임라인에 3개 점 표시 → 클릭 미리보기

**확인 질문 답 (권장)**:
1. **설정 화면 라우팅**: 별도 `?route=settings` URL + Sidebar 하단 "현재 모델" 카드 클릭 진입. 닫기 = 뒤로 가기 또는 ESC.
2. **프로바이더 5종 고정**: Anthropic + OpenAI + OpenRouter + Codex(5-1 placeholder) + Mock(개발 전용, 프로덕션 빌드에서는 숨김). 추가 프로바이더는 Phase 5+.
3. **자동 승인 유효 범위**: 현재 세션 한정 기본값. "다음 차시 초기화" 토글 on이면 세션 종료 시 정책 삭제 — 학습 환경 친화.
4. **타임라인 점 시각**: §5.8.2 테이블 — 회색 외곽선(init), 초록 채워짐(auto), 보라 채워짐(manual), 파스텔 보라 + 글로우(current). 26 × 26px 원.

### 4-3. 에러 처리 + 네트워크 재시도 + V 단계 실제 테스트 실행

**명세 참조**: §9.6 (에러 시 동작), §12.4 (에러 메시지 i18n).

**백엔드**:
- `providers/retry.rs` — `with_retry<F>(f, max=3, base=Duration::from_millis(500))` 지수 백오프(0.5s, 1s, 2s) 래퍼. `AnthropicProvider` / `OpenAiProvider::chat`에 래핑
- 5xx, timeout, connection refused만 재시도. 400/401은 즉시 실패
- IPC `chat_retry(session_id, message_id)` — 실패한 메시지만 재시도
- `VerifyEngine`에 `bash_runner: Option<Arc<dyn Tool>>` 필드 추가 — `Some`이면 검증 시 `test_result: "skipped"` 대신 실제 명령 실행해 `pass|fail` 채움
- `ProviderConfig.config.test_command`에 프로젝트별 테스트 명령 저장 (예: `pnpm test`, `cargo test`)

**프론트**:
- `ErrorBoundary` + 토스트 인프라 (`src/components/toast/` 신규) — `useToast()` 훅
- `useChatSession`의 `error` 상태 → 토스트로 표시
- 3회 재시도 실패 시 "다른 프로바이더로 전환" 버튼이 포함된 에러 메시지
- i18n 키 정리 (`src/i18n/ko.ts` — §12.4)

**테스트**:
- Rust `tests/retry_logic.rs` — wiremock으로 5xx 연속 → 성공 시나리오
- Playwright `scripts/verify-error-toast.mjs` — mock 환경에서 에러 주입 → 토스트 표시 → 재시도 버튼 클릭 → 성공

**확인 질문 답 (권장)**:
1. **재시도 대상 에러 코드**: 5xx + timeout + connection refused ✓. 400/401/403은 즉시 표면화.
2. **재시도 UI 표시**: 작은 "재시도 중 (1/3)" 배지를 AssistantMessage 하단에. 실패 시 빨간 테두리 + "재시도" 버튼.
3. **V 단계 `bash` 실행**: 기본 off, 프로바이더 설정에 `test_command` 저장되면 자동 on. 실행 결과 stdout/stderr는 `verify_log.details`에 append.

### 4-4. 빈 상태 · 로딩 · 토스트 폴리싱

**명세 참조**: §2.3 (디자인 원칙).

**작업 내용**:
- 토스트 시스템 완성 (4-3에서 인프라 → 4-4에서 폴리싱): 성공/정보/경고/에러 4 variant, auto-dismiss 5초, stacking 최대 3개
- Ctrl+S 체크포인트 → 실제 토스트 "체크포인트 저장됨 · {label}" (3-3 console.log 교체)
- 복원 전 확인 다이얼로그 ("현재 상태가 '복원 직전' 체크포인트로 저장됩니다")
- 스켈레톤 로딩 (`src/components/ui/skeleton.tsx`): Sidebar 프로젝트·세션 목록, ChatArea 메시지 로딩, 워크맵 카드 로딩
- 빈 상태 일관성: 프로젝트 없음, 세션 없음, 메시지 없음, 카드 없음 — 각 일러스트 + 짧은 안내 + 주요 액션 버튼

**테스트**:
- Playwright `scripts/verify-polish.mjs` — 빈 상태 4종 + 로딩 스켈레톤 + 토스트 stacking

### 4-5. 파일럿 환경 검증

**명세 참조**: §11.3 (Windows 빌드).

**작업 내용**:
- Windows x64 / ARM64 NSIS 인스톨러 CI 빌드 검증 (`.github/workflows/build.yml` — 이미 있음)
- 실제 학교 PC 1대에서 설치 → 온보딩 → 프로젝트 생성 → D→I→V→E 한 세션 → export까지 수동 walkthrough
- OpenRouter 실제 main key로 25개 자식 키 발급 → 25개 브라우저 인스턴스 동시 시뮬레이션(Playwright parallel)
- Cloudflare Workers 짧은 URL 호스팅 (선택 — 실제 도메인·계정 필요)
- 성능 측정: 앱 시작 시간, 첫 메시지 응답 latency, 25명 동시 호출 시 OpenRouter quota 소진 속도

**산출물**:
- `docs/pilot-checklist.md` — 차시 전·중·후 교사 체크리스트
- `docs/pilot-benchmarks.md` — 측정 결과

### 4-6. 사용자·교사 매뉴얼 + 차시 시나리오 테스트

**명세 참조**: §1 (프로젝트 개요), §4 (DIVE 원칙).

**작업 내용**:
- `docs/student-quickstart.md` — 학생용 5분 빠른 시작 (스크린샷 포함)
- `docs/teacher-manual.md` — 교사용 운영 매뉴얼 (프로바이더 연결, 자식 키 분배, 차시 export)
- 6차시 시나리오 스크립트 (`docs/scenarios/session-01.md` ~ `session-06.md`) — 각 차시의 학습 목표, 예상 카드 구성, 교사 개입 포인트
- 각 시나리오를 Playwright로 자동 재생해 회귀 검증

**최종 단계**:
- `DIVE_NEXT.md`에 `[PHASE_GATE] Phase 4 완료 — 사용자 승인 대기` 마킹
- `docs(sot): close task 4-6 and mark [PHASE_GATE] for Phase 4 end` 커밋

---

## Phase 4 종료 조건 (Phase 5 진입 전 사용자 확인)

- [ ] 4-1 ~ 4-6 모두 `DIVE_PROGRESS.md`에 `[x]` + 커밋 해시 기록
- [ ] Rust `cargo test --all-targets` 전체 통과 (예상 180~200개)
- [ ] `cargo fmt` / `cargo clippy -D warnings` clean
- [ ] 프론트 `pnpm typecheck` / `lint` / `format:check` / `build` 통과
- [ ] Playwright 스위트 전부 통과 — onboarding, project-session, settings, timeline, error-toast, polish 신규 + 기존 11개 회귀 = **최소 17 스위트**
- [ ] 실제 학교 PC walkthrough 1회 통과 (4-5)
- [ ] `DIVE_NEXT.md`에 `[PHASE_GATE] Phase 4 완료 — 사용자 승인 대기` 마킹
- [ ] `DIVE_DECISIONS.md`에 ADR-019 ~ ADR-024 (작업당 최소 1개)
- [ ] 각 작업별 **`feat(...)` + `docs(sot)` 2-커밋 패턴 유지**

---

## Phase 3에서 이어받을 계약 (재확인)

- **IPC 이미 등록된 13개**: `chat_send`, `chat_cancel`, `tool_approve`, `tool_deny`, `workmap_set_current_card`, `card_update_instruction`, `card_transition`, `card_verify`, `ai_assist_cards`, `checkpoint_create`, `checkpoint_restore`, `checkpoint_list`, `openrouter_issue_key`, `openrouter_revoke_all`, `openrouter_list_keys`, `export_session` — 4-1은 여기에 `project_*`, `session_*`, `provider_*` 추가
- **Sidebar `disabled` 잠금** — 4-1이 `disabled` 제거 + 실제 핸들러 연결의 주체
- **MainShell `DEMO_CHANGED_FILES`** — 4-2 체크포인트 타임라인이 실제 `checkpoint_timeline` IPC 결과로 교체
- **`bash` 도구 V 검증 opt-in** — 4-3이 `test_command` 설정과 함께 실제 실행 연결
- **Ctrl+S console.log** — 4-4가 실제 토스트로 교체
- **Tauri 빌드 검증** — 4-5가 Windows x64 / ARM64 실제 검증

## Phase 3에서 의도적으로 미룬 항목 (각 후속 작업이 흡수)

- 프로젝트·세션 CRUD UI → **4-1**
- 프로바이더 설정 화면 → **4-2**
- 자동 승인 정책 UI → **4-2**
- 체크포인트 타임라인 (§5.8) → **4-2**
- V 단계 실제 테스트 실행 → **4-3**
- 네트워크 재시도 (§9.6) → **4-3**
- 체크포인트 토스트 → **4-4**
- Cloudflare Workers 짧은 URL → **4-5**

---

## 기준 문서

| 파일 | 역할 |
|---|---|
| `DIVE_SPEC.md` | SoT. Phase 4 관련: §5.1 / §5.7 / §5.8 / §5.9 / §6.1 / §6.2 / §6.4 / §8.3 / §9.6 / §11.3 / §12.4 |
| `DIVE_PROGRESS.md` | 36 작업 체크리스트. Phase 3은 `[x]` 전부 완료 |
| `DIVE_NEXT.md` | **4-1 작업 상세**로 교체됨 (이 핸드오프 작성 시점) |
| `DIVE_DECISIONS.md` | ADR-018까지. 4-1 ~ 4-6 각 ADR 추가 (ADR-019 ~ ADR-024) |
| `PHASE3_HANDOFF.md` | Phase 3 완료 기록 (아카이브용) |
| `PHASE4_HANDOFF.md` | 이 파일. Phase 4 전체 완료 계획 |

---

## 검증 명령 레퍼런스

```bash
# Rust 전체
cd dive/src-tauri
cargo test --all-targets
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings

# 프론트 전체
cd dive
pnpm typecheck && pnpm lint --max-warnings 0 && pnpm format:check && pnpm build

# Playwright (dev 서버 실행 후 별 터미널에서)
pnpm dev                                # 한 터미널 :1420
# Phase 3 회귀 (11 스위트)
for s in workmap chat permission slide-in integration state-machine \
         tool-guard verify-engine checkpoint provisioning export; do
  node scripts/verify-$s.mjs || break
done
# Phase 4 신규 (작업 완료마다 추가)
node scripts/verify-onboarding.mjs         # 4-1 후
node scripts/verify-project-session.mjs    # 4-1 후
node scripts/verify-settings.mjs           # 4-2 후
node scripts/verify-timeline.mjs           # 4-2 후
node scripts/verify-error-toast.mjs        # 4-3 후
node scripts/verify-polish.mjs             # 4-4 후
```

---

## 커밋 패턴 (Phase 2~3과 동일 유지)

작업당 2 커밋:

1. `feat(<scope>): <짧은 설명> (task 4-N)` — 구현 + 테스트
2. `docs(sot): close task 4-N (<제목>) and stage task 4-(N+1) (<다음 제목>)` — SoT 4파일 갱신

4-6 완료 직후에는 두 번째 커밋 메시지를 `docs(sot): close task 4-6 and mark [PHASE_GATE] for Phase 4 end`로 변경.

---

**준비 완료.** 새 세션에서 위 "첫 프롬프트" 중 하나로 시작하면 Phase 4 마무리에 즉시 진입한다.
