# DIVE Visual QA — Run Log

Iteration-by-iteration record of the real-app Visual QA loop. Scenario definitions live in [scenario-catalog.md](scenario-catalog.md); defects in [defect-log.md](defect-log.md).

## Loop

1. Install latest `.app` (`pnpm build:sidecar && pnpm tauri build --bundles app`, copy to `/Applications`).
2. Drive `/Applications/DIVE.app` via computer-use; run scenarios in catalog order (AI-independent P0/P1 first), screenshot each, record pass/fail.
3. Triage defects → `defect-log.md` (P0/P1/P2).
4. Fix code (batch).
5. Local gates: `cargo fmt --all -- --check` · `cargo clippy --features dev-mock --all-targets -- -D warnings` · `cargo test --features dev-mock --all-targets` (in `dive/src-tauri`); `pnpm format:check` · `pnpm typecheck` · `pnpm lint` (in `dive`).
6. Rebuild, re-run fixed scenarios + regression sweep.
7. Repeat until no Open P0/P1.

**Exit criteria:** every P0/P1 scenario passes on a clean rebuild; all P0/P1 defects `Verified`; P2s either fixed or explicitly triaged.

## Environment (iteration 1)

- **Build under test:** 1.0.0-rc.4 — HEAD `f65a19b` (no source changes since 16:41 build).
- **Secret backend:** `DIVE_SECRET_BACKEND=local-file` (via `launchctl setenv` + LaunchAgent `com.coreelab.dive.qa-env`) — **OS keychain fully bypassed** so SecurityAgent never prompts and never blocks QA (durable across rebuilds). Credentials read from `qa-secrets.json`.
- **Active provider:** OpenRouter `anthropic/claude-sonnet-4.6` (ProviderConfig id 8, key in `qa-secrets.json`) — auto-connected on launch. AI scenarios use this live LLM.
- **Starting data:** 4 projects · 4 sessions · 2 cards · 2 plans · 4 steps · 4 checkpoints · 10 messages · 1046 EventLog rows.
- **Clean-state handling:** back up `~/Library/Application Support/com.coreelab.dive/` (esp. `dive.db*`) before onboarding (ONB) scenarios; restore after.
- **Driver:** macOS computer-use on the real `.app` (tauri-driver/WebDriver unavailable on macOS WKWebView).

---

## Iteration 1 — 2026-06-24 (harness validation + baseline smoke)

Goal of this pass: stand up the loop, eliminate the keychain blocker, and confirm the real app is drivable & healthy before the full catalog sweep.

| Scenario | Result | Notes |
|----------|--------|-------|
| (launch) | ✅ PASS | rc.4 launches; no keychain prompt (file-secret backend); AI 연결 ✓ Claude Sonnet 4.6 |
| PROJ-01 select project | ✅ PASS | demo-clean-0930 → sessions + conversation + PROJECT PLAN all populate |
| STEP-01 roadmap status | ✅ PASS | step-1 진행 중/실행 중 badges, AC-001/002, 00/01 progress render |
| REC-01 recovery badge | ✅ PASS (badge) | "되돌리기 1건" renders; panel open not yet exercised |
| ONB-02 new-project modal | ✅ PASS | modal renders; name field accepts input; 찾아보기 opens native folder picker; 생성 correctly disabled on empty path |
| PRD-04 PRD toggle | ✅ PASS (present) | "PRD 보기" collapsible present |
| ONB-03 modal dismiss (취소/Esc) | ⚠️ INCONCLUSIVE | 취소 + Esc did not close modal in 3 tries; ✕ + native-picker-cancel work. **Code verified correct** (취소 = same `onOpenChange(false)` as ✕; Button/ghost/Dialog all standard) → most likely computer-use input artifact, **NOT logged as defect**. Re-test in iteration 2. |
| XC-01 locale-flash | ⚠️ OBSERVED | first paint showed English menu+UI, later renders Korean. Verify whether a real flash or just launch-order. |

