# PHASE 5 완료 핸드오프

Phase 5 PHASE_GATE를 사용자가 승인하여 Phase 6 진입할 준비가 된 시점의 기준 문서.

---

## 현재 위치 (이 핸드오프 커밋 기준)

- **브랜치**: `main`
- **최종 Phase 5 커밋**:
  - `(이 커밋)` docs(sot): close task 5-6 and mark [PHASE_GATE] for Phase 5 end
  - `13810cb` feat(phase5): v0.3 integration test — Codex + MCP + prompt helper + pre-send check end-to-end (task 5-6)
  - `a613c52` docs(sot): close task 5-5 (prompt pre-send check) and stage task 5-6 (v0.3 integration)
  - `e29ef35` feat(prompt-helper,dive): add prompt pre-send check with AI self-critique (task 5-5)
- **Phase 5 상태**: 5-1 ~ 5-6 모두 완료 / Phase 6-1 ~ 6-5 미시작
- **Phase 5 종료 시 검증 수치 (Phase 6 회귀 기준선)**:
  - Rust `cargo test --all-targets`: **238 passed / 0 failed / 1 ignored**
  - `cargo fmt --all -- --check` / `cargo clippy --all-targets -- -D warnings`: clean
  - 프론트: `pnpm typecheck` / `pnpm lint --max-warnings 0` / `pnpm format:check` / `pnpm build` 전부 통과
  - Playwright **23 스위트 358 assertions** 전부 통과

---

## Phase 5 산출물 맵

| 영역 | 파일 경로 | 작업 | 핵심 계약 |
|---|---|---|---|
| Codex OAuth | `src-tauri/src/auth/codex_oauth.rs` | 5-1 | `PkcePair::generate` + `CodexOAuth::{authorization_url, exchange_code, refresh}` + `decode_account_id` |
| Codex Provider | `src-tauri/src/providers/codex/mod.rs` | 5-1 | `CodexProvider::new(tokens, oauth)` — `ChatGPT-Account-ID` + `OpenAI-Beta: responses=v1` 헤더 |
| Codex IPC | `src-tauri/src/ipc/codex_oauth.rs` | 5-1 | 5 커맨드 (start/complete/status/logout/refresh) + PENDING static flow state |
| MCP Client | `src-tauri/src/mcp/client.rs` | 5-2 | `McpClient::initialize / list_tools / call_tool` (JSON-RPC 2.0) |
| MCP Transport | `src-tauri/src/mcp/transport.rs` | 5-2 | `Transport` trait + 3 impl (Stdio/Http/Mock) |
| MCP DAO | `src-tauri/src/mcp/dao.rs` | 5-2 | v3 마이그레이션 `McpServer` 테이블 + 순수 함수 CRUD |
| MCP Registry | `src-tauri/src/mcp/registry.rs` | 5-2/5-3 | `McpServerRegistry::{connect, connect_and_initialize, build_adapters, register_adapters}` |
| MCP Tool Adapter | `src-tauri/src/mcp/tool_adapter.rs` | 5-3 | `McpToolAdapter` (Tool trait 구현) + `qualified_tool_name(server, remote)` |
| MCP IPC | `src-tauri/src/ipc/mcp.rs` | 5-2/5-3 | 6 커맨드 (add/list/remove/set_enabled/test_connect/list_tools) |
| MCP Provenance UI | `src/components/mcp/{provenance.ts, McpProvenanceBadge.tsx}` | 5-3 | `parseMcpProvenance(name)` + `<McpProvenanceBadge>` (info Badge + Plug 아이콘) |
| Ambiguity Detector | `src/lib/ambiguity.ts` | 5-4 | `detectAmbiguity(text)` — 5 정규식 룰, 한국어 전용 |
| Templates | `src/lib/prompt-templates.ts` | 5-4 | 8 템플릿, D/I/V/E 단계 매핑 |
| Prompt Helper Panel | `src/components/prompt-helper/PromptHelperPanel.tsx` | 5-4 | 280px aside + 단계별 템플릿 + 클릭 삽입 |
| Ambiguity Hinter | `src/components/prompt-helper/AmbiguityHinter.tsx` | 5-4 | `AmbiguityUnderlay` + `AmbiguityHintList` (500ms debounce) |
| Prompt Check Engine | `src-tauri/src/dive/prompt_check.rs` | 5-5 | `PromptCheckEngine::review(text, stage?)` — single-tool `prompt_review` |
| Prompt Check IPC | `src-tauri/src/ipc/mod.rs` (`prompt_check_review`) | 5-5 | IPC 커맨드 1개 |
| Prompt Check Dialog | `src/components/prompt-helper/PromptCheckDialog.tsx` | 5-5 | 4-phase + 3-way footer + 토큰 사용량 |
| Phase 5 Integration Page | `src/pages/phase5-integration.tsx` | 5-6 | 5 feature 카드 + 랜딩 |
| E2E Test | `src-tauri/tests/phase5_e2e.rs` | 5-6 | Codex + MCP 결합 Agent Loop |

## 새 IPC 커맨드 (Phase 4 기준 +12)

- Codex OAuth (5개): `codex_oauth_start / complete / status / logout / refresh`
- MCP (6개): `mcp_server_add / list / remove / set_enabled / test_connect / list_tools`
- Prompt Check (1개): `prompt_check_review`

