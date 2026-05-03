# PHASE 3 마무리 핸드오프 (3-2 ~ 3-6)

다음 세션에서 이 파일만 보고 **Phase 3 전체 마무리**에 바로 진입할 수 있도록 정리한 문서다. 3-1은 이전 세션에서 완료됐고, 3-2 ~ 3-6 다섯 개 작업을 끝내면 `[PHASE_GATE]` 마킹 후 사용자 승인을 받고 Phase 4로 넘어간다.

---

## 현재 위치 (이 핸드오프 커밋 기준)

- **브랜치**: `main` — origin/main과 동기화됨 (push 완료 시점)
- **최종 커밋**:
  - `103dbb2` docs(sot): close task 3-1 … and stage task 3-2
  - `334a1dc` feat(dive): add I/V/E gates + card state machine …
- **Phase 3 상태**: 3-1 완료 ✓ / 3-2 ~ 3-6 미시작
- **검증 기준선 (3-1 종료 시점, 3-2 이후 회귀가 이 수를 유지해야 함)**:
  - Rust `cargo test --all-targets`: **103 pass, 1 ignored** (lib 78 + agent_loop 10 + card_state_machine 12 + providers_integration 3)
  - `cargo fmt --all -- --check` / `cargo clippy --all-targets -- -D warnings`: clean
  - 프론트: `pnpm typecheck` / `pnpm lint --max-warnings 0` / `pnpm format:check` / `pnpm build` 전부 통과
  - Playwright 6 스위트 **111 assertions** 통과 (workmap 16 / chat 17 / permission 14 / slide-in 21 / integration 21 / state-machine 22)

---

## 새 세션 첫 프롬프트 (추천)

```
PHASE3_HANDOFF.md 읽고 3-2부터 3-6까지 Phase 3 전부 마무리해.
각 작업 완료 시 feat + docs(sot) 커밋 2개. 3-6 후 [PHASE_GATE] 마킹.
모든 확인 질문은 핸드오프에 명시된 권장안 따라.
```

더 간단히:

```
3-2 진행해줘
```

---

## 실행 계획 (권장 순서 + 이유)

| 순서 | 작업 | 이유 / 의존성 | 예상 규모 |
|---|---|---|---|
| 1 | **3-4** 차단 명령 블록리스트 + 경로 제한 | 3-2가 `bash` 계열 테스트 실행을 mock 이상으로 확장하려면 안전장치가 선행되어야 안전. 2-3(Agent Loop) 완료로 의존성 해소. 가장 독립적이며 리스크 낮음 | 중간 (Rust 중심, 프론트 거의 없음) |
| 2 | **3-2** V 단계 AI 자체검증 + 사용자 최종 승인 | 3-1이 만든 V 게이트/Verifying 상태에 실제 의미를 부여. Agent Loop + Provider(Anthropic structured output) + `CardDetailPanel` 확장 | 큼 |
| 3 | **3-3** 체크포인트 (git2-rs) | 3-2의 Approve 성공 직후 자동 체크포인트 트리거가 자연스러운 통합 지점. git2-rs 신규 의존성 추가 필요 | 큼 |
| 4 | **3-5** OpenRouter Provisioning Keys | Provider 인프라(1-4) + keyring(1-5) 모두 있음. 외부 API 호출 중심이라 wiremock 테스트 필요. Phase 4 설정 UI(4-2)가 이를 소비 | 중간~큼 |
| 5 | **3-6** 익명화 export (JSONL) | DAO(1-3)와 EventLog 테이블 소비. 가장 격리된 작업이지만 Phase 3 마지막에 두어 Phase 4 파일럿 준비 직전 위치 | 중간 |

**이 순서를 바꿀 수 있는 경우**:
- 3-5 OpenRouter 실제 API 키가 없어 테스트 환경이 제한적이면 wiremock 기반으로만 돌리고 실제 API 검증은 Phase 4로 넘긴다.
- 3-3 git2-rs `vendored-libgit2` feature 빌드가 ARM64에서 막히면(§A.3 주의) Phase 4-5 파일럿 검증 때 재확인.