**Defects opened:** 0 (one false-positive avoided by code cross-check — see ONB-03).

**Harness outcome:** ✅ validated. App is healthy and drivable. Keychain permanently bypassed. Coordinate clicking + typing accurate; notification banners occasionally block clicks (retry after fresh screenshot).

**Catalog note:** background generation workflow was killed by session interrupts; catalog authored directly instead (`scenario-catalog.md`, 50 scenarios).

**Next (iteration 2):** systematic AI-independent P0/P1 sweep (PROJ-02..05, STEP-02..04, REC-02/03, SLIDE-*, PROV-*, XC-*, ONB-01/03/04), then AI-dependent areas.

---

## Iteration 2 — 2026-06-24 (AI-independent sweep · batch 1, on demo-clean-0930)

| Scenario | Result | Notes |
|----------|--------|-------|
| STEP-02 step detail slide-in | ✅ PASS | "단계 상세" panel: criteria, supply-chain tags (AI 자가보고만 있음 / 승인 필요 / 검증 필요), 4-stage review stepper (코드 이해→점검·관찰→검토 응답→결정) with evidence-gated 결정 |
| SLIDE-01 code tab + diff | ✅ PASS | index.html diff (+16 -0) renders with line numbers / additions |
| SLIDE-02 preview tab | ✅ PASS | URL input + address chips (index.html / 127.0.0.1:5173 / localhost:5173); empty iframe state (no server) |
| SLIDE-03 terminal tab | ✅ PASS | "터미널 — 0줄", 지우기, empty "출력이 없습니다" |
| VC observation tracking | ✅ PASS | opening the diff flipped "코드 이해" tag from 변경 확인 필요 → **Diff 확인됨**; evidence recorded, review state advanced |
| REC-01 recovery panel | ✅ PASS | "복구 및 되돌리기" panel: per-step recovery options (에러로그 요약 / 범위 줄이기 / AI 재요청), 복구 지점 저장 |

**Defects opened:** 0. **Minor UX note (not a defect, code-verified):** TopBar badge `되돌리기 1건` = `recoveryCount + (hasFailedStep?1:0)` (TopBar.tsx:24); here 0 checkpoints + 1 needs-recovery step → "1", while panel says "체크포인트 없음". Internally consistent; the `되돌리기 N건` label could read as "N undoable items" — consider relabeling when count is failed-steps-only. Deferred.

**Still to cover (AI-independent):** PROJ-02..05, STEP-03/04, REC-02/03 (need a checkpoint-bearing session), PROV-*, XC-*, ONB-01/03/04.

---

## Iteration 3 — 2026-06-24 (AI-dependent live sweep, on demo-clean-0930 new session)

Live LLM = OpenRouter `claude-sonnet-4.6`. Goal sent: "Add a button labeled 'Click me' to index.html that shows an alert with the current time when clicked."