---

## Phase 6 진입 시 권장 순서

| 순서 | 작업 | 이유 / 의존성 | 예상 규모 |
|---|---|---|---|
| 1 | **6-1** 다국어 (ko/en) | 5-4 모호함 감지 메시지, 5-5 UI 문구 등 한국어 하드코딩 다수. 영어 추가는 기존 UI를 전반적으로 건드릴 것이라 먼저 하는 편이 효율적 | 큼 |
| 2 | **6-2** 접근성 (키보드 / ARIA / 스크린리더) | 5-1 ~ 5-5의 신규 모달/패널 검증 필요. 6-1 i18n 이후에 진행해야 aria-label 다국어 처리 중복 작업 방지 | 큼 |
| 3 | **6-3** 접근성 폴리싱 + 색상 대비 | 5-3 info 배지, 5-5 warn/success 카드 색 대비 점검 대상. axe-core 또는 Playwright + 대비 계산 스크립트 | 중간 |
| 4 | **6-4** NSIS 패키징 (x64 + ARM64) | 4-5에서 GitHub Actions 빌드는 자동이지만 EV 코드 서명 + SmartScreen 우회 문서 확정 필요 | 큼 |
| 5 | **6-5** GitHub 릴리스 + 라이선스 + README | 정식 배포. Phase 4/5 docs와 통합 README 작성 | 중간 |

---

## Phase 5에서 이어받을 계약 (Phase 6가 준수해야 함)

- **Keyring 3-scope Codex 분리**: `SecretScope::Codex{Access,Refresh,Id}Token`. Phase 6 다국어에서 i18n 키 추가 시 어떤 scope도 건드리지 않음.
- **`mcp__{server}__{tool}` 네임스페이스 규약**: 변경 금지. 다국어는 Badge 텍스트만 번역 (`MCP · {label}` 유지).
- **Ambiguity Detector 정규식 룰**: 한국어 한정 — Phase 6 en 로케일 추가 시 별도 영어 정규식 룰 세트를 추가(`detectAmbiguity(text, locale?)` 확장)하되 한국어 룰 그대로 유지.
- **Prompt Check usage 필드 이름 `approximate_tokens`**: 프론트 다이얼로그 및 Rust 필드 이름 고정. Phase 6 토큰 환산 UI는 이 숫자를 소비만 함.
- **MockProvider + MockTransport + wiremock 테스트 전략**: Phase 6도 네트워크/실 계정 의존 금지. CI에서 돌아가야 함.

---

## Phase 5에서 의도적으로 미룬 항목 (Phase 6가 흡수)

- **`AppState`에 MCP client 캐시**: 현재 `mcp_server_test_connect`는 매 호출마다 새 연결 생성. 실사용에서는 enabled 서버를 앱 시작 시 한 번 연결 후 캐시해야 함. Phase 6-4 NSIS 패키징 준비 중 Rust 측 lifecycle로 추가.
- **Codex provider를 AgentLoop에 실제 주입**: `AppState::new`는 단일 provider를 잡음. Codex 선택 시 provider factory 필요. Phase 6-1 다국어와 함께 i18n 키 주입 지점을 재검토하면서 처리.
- **LocalHost OAuth 콜백 서버**: 현재는 code paste UI만. axum 기반 localhost:1455 수신 서버 추가는 사용자 편의 향상이나 방화벽 상황에서 paste fallback이 이미 충분. Phase 6-5 릴리스 노트에 "paste 모드가 기본" 명시.
- **rmcp crate 전환 판단**: ADR-028에서 "5-6 통합 테스트 이후 재검토" — 현재 직접 구현이 충분하므로 Phase 6에서도 유지 결정. Streaming notifications 또는 MCP OAuth 지원이 필요한 프로덕션 MCP 서버를 파일럿에서 만나면 재평가.

---

## 검증 명령 레퍼런스 (Phase 6 세션 첫 단계에서)

```bash
# Rust 전체
cd dive/src-tauri
cargo test --all-targets                      # 238 passed / 0 failed / 1 ignored 이어야 함
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings

# 프론트 전체
cd dive
pnpm typecheck && pnpm lint --max-warnings 0 && pnpm format:check && pnpm build

# Playwright (dev :1420에서)
pnpm dev   # 한 터미널
for s in workmap chat permission slide-in integration state-machine tool-guard verify-engine \
         checkpoint provisioning export onboarding project-session settings timeline \
         error-toast polish codex-oauth mcp-setup mcp-integration prompt-helper \
         prompt-check phase5-integration; do
  node scripts/verify-$s.mjs || break
done
```

---

## 커밋 패턴 (Phase 2~5 계승)

작업당 2 커밋:

1. `feat(<scope>): <짧은 설명> (task 6-N)` — 구현 + 테스트
2. `docs(sot): close task 6-N (<제목>) and stage task 6-(N+1) (<다음 제목>)` — SoT 4파일 갱신

6-5 완료 직후에는 두 번째 커밋 메시지를 `docs(sot): close task 6-5 and mark [PHASE_GATE] for Phase 6 end`로 변경하고 v1.0 릴리스 태그를 추가.

---

**Phase 5 완료. Phase 6 진입 대기 중.**
