# PHASE 3 착수 핸드오프

새 세션에서 이 파일만 보면 Phase 3 작업에 바로 진입할 수 있도록 요약했습니다.

## 현재 위치

- **브랜치**: `main` (origin보다 13 커밋 앞섬, 아직 push 안 함)
- **최종 커밋**: `54ddeac docs(sot): stage task 3-1 (DIVE I/V/E gates + card state machine) after Phase 2 approval`
- **Phase 2 완료**: 6/6 작업 ✓ (2-1 ~ 2-6, 12개 커밋)
- **Phase 3 대기**: 작업 3-1이 `DIVE_NEXT.md`에 적재됨

## 새 세션에서 첫 프롬프트 (추천)

```
DIVE_NEXT.md에 적힌 3-1 작업을 끝내줘. Phase 2와 동일한 방식(작업당 feat + docs 커밋 2개)으로 진행해.
```

또는 더 간단히:

```
3-1 진행해줘
```

## 기준 문서 (바뀌지 않음)

| 파일 | 역할 |
|---|---|
| `DIVE_SPEC.md` | SoT, 사용자만 수정. 3-1은 §4.1~§4.7 + §10.2/§10.3 참조 |
| `DIVE_PROGRESS.md` | 36개 작업 체크리스트. Phase 1·2 완료, 3-1부터 미시작 |
| `DIVE_NEXT.md` | **3-1 작업 상세**. 이번 턴에서 할 일 전부 여기 적혀 있음 |
| `DIVE_DECISIONS.md` | ADR 누적. 현재 ADR-012까지. 3-1에서 마이그레이션 v2 추가 시 ADR-013 필요 |

## Phase 2 종료 시점 상태 (새 세션이 참고할 기준선)

### Rust

- `cargo test` **62/62 통과** (lib 49 + agent_loop 10 + providers_integration 3)
- `cargo fmt --check` / `cargo clippy -D warnings` clean
- 주요 모듈 상태:
  - `src-tauri/src/db/` — 마이그레이션 v1 (9 테이블), 9 DAO, `CardState` 6 variants
  - `src-tauri/src/providers/` — Anthropic, OpenAI, Mock
  - `src-tauri/src/auth/` — keyring 추상화 + `SecretScope`
  - `src-tauri/src/tools/` — Tool trait + read_file/list_dir/write_file/edit_file + FsGuard
  - `src-tauri/src/agent/` — AgentLoop + AgentEvent + PermissionHook 4종 + PendingApprovals
  - `src-tauri/src/dive/` — **D 게이트만 구현**, I/V/E는 placeholder Allow (3-1에서 실제 구현)
  - `src-tauri/src/ipc/` — `chat_send` / `chat_cancel` / `tool_approve` / `tool_deny`

### 프론트엔드

- `pnpm typecheck` + `pnpm lint --max-warnings 0` + `pnpm format:check` + `pnpm build` 전부 통과
- Zustand 스토어 3개: `theme`, `slideIn`, `workmap`
- 라우트 7개: `/` + `?demo={workmap|showcase|chat|permission|slide-in|scenario-a}`
- 주요 컴포넌트:
  - `shell/` MainShell + Sidebar + ChatArea + WorkmapStrip
  - `chat/` 6 message 종류 + MessageList + ChatInput + types
  - `workmap/` CardTile(6 state) + WorkmapCardList + DiveProgress + AiAssistDialog(mock)
  - `permission-card/` Safe/Warn/Danger + DiffViewer(LCS) + ArgsEditor
  - `slide-in/` SlideInPanel(520px) + CodeTab/PreviewTab/TerminalTab
  - `ui/` Button/Badge/Card/Input/Tabs/Tooltip/Dialog

### Playwright (89/89)

- `verify-workmap.mjs` 16
- `verify-chat.mjs` 17
- `verify-permission.mjs` 14
- `verify-slide-in.mjs` 21
- `verify-integration.mjs` 21

## 3-1 작업 핵심 포인트 (`DIVE_NEXT.md` 요약)

### 백엔드 추가

1. **DB 마이그레이션 v2**: `workmap.current_card_id` 컬럼 추가
2. **`src-tauri/src/dive/state_machine.rs`**: `CardTransition` enum + `apply()` + `InvalidTransition` 에러
3. **`dive/gate.rs` 확장**: `check_stage_{i,v,e}` 실제 조건 구현
4. **Agent Loop**: `current_stage` 컨텍스트 + 시스템 메시지 주입 (`"현재 작업 중인 카드: {title}\n지시: {instruction}"`)
5. **IPC 3개 추가**: `card_transition` / `workmap_set_current_card` / `card_update_instruction`

### 프론트 추가

1. **Zustand workmap 확장**: `currentCardId`, `setCurrentCard`, `transitionCard`, `allCardsVerified` 셀렉터
2. **`CardDetailPanel` 모달**: 6 state별 UI 분기 + 전이 버튼 (Dialog 기반)
3. **ChatArea 배너 확장**: D/I/V/E 단계별 다른 메시지
4. **CardTile 클릭 라우팅**: state별 모달 vs 슬라이드 인
5. **`useChatSession` stage 추론**: 현재 카드 상태로부터 자동 stage 결정

### 검증

- `scenario-b-demo.tsx` + `?demo=scenario-b` (8번째 route)
- `scripts/verify-state-machine.mjs`
- 기존 5개 Playwright 스위트 회귀 유지

## Phase 3 전체 로드맵 (6개 작업)

| # | 제목 | 의존성 |
|---|---|---|
| 3-1 | DIVE 게이트 I·V·E + 상태 머신 | 2-6 |
| 3-2 | V 단계 AI 자체검증 + 최종 승인 | 3-1 |
| 3-3 | 체크포인트 (git2-rs) | 3-1 |
| 3-4 | 차단 명령 블록리스트 + 경로 제한 | 2-3 |
| 3-5 | OpenRouter Provisioning Keys | 1-5, 1-4 |
| 3-6 | 익명화 export (JSONL) | 1-3 |

3-6 완료 후 `[PHASE_GATE]` 마킹 → 사용자 확인 → Phase 4 (파일럿 직전 폴리싱).

## Phase 2 주의 — 3-1 진입 전 확인

아래 선택 사항을 새 세션 시작 시 명확히 해주시면 좋습니다:

1. `AiAssistDialog` 실제 LLM 연동은 3-1에 포함 vs 3-2로 미루기 (`DIVE_NEXT.md` 확인 질문 6번)
   - **현재 권장**: 3-2로 미루기
2. 카드 상세 UI는 별도 모달 vs 슬라이드 인 신규 탭 (확인 질문 1번)
   - **현재 권장**: 별도 Dialog 모달
3. E 진입 조건 엄격성 (확인 질문 3번)
   - **현재 권장**: 모든 카드 Verified 엄격

새 세션에서 해당 질문에 그냥 "권장안 따라" 라고만 말해도 무방합니다.

## 명령어 레퍼런스

```bash
# 프론트 검증
cd dive
pnpm typecheck && pnpm lint && pnpm format:check && pnpm build

# Rust 검증
cd dive/src-tauri
cargo test && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings

# 개발 서버 + Playwright (터미널 2개 또는 tmux)
cd dive && pnpm dev  # :1420
# 다른 터미널:
cd dive && node scripts/verify-state-machine.mjs  # 3-1에서 추가될 스크립트
```

---

**준비 완료.** 새 세션에서 `/new` 후 위의 "첫 프롬프트" 예시로 시작하시면 됩니다.