---

## 작업별 상세 — 이번 세션에서 수행할 내용

### 3-2. V 단계 AI 자체검증 + 사용자 최종 승인

**명세 참조**: §4.4, §7, §10.3 (`Card.verify_log`).

**백엔드**:
- `src-tauri/src/dive/verify.rs` 신규 — `VerifyEngine { provider, db }` + `verify_card(session_id, card_id) -> VerifyLog`
- `VerifyLog { intent_match: bool, test_result: TestResult, details: String, model: String, ran_at: i64 }` (serde 직렬화 후 `Card.verify_log` TEXT 컬럼에 저장)
- Provider `chat()`의 JSON structured output 활용 (Anthropic: `tool_use` 강제 / OpenAI: `response_format`). **3-2는 Anthropic 고정 권장** — OpenAI 추상화는 3-2.5 또는 Phase 4로.
- IPC `card_verify(session_id, card_id) -> VerifyLog` 신규, `invoke_handler`에 등록
- `card_transition::Approve` 조건 강화: `verify_log`가 있고 `intent_match==true`여야 통과. override 플래그(`approve_force`)는 UI에서 "그래도 승인" 토글 시 전달

**프론트**:
- [`CardDetailPanel`](file:///Users/wilycastle/Code/projects/DIVE-2/dive/src/components/workmap/CardDetailPanel.tsx) `verifying` body를 정적 문구에서 `verify_log` JSON 렌더링으로 교체 — 의도 일치 / 테스트 결과 / 세부 내역 섹션
- `[검증 실행]` 버튼 → `card_verify` IPC 호출 → streaming/스피너
- `[최종 승인]` 기본 활성 조건: `verify_log && intent_match && test_result != "fail"` 
- `useChatSession`에 `verifyCard(cardId)` 추가

**테스트**:
- Rust `tests/verify_engine.rs` — mock provider가 구조화된 JSON을 반환하도록 스크립트 + parse 검증, `Approve` 조건 강화 검증
- Playwright `scripts/verify-verify-engine.mjs` 신규 — Verifying 진입 → [검증 실행] → verify_log 렌더링 확인 → [최종 승인] → Verified 전이

**확인 질문 답 (권장)**:
1. AI 호출 주체 → 별도 `VerifyEngine` ✓
2. 테스트 도구 실행 → 3-4 블록리스트 선행 완료됨. 그래도 3-2는 mock 기본, 실제 `bash` 호출은 3-4가 이미 제공하는 안전장치 위에서 선택적으로 사용
3. `verify_log` 구조 → intent_match + test_result 2필드 ✓
4. Approve 기본값 → verify 성공 시만 기본 활성 ✓
5. AiAssistDialog 실제 LLM → **3-2에서 함께 처리** (Provider structured output 인프라를 재사용할 자연스러운 위치)
6. 검증 모델 → Anthropic claude-sonnet 기본 ✓

### 3-3. 체크포인트 (git2-rs)

**명세 참조**: §6.5, §11.6.

**백엔드**:
- `Cargo.toml`에 `git2 = { version = "0.18", features = ["vendored-libgit2"] }` 추가 (vendored로 Windows/ARM64 안전)
- `src-tauri/src/checkpoint/mod.rs` 구현 (현재 placeholder):
  - `CheckpointEngine::init(project_root)` — `.dive/git/` bare repo 생성
  - `create_checkpoint(session_id, card_id, kind: "auto"|"manual", label)` — 현재 워킹트리 스냅샷 + `Checkpoint` DAO 저장
  - `restore_checkpoint(checkpoint_id)` — reset hard to sha
  - `list_checkpoints(session_id)`
- 자동 트리거 지점:
  - `card_transition::Approve` 성공 직후 auto 체크포인트
  - `card_transition::Extend` 성공 직후 auto 체크포인트
- IPC `checkpoint_create(session_id, card_id?, label?) -> CheckpointRow` / `checkpoint_restore(checkpoint_id)` / `checkpoint_list(session_id)`

**프론트**:
- `CardDetailPanel` Verified 상태에 "체크포인트 기록됨" 미묘한 표시 (우측 상단 뱃지)
- 전역 Ctrl+S 핸들러(MainShell 레벨) → 수동 체크포인트. 토스트는 **4-4에서 폴리싱**하므로 3-3에서는 console.log 또는 임시 최소 UI

**테스트**:
- Rust `tests/checkpoint_engine.rs` — tempdir 프로젝트 루트에 init → 파일 쓰기 → checkpoint → 파일 수정 → restore → 원본 복원 확인
- Playwright `scripts/verify-checkpoint.mjs` — Approve 시 자동 체크포인트 이벤트 감지 (EventLog 또는 IPC 응답)

**주의**:
- git2-rs 빌드가 clean cache에서 1-2분 소요. CI 타임아웃 늘려야 할 수 있음
- WAL sidecar 파일(`-wal`, `-shm`)은 체크포인트에서 제외해야 함 — `.gitignore` 또는 `add_path` 필터링

### 3-4. 차단 명령 블록리스트 + 경로 제한

**명세 참조**: §9.2, §9.3.

**백엔드**:
- `src-tauri/src/tools/guard.rs` (또는 기존 `FsGuard` 확장):
  - `BLOCKED_PATTERNS`: `rm -rf /`, `:(){:|:&};:`, `> /dev/sda`, `mkfs.`, `dd if=… of=/dev/…`, `chmod -R 000`, `curl … | sh` 등 명세 §9.2 전체
  - 블록 판정은 `bash` 도구 인자(command 문자열)에 대해 regex + 토큰 검사
  - 경로 검사: `FsGuard::resolve_write` 이미 존재. `resolve_read`·`resolve_write` 모두 symlink 거부 조건 추가 (`std::fs::symlink_metadata` + `FileType::is_symlink`)
- 새 도구 `bash`를 registry에 추가 (현재 `read_file/list_dir/write_file/edit_file`만 있음):
  - `risk_level: "danger"` 기본. 블록리스트 통과 시에도 사용자 승인 필요
  - 실행은 `tokio::process::Command`, stdout/stderr 스트리밍
- 도구 호출 전 블록 판정은 `Tool::validate()` 훅 신설 (registry가 run 이전 호출)

**프론트**:
- 권한 카드에 "차단된 명령" 상태 추가 — DangerCard 기반 + 빨간 배너 + `실행 불가` 고정 문구
- 2-4의 `PermissionCard` enum에 `blocked: { pattern: string }` variant

**테스트**:
- Rust `tests/tool_guard.rs` — 모든 차단 패턴 각각에 대해 `validate()`가 에러 반환
- Symlink 경로는 `resolve_*` 에러
- Playwright `scripts/verify-tool-guard.mjs` — 차단 명령 시뮬레이션 (mock provider가 `bash { cmd: "rm -rf /" }` 도구 호출 응답 → UI가 차단 카드 렌더)

**확인 질문 (권장)**:
- 차단 패턴 매칭 방식 → **리터럴 substring + 정규식 혼합** (spec §9.2 예시는 리터럴 + 변형형 모두 포함)
- 차단 vs 경고 구분 → **차단만 구현** (경고 카드는 4-2 설정 화면에서 자동 승인 정책으로)

### 3-5. OpenRouter Provisioning Keys (학생 키 분배)

**명세 참조**: §7.5.

**백엔드**:
- `src-tauri/src/providers/openrouter.rs` 신규 (기존 OpenAI 어댑터와 별도) — base_url `https://openrouter.ai/api/v1`, OpenAI 호환 API
- `src-tauri/src/auth/openrouter_provisioning.rs`:
  - `issue_child_key(main_key, label, credit_limit_usd) -> ChildKey { key, hash, label }`
  - `revoke_child_key(main_key, hash) -> ()`
  - `list_child_keys(main_key) -> Vec<ChildKeySummary>`
  - `revoke_all_by_prefix(main_key, label_prefix)` — 차시 종료 일괄 폐기
- `SecretScope::OpenRouterChildKey { label }` variant 추가 (keyring 저장)
- IPC: `openrouter_issue_key` / `openrouter_revoke_all` / `openrouter_list_keys`

**프론트**:
- 교사용 화면 (임시 데모 라우트 `?demo=provisioning`) — 차시 라벨 입력 → 25개 자식 키 일괄 발급 → QR 코드 + 짧은 URL 표시. 짧은 URL은 Phase 4-2 또는 별도 정적 페이지
- QR 라이브러리: `qrcode.react` 권장 (tailwind 호환)

**테스트**:
- Rust `tests/openrouter_provisioning.rs` — `wiremock`으로 `/api/v1/keys` endpoint mocking (issue/revoke/list 3개 경로)
- Playwright `scripts/verify-provisioning.mjs` — demo 페이지에서 발급 플로우 UI 확인 (IPC는 Tauri 런타임 없으면 mock; dev 모드에서는 실제 호출 안 함)

**주의**:
- 실제 OpenRouter API 키가 없으면 전체 E2E는 **wiremock 테스트까지만** 보장. 현장 발급 검증은 4-5 파일럿 검증에서
- 명세 §7.5 "짧은 URL" 호스팅은 Phase 3에서 결정 필요 — 임시로 로컬 HTTP 서버 + LAN 공유 (교실 네트워크)가 현실적. Cloudflare Workers 무료 플랜도 고려. **권장: Phase 3에서는 QR만, 짧은 URL은 Phase 4-5**.

### 3-6. 익명화 export (JSONL)

**명세 참조**: §6.7, §9.4.

**백엔드**:
- `src-tauri/src/export/mod.rs` 신규:
  - `ExportOptions { include_messages, include_tool_calls, include_verify_logs, hash_user_text: bool, hash_file_paths: bool }`
  - `export_session(session_id, options) -> Vec<u8>` (JSONL 바이트)
  - 해시 마스킹: SHA-256 + 고정 salt(세션당 무작위 생성 후 export 시작 시 확정) → 16자 짧은 해시
- `EventLog` + `Message` + `ToolCall` + `Card` + `Checkpoint` 전부 순회
- IPC `export_session(session_id, options) -> file_path` — Tauri dialog로 저장 경로 선택 후 write

**프론트**:
- 사이드바 또는 설정 화면 (`?demo=export` 임시 라우트)에서 차시 선택 → 옵션 체크박스 → [내보내기]
- 성공 시 파일 경로 토스트 (또는 3-3에서 추가한 체크포인트 토스트와 동일 스타일)

**테스트**:
- Rust `tests/export_jsonl.rs` — 세션 seed → export → 각 record type 줄 수 확인 + 해시 옵션 on/off 비교
- Playwright `scripts/verify-export.mjs` — demo 페이지에서 export 버튼 클릭 + 옵션 토글 UI만 (실제 파일 저장은 Tauri 런타임 필요하므로 UI까지만)

**확인 질문 (권장)**:
- Salt 범위 → **세션당 새로 생성** (export마다 다른 해시가 나와야 크로스-세션 재식별 방지) ✓
- 포함 기본값 → 메시지 + 도구 호출 + verify_log는 기본 on, 해시 마스킹도 기본 on ✓

---

## Phase 3 종료 조건 (Phase 4 진입 전 사용자 확인)

- [ ] 3-2 ~ 3-6 모두 `DIVE_PROGRESS.md`에 `[x]` + 커밋 해시 기록
- [ ] Rust `cargo test --all-targets` 전체 통과 (예상 130~160개)
- [ ] `cargo fmt --all -- --check` / `cargo clippy --all-targets -- -D warnings` clean
- [ ] 프론트 `pnpm typecheck` / `lint` / `format:check` / `build` 통과
- [ ] Playwright 스위트 전부 통과 — state-machine, verify-engine, checkpoint, tool-guard, provisioning, export 신규 + 기존 6개 회귀 = **최소 11 스위트**
- [ ] `DIVE_NEXT.md`에 `[PHASE_GATE] Phase 3 완료 — 사용자 승인 대기` 마킹
- [ ] `DIVE_DECISIONS.md`에 신규 ADR (각 작업마다 하나씩 최소) — ADR-014 ~ ADR-018 예상
- [ ] 각 작업별 **`feat(...)` + `docs(sot)` 2-커밋 패턴 유지**

---

## 3-1에서 이어받을 계약 (재확인)

- `DiveGateEngine::check(stage)` 디스패처 — 3-2의 `card_verify`가 내부적으로 `check_stage_v` 확인 후에만 실행
- `CardDetailPanel` `verifying` body는 현재 정적 문구 — 3-2에서 완전 교체
- `useChatSession.transitionCardRemote(cardId, transition)` — Phase 3-2 이후 MainShell이 프론트 스토어 업데이트와 함께 실제 IPC 호출도 수행하도록 전환 (현재는 스토어만)
- `card_transition::Approve` IPC는 DB update만 — 3-2에서 verify_log 필수 조건 강화
- `Card.verify_log` TEXT nullable 컬럼 이미 존재 (v1 스키마) — 3-2에서 사용 시작
- `.dive/git/` 디렉터리는 3-3에서 생성. 그 전까지는 `Checkpoint` 테이블에 row만 있고 실제 저장소 없음
- `ToolRegistry::with_builtins()`에 현재 `bash` 없음 — 3-4에서 추가

## 3-1에서 의도적으로 미룬 항목 (각 후속 작업이 흡수)

- AiAssistDialog 실제 LLM 호출 → **3-2에서 함께 처리** (권장안)
- `DEMO_CHANGED_FILES` mock 제거 → 3-3 체크포인트 이후 실제 워킹트리 diff 사용
- `simulateToolCallCount()` in MainShell → 3-4 `bash` 도구 추가 후 실제 DB 조회로 전환
- `chat_send stage` 파라미터의 프론트 전달 → 현재 MainShell은 `inferStageFor()` 결과를 `useChatSession`에 넘기지 않음. 3-2에서 연결 (V 게이트 진입 시 실제로 stage="v"를 서버에 알려야 함)

---

## 기준 문서

| 파일 | 역할 |
|---|---|
| `DIVE_SPEC.md` | SoT (사용자만 수정). Phase 3 관련 섹션: §4.4 / §6.5 / §6.7 / §7.5 / §9.2 / §9.3 / §9.4 |
| `DIVE_PROGRESS.md` | 36 작업 체크리스트. 3-1 `[x]` 완료됨 |
| `DIVE_NEXT.md` | **3-2 작업 상세** 적재됨 |
| `DIVE_DECISIONS.md` | ADR-013까지. 3-2 ~ 3-6 각각 ADR 추가 예정 (ADR-014 ~ ADR-018) |
| `PHASE3_HANDOFF.md` | 이 파일. Phase 3 전체 완료 계획 |

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
pnpm dev                              # 한 터미널 :1420
node scripts/verify-state-machine.mjs  # 3-1 기준선
node scripts/verify-verify-engine.mjs  # 3-2 후 추가
node scripts/verify-checkpoint.mjs     # 3-3 후 추가
node scripts/verify-tool-guard.mjs     # 3-4 후 추가
node scripts/verify-provisioning.mjs   # 3-5 후 추가
node scripts/verify-export.mjs         # 3-6 후 추가
# 회귀
for s in workmap chat permission slide-in integration state-machine; do
  node scripts/verify-$s.mjs || break
done
```

---

## 커밋 패턴 (Phase 2~3-1과 동일 유지)

작업당 2 커밋:

1. `feat(<scope>): <짧은 설명> (task 3-N)` — 구현 + 테스트
2. `docs(sot): close task 3-N (<제목>) and stage task 3-(N+1) (<다음 제목>)` — SoT 4파일 갱신

3-6 완료 직후에는 두 번째 커밋 메시지를 `docs(sot): close task 3-6 and mark [PHASE_GATE] for Phase 3 end`로 변경.

---

**준비 완료.** 새 세션에서 위 "첫 프롬프트" 중 하나로 시작하면 Phase 3 마무리에 즉시 진입한다.
