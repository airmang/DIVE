# S-049 Design — 010 deferred-tail closeout (P2-38 preview i18n · `--color-info` AA · S-047 Q2 form-step · S-045 primer EventLog)

**Status**: Approved (2026-07-02) — closes the four items the S-043/S-044/S-045/S-047 designs explicitly deferred to a follow-up. Not new product scope; it finishes the tail of the 010 round-2 umbrella.
**Stage**: Wily `S-049` (dive-2, `STG-5c95f8e6d08a`) · **Branch**: `010-beginner-readiness-ux`
**Out of scope (excluded on purpose)**: the S-048 process-tool plain-GET egress hardening (locked decision 6b) is running in a **separate session** (`task_f00a0561`); this stage must not touch `tools/guard.rs` or that follow-up.

**Provenance**: scoped by a 4-reader parallel workflow (`wf_80a58591-bd5`) + one focused re-scope agent, verified against the live code by root. Each item was confirmed at its exact `file:line` before design.

## Constitution check

- **I / V (real workflow, low-friction)**: no quiz/badge/score/wizard; S-047 validation is EventLog-only and **non-blocking** (never a user-facing card or gate), so it adds zero beginner friction.
- **IV (local-first ledger)**: S-045 makes primer exposure/dismissal auditable via the local EventLog/export; S-047 logs form-consistency annotations to the same ledger.
- **VI (typed seams / deterministic tests)**: P2-38 replaces prose with a typed log-code enum; S-047 consistency check is a pure deterministic function (no LLM re-judgment); every change carries a deterministic test.
- **II**: unaffected — none of these turn agent/AI output into verification evidence.

---

## Item 1 — P2-38: `preview.rs` hardcoded-Korean reuse strings → machine-code + frontend i18n (small)

**Current** (`dive/src-tauri/src/ipc/preview.rs`): two reuse-path log lines are hardcoded Korean in the `logs: Vec<String>` of the preview result:
- ~L682 `"이미 실행 중인 로컬 미리보기 서버에 연결했습니다."` (running server detected)
- ~L1044 `"이전에 시작한 미리보기 서버를 재사용했습니다."` (previously-started reused)

The user-facing `message` field on this path is already English; only the dev-facing `logs` vector carried Korean. `PreviewTab.tsx` pushes each `logs` line verbatim to the terminal panel via `pushTerminalLine`.

**Change**: emit a stable log **code** from Rust and localize in the frontend.
- Add a small `ReusedPreviewLogCode` enum (`running_server_detected`, `previously_started_reused`) with `code() -> &'static str`; replace the two literals with `code().to_string()`.
- Add i18n keys `slide_in.preview.reused.{running_server_detected,previously_started_reused}` to `ko.json` (the existing Korean strings) and `en.json` (English equivalents).
- In `PreviewTab.tsx`, map a known reuse code to `t("slide_in.preview.reused.<code>")`, else render the line verbatim (unknown lines pass through unchanged).

**Tests**: Rust unit — both enum variants emit the expected code; `parity.test.ts` catches any ko/en gap; PreviewTab test — a `logs` entry of `running_server_detected` renders the localized string.

---

## Item 2 — `--color-info` light token → WCAG AA on info badges (small)

**Current** (`dive/src/styles/globals.css`): light `--color-info: 56 104 200` (L76). The pervasive `text-info` on `bg-info/15` badge composite (over `bg-panel` = `238 242 242`) is **3.84:1** — below the 4.5:1 AA floor for normal-size text (all info badge usages are 10–12px). Dark `--color-info: 91 140 255` (L49) already passes and stays untouched.

**Change**: darken light `--color-info` to `40 90 180`.
- `text-info` on `info/15`-over-`bg-panel` → **4.66:1** ✓; on `info/10` → ~5.0:1 ✓; solid on `bg-panel` → ~5.8:1 ✓.
- Mirrors how S-044 chose `success`/`warn`/`danger` to clear the same tint composite.

**Tests**: add two `contrast.test.ts` cases (`badge info on info/15`, `chip info on info/10`, both `>= 4.5`), mirroring the existing success/warn/danger badge cases; all 28+ existing pairs and dark mode stay green.