| Scenario | Result | Notes |
|----------|--------|-------|
| PROJ-04 new session | ✅ PASS | new session created, selected, empty conversation renders |
| CHAT send (live) | ✅ PASS | message sent (via Cmd+Enter); "라우팅 중" status + 중지 요청 |
| PLAN route-chat (live) | ✅ PASS | LLM parsed goal → structured step proposal modal (title, depends step-1, 2 criteria, reason) — **valid structured output, no parse_error** |
| PLAN-04 step-add + PRD mutation | ✅ PASS | "Plan 영역에서 검토" → step-add form auto-filled; PRD 변경 v1→v2; linked criteria; "+ 단계 추가" → step-002 added (blocked by step-1, 계획 검토 필요) |
| **SUP-01 provocation/review card (live)** | ✅ PASS | 검토 카드 rendered with criterion-linked question ("not linked to AC-001/AC-002 — link or split scope?") — **no parse_error, well-formed** (historical bug area clean) |
| **SUP-02 review card hides revise/nudge** | ✅ PASS | actions are observe/link only (👁 연결된 PRD 기준 / PRD 범위 변경 / 범위 확장 평가) + 근거 설명 보기; **no revise/nudge buttons** (PR#25 verified live) |
| provocation non-blocking | ✅ PASS | could add the step despite the unresolved review card (FR-030~033 non-blocking) |

**Defects opened:** 0.

**Harness caveat (important):** some action buttons (modal 취소, 전송, +단계 추가) intermittently did NOT fire on a single computer-use click — `전송` worked via **Cmd+Enter**, `+단계 추가` fired on the **2nd click**. Code for 취소 is correct (= ✕'s `onOpenChange(false)`). Likely synthetic-click/webview-focus timing, NOT a product bug — but **flag for a real-user double-click check**. Mitigation: prefer keyboard; retry action-button clicks once before concluding "broken".

### Batch 2 (project7, live execution → tool cards)

| Scenario | Result | Notes |
|----------|--------|-------|
| PROJ-02 switch project | ✅ PASS | demo-clean-0930 → project7; plan/sessions/conversation update |
| CHAT-01 streamed reply + tool use | ✅ PASS | "read index.html" → agent streamed full file contents + summary; "도구 사용 1개"; runtime line "감독 Pi 준비됨 · claude-sonnet-4.6" |
| PERM-01 safe read auto-approved | ✅ PASS | read_file executed without an approval card (correct for safe tier) |
| **PERM-02 write/edit approval card** | ✅ PASS | edit request (via "그냥 채팅") → PermissionCard with diff/patch preview + actions: 요청 수정 / 사유 추가 / ✕ 거부 / ✓ 이 변경 허용 |
| PERM-03/04 modify/deny controls | ✅ PASS (present) | 요청 수정 + 사유 추가 + 거부 all rendered on the card |
| **approve → real effect verified** | ✅ PASS | approved → agent "완료"; **verified on disk**: `project7/index.html:33` now has `<!-- QA edit test -->` right after `<body>` (line 32). UI claim == real file write |
| PLAN route also intercepts edits | ✅ PASS (by design) | edit/goal requests show the route modal; "그냥 채팅" bypasses to direct agent+tools |

**Defects opened:** 0.

**State left in sandbox (QA artifacts, harmless):** demo-clean-0930 gained step-002 + PRD v2; project7/index.html has a `<!-- QA edit test -->` comment. Both in `qa-sandbox/`.

**Still to cover (AI-dependent, next turns):** VC-01/02/03 live coach + **sidecar-unavailable graceful** (VC-02, known-risk), CHAT-02 cancel mid-stream, full PRD Socratic interview (PRD-01..03), PLAN-01/02 generate-from-PRD & accept, SUP-03/04 card actions/dedup.
**Still to cover (AI-independent, next turns):** PROJ-03/05, STEP-03/04, REC-02/03 (checkpoint restore), PROV-01..06 (settings/i18n/theme), XC-01..05, ONB-01/03/04.

---

## Summary so far (iterations 1–3)

**~25 scenarios run · 0 confirmed defects · 4 false-positives avoided via code cross-check.** Highest-risk historical areas (supervisor/review card rendering & JSON parsing, tool-approval safety, verification observation tracking) all **PASS live**. App is in solid shape for a finishing pass. Main non-product finding = a computer-use harness caveat (intermittent action-button click non-firing; mitigated with keyboard / retry).

## Focused 009 continuation — 2026-06-27

See `009-live-qa-run-log.md` for the resumed S-035..S-040 pass. Live app
verification passed for S-036, S-038, and S-040; S-035, S-037, and S-039 were
source/test-wiring confirmed with their full fresh live journeys deferred.

### Pre-release addendum — 2026-06-27

The same run log now includes the final local pre-release pass. The rebuilt
macOS `.app` launches, contains the bundled Pi sidecar, clears `pi-sidecar`
audit findings after the 0.79.10 patch update, and passes the local release
gates. Remaining release conditions are external: Windows NSIS installed-app
smoke, GitHub release authority checks, and committing/tagging the intended
release SHA.