---

## Item 3 — S-047 Q2: form-specific step scaffolding + step-vs-form validation (small, bounded)

**Current**: the student's `ArchitectureDecision` (bounded form enum `web_app|static_page|cli_tool|desktop_app|api_service|other` + free-text stack) is carried on the confirmed `ProjectSpec` and blocks confirmation, but the PRD→plan **decomposition** only uses it as loose grounding; per-form scaffolding guidance and any step/form consistency check were deferred (design-s047.md:73).

**Change** (two halves, both minimal):
1. **Form-specific step templates (generation)** — inject a **deterministic, DIVE-owned per-form scaffolding guidance block** (keyed off the bounded form enum) into the decomposition prompt so generated steps match the chosen form (e.g. a `static_page` build is steered away from server/db steps; an `api_service` toward endpoint/schema steps). Deterministic DIVE-authored text per form → no false-positive risk, no new gate; the LLM still proposes, DIVE records.
2. **Step-vs-form validation (checking)** — a pure deterministic `plan_form_consistency` function that flags a generated step **obviously** inconsistent with the form (high-confidence keyword/expected-files heuristics only; conservative to avoid noise). Result is logged to the EventLog as a **non-blocking annotation** (Constitution IV/VI) — **not** rendered as a user-facing review card or gate (Constitution V). The plan always generates and stores regardless.

**Bound**: no UI surface, no hard gate, no LLM re-judgment; keyword lists kept tight (only clear contradictions). If a step is ambiguous, emit **no** annotation (favor precision over recall so the research ledger isn't polluted for beginners).

**Tests**: Rust unit — deterministic same-input→same-annotation; each form's clear-contradiction case flags, each consistent case is silent, edge cases (empty expected_files / missing form) don't panic; integration — draft generates + annotations are EventLog-queryable/exportable and never block.

---

## Item 4 — S-045: primer exposure/dismissal → local EventLog (small)

**Current**: `PermissionCardPrimer` + `WebFetchPermissionCardPrimer` (`PermissionCardPrimer.tsx`) persist a dismissed flag in `ui-preferences` but log **nothing** to the EventLog (deferred; mirrors the un-logged `PreviewOnboardingCoachmark`). The frontend has no generic UI-event logging IPC today — only `provocation_log_event` (prefix-locked to `provocation.`).

**Change**: add a thin, reusable, prefix-validated IPC and fire it from the primers.
- Rust: new `ipc/ui_events.rs` command `log_ui_event(session_id, event_type, payload)` that accepts only the `permission_primer.` prefix and delegates to the existing `log_event` → `append_to_conn` helper; register in `ipc/mod.rs` + `lib.rs`. Add event-type constants `PERMISSION_PRIMER_SHOWN_EVENT` / `PERMISSION_PRIMER_DISMISSED_EVENT` in `event_log.rs`.
- Payload carries `{ variant: "generic" | "web_fetch" }` to distinguish the two primers (2 event types, not 4).
- Frontend: a shared `loadTauri()` helper (extract the existing verification-coach/provocation pattern into `src/lib/tauri.ts`); in each primer, a `useRef`-guarded `useEffect` fires `permission_primer.shown` **once** per mount (no double-log on re-render), and the dismiss handler fires `permission_primer.dismissed` before calling the store action.
- No secrets/redaction concern (payload is a constant variant tag); no i18n impact.

**Tests**: frontend — shown fires once, not re-fired on re-render, dismissed fires on click, for both variants (mock `invoke`); Rust — `log_ui_event` rejects a non-`permission_primer.` prefix and appends a row for a valid one; export includes the rows.

---

## Verification (root-owned)

Local CI must be green before merge: `cargo fmt --check`, `cargo clippy --all-targets --features dev-mock -- -D warnings`, `cargo test --all-targets --features dev-mock`; `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test:unit` (incl. `parity.test.ts` + `contrast.test.ts`). On completion, update the four source designs' Out-of-scope notes to mark each deferral **closed**, and update `docs/spec-status.md` 010 section. Live re-QA on a rebuilt app is recommended for the next interactive macOS session (this closeout is verified by tests + CI).
