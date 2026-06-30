# DIVE Round-2 Live QA — Run Log

**Date**: 2026-06-29 · **Build**: v1.0.0-rc.5 (`target/release/bundle/macos/DIVE.app`, built from `d81956a`, one version-bump commit behind audit base `4bffb38`) · **Driver**: macOS computer-use · **Locale**: ko (primary)

**Purpose**: Empirically confirm the highest-impact Round-2 audit findings ([`round2-audit-findings.md`](round2-audit-findings.md)) on the real app **before** implementing the S-041–S-048 fixes. Live QA's unique value over the code audit: confirm findings actually manifest to a user, catch runtime/LLM-behavior issues (does the AI really say "ready to confirm" early? does it leak English on Korean screens?), and surface any new issues.

**Must-confirm-live journeys** (per spec 010 §Validation): S-041 PRD dead-end · S-042 offline verify-provocation · S-043 Korean roadmap English leak.

**Env**: seeded `local-file` secret backend (`DIVE_SECRET_BACKEND=local-file`), existing `dive.db` (provider connected from prior QA). New project created for clean PRD-interview state.

---

## Verdict legend
- **CONFIRMED** — finding reproduces live as the audit described.
- **CONFIRMED+** — reproduces and is worse / has extra facets than audit noted.
- **PARTIAL** — reproduces but milder / narrower than audit framing.
- **NOT-REPRO** — could not reproduce; audit may be code-only or already-mitigated at runtime.
- **NEW** — issue observed live that is not in the audit.
- **BLOCKED** — could not test (env/driver limitation).

---

## Session timeline

- **11:30** — Launched rc.5 bundle. Opened to existing project `Live-careful-04` (PRD+plan done, mid-execute). Provider connected (Anthropic Claude Sonnet via OpenRouter). No keychain prompt (local-file backend works).
- **11:31** — Zoomed post-approval roadmap rail → **S-043/P1-16 confirmed** (see matrix). UI-chrome English (`START/OPEN/LOCKED/DONE/needs`) sits beside Korean status chips (완료/준비됨/막힘). Step titles/AC text are English because *this project's PRD was authored in English* — that is content, not a UI leak (D13 distinction noted).
- **11:32** — New-project dialog (J2). Typed unsafe path `/System/Library/dive-qa-denied` → **P1-06 confirmed**: red error `create project dir: Operation not permitted (os error 1)` — raw English Rust string on the Korean dialog. Dialog copy has no empty-folder guidance → **P1-07 confirmed**. (Minor: stale error text does not clear when the path is corrected, until next submit.)
- **11:33** — Created clean project `round2-prd-deadend` at `qa-sandbox/`. Get-Started checklist shows ①프로젝트 열기✓ ②AI 연결✓(Claude Sonnet 4.6) ③요구사항 초안 작성(PRD 작성, active) ④계획과 세션 만들기(pending). Composer at bottom is **enabled** with no PRD/plan present → **P1-08 (composer-enabled) confirmed visually**.
- **11:34** — Opened PRD Authoring Board (PRD 작성). Canvas has 6 fields: 목표 / 의도 요약 / 범위 / 하지 않을 일 / 제약 / 수락 기준 — **no architecture/stack field → S-047(a) confirmed** (owner's Theme 7a observation is real). Field labels `의도 요약`, `수락 기준` are bare jargon, no gloss line → **P1-11 confirmed**. Empty-draft footer lists 5 gate requirements as passive negations → **P1-10 (negation footer) confirmed**; both PRD 확정 buttons render muted/disabled.
- **11:35** — Interview turn 1 (goal: simple add/delete to-do web page, solo use). One message populated 목표 + 의도 요약 + 2 ACs; DIVE asked a good Socratic follow-up about persistence. So far NOT the premature "ready" — interview kept asking. (P1-09/10 did not reproduce at goal+1AC; model went further.)
- **11:37** — Interview turn 2 (answered: should persist across refresh/reopen). Captured into 제약 + added AC-003. 범위 + 하지 않을 일 still empty; footer: "범위가 아직 비어 있습니다 / 이번에 하지 않을 일 최소 1개". **Note**: the 대화 보내기 send button consistently needs a 2nd click (1st click silently no-ops) — same intermittent-button harness issue logged in round-1.
- **11:38** — **S-041 / P1-09 DEAD-END CONFIRMED LIVE.** DIVE's reply: *"좋아요! … 이제 PRD에 필요한 내용이 충분히 갖춰졌어요 🎉 화면 상단의 'PRD 확인(Confirm)' 버튼을 눌러서 PRD를 완성해 보세요!"* — while 범위 + 하지 않을 일 are empty, the footer still demands them, and the PRD 확정 button is disabled. Clicked PRD 확정 → **nothing happens** (no confirm, board stays). DIVE stopped asking questions (abandoned before scope/non-goals) → **P1-10 confirmed**. Extra: DIVE names the button **"PRD 확인(Confirm)"** but the actual label is **"PRD 확정"** (prose↔UI label mismatch — NEW micro-issue).
- **11:39** — Probed recoverability: clicked into 범위 field and typed → **canvas text fields ARE manually editable**, and the footer requirement cleared reactively. So the dead-end has a manual escape *if the novice notices the passive footer and edits the canvas* — but DIVE never points there and the disabled button gives no reason. Refines S-041 fix: the gap is reconciling AI "ready" with the gate + voicing missing fields conversationally; manual editing of scope/intent/non-goal already exists (the separate P1-30 "add criterion" affordance for the AC list still needs its own check on an AI-won't-extend draft).

## Findings confirmation matrix

| ID | Journey | Audit claim (short) | Live verdict | Note |
| --- | --- | --- | --- | --- |
| P1-16 (S-043) | J5 roadmap | ko-locale roadmap renders primary action buttons in English (`Start/Resume/Open/Locked/Done`, dep `needs`) | **CONFIRMED** | Live on `Live-careful-04`: `01/03 DONE`, step-1 `OPEN`, step-2 `▶ START`, step-3 `LOCKED`, `↳ needs step-1`. Status chips correctly Korean → English buttons more jarring beside them, exactly as audit predicted. |
| P1-06 (S-043) | J2 create-project | project-create failure shows raw English Rust error on Korean dialog | **CONFIRMED** | Unsafe path → `create project dir: Operation not permitted (os error 1)` verbatim. No plain-Korean, no actionable guidance. |
| P1-07 (S-045) | J2 create-project | no guidance to pick a new/empty folder | **CONFIRMED** | Dialog copy = "작업할 폴더를 선택하세요. 선택한 폴더에 `.dive/`가 자동 생성됩니다." only; no empty-folder hint. |
| P1-08 (S-046/S-041) | J3 describe-goal | composer enabled under Get-Started while no PRD/plan exists | **CONFIRMED (visual)** | Composer active on Get-Started screen. (Did not send a raw goal; audit's own verifier already softened the "raw build turn" harm framing — confirming only the composer-enabled fact.) |
| P1-09 (S-041) | J4 PRD-interview | AI says "ready to confirm" while Confirm button disabled + footer demands more | **CONFIRMED** | DIVE: "충분히 갖춰졌어요 🎉 …'PRD 확인(Confirm)' 버튼을 눌러서 완성하세요" with 범위+하지않을일 empty, footer still demanding them, PRD 확정 click = no-op. The headline dead-end, reproduced exactly. |
| P1-10 (S-041) | J4 PRD-interview | gate requirements only voiced as passive footer negations; interview stops asking | **CONFIRMED** | Interview captured goal/intent/3 ACs then declared done; never asked for 범위 or 하지않을일 — those appear only as red footer negations. |
| P1-11 (S-041/S-045) | J4 PRD canvas | `의도 요약` / `수락 기준` bare jargon labels, no inline gloss | **CONFIRMED** | Canvas labels show only the jargon term + a placeholder; no gloss distinguishing 의도 요약 from 목표, or explaining 수락 기준. |
| S-047(a) | J4 PRD canvas | PRD has no architecture/stack concept; interview never raises it | **CONFIRMED** | Canvas has exactly 6 fields, none for application form or stack; interview drove to "confirm" without ever deciding how it's built. Owner's Theme 7a is real. |
| Theme 7(b) | J4 PRD interview | answer placeholder hardcoded a biased teacher/grading example | **CONFIRMED (in rc.5)** | rc.5 build still shows "예: 선생님이 학생 과제할 때 누락된 제출물을 바로 보고 싶어". Today's working-tree neutralization fix is not in this build yet. |
| — (NEW) | J4 PRD interview | prose↔UI label mismatch | **NEW** | DIVE prose calls the button "PRD 확인(Confirm)"; the actual button label is "PRD 확정". Compounds the dead-end confusion. |
| — (NEW) | J2 create-project | stale error not cleared on input change | **NEW (minor)** | The red create-error persists after the path is corrected, until the next submit attempt. |
| D04 / D05 (S-042 context) | J6 step-review verify gate | audit feared `✓ 검증 완료` from AI self-report (automation bias) | **REFUTED on this surface** | Ran step-2 on `Live-careful-04`. Review card shows honest chips **"외부 테스트 없음 / 승인 필요 / 검증 필요"** (never "검증 완료"), and a 3-step gate (코드 이해→점검·관찰→결정) where **"승인은 기준 연결 관찰이나 검증 증거가 있어야 활성화됩니다"** — approval is evidence-gated, not a rubber-stamp. The step-review path is well-built; the audit's automation-bias gaps live on *other* surfaces (plan-critique P1-14, Danger-tier P1-17), not here. |
| D13 (S-043) | J6 runtime status line | — | **NEW (minor leak)** | Runtime line reads "감독 Pi 준비됨 · openrouter/anthropic/claude-sonnet-4.6 · **provider is eligible for supervised Pi runtime**" — trailing clause is English on the Korean screen. |
| — (NEW) | J6 step-review | empty-diff review | **NEW (note)** | step-2 review showed "변경 파일 0개 — Diff를 열어 확인하세요" (0 changed files but asks to open a diff). Likely the agent's edit was a no-op because `Live-careful-04`'s index.html already had the button from a prior QA run; flag for the stepper-honesty area (round-1 S-036), not a clean defect. |
| P1-17 / P1-21 (S-042) | J6 Danger-tier / offline | Danger-tier delete/shell zero friction; verify-provocation drops offline | **NOT LIVE-TESTED** | step-2 is a file-write (Warn tier), not Danger; offline drop needs a contrived runtime-unavailable. Both remain code-level confirmed by the audit; need a delete/shell step + a network-off run to confirm live. |
| P1-03 / P1-04 / P1-05 (J1) | J1 onboarding | Codex OAuth English fields; API-key gloss; connect-error hints | **NOT LIVE-TESTED** | Provider already connected (seeded), so first-run onboarding is skipped. Needs a fresh/no-provider state to reach these. |

## Positive observations (design working as intended)

- **Evidence-gated step approval (D04/D05)** — the step-review verify gate refuses to activate approval without a criterion-linked observation or verification evidence, and labels evidence honestly ("외부 테스트 없음 / 검증 필요"). This is the core anti-automation-bias mechanism working.
- **Preview honesty framing (D04)** — the Preview/결과 확인 surface states "**DIVE는 결과를 보여주고, 작동 여부는 AI가 아니라 사람이 확인합니다**" in plain Korean.
- **Inline specificity coaching (D03/C1)** — typing a vague "추가해줘" surfaced an inline hint "무엇을 대상으로 하는 명령인지(파일·함수·UI 요소) 덧붙여 주세요".
- **PRD interview Socratic quality** — the interview asked a genuinely useful persistence follow-up and captured intent + 3 ACs; the dead-end is specifically the premature "ready" + disabled button + abandoned scope/non-goals, not poor interviewing.

## Conclusions

1. **The headline finding S-041 (PRD interview dead-end) is real and reproduces exactly** — DIVE says "충분히 갖춰졌어요 🎉 확정 버튼 누르세요" while the button is disabled and scope/non-goals are still required. Highest-priority fix; live QA also surfaced the prose↔UI label mismatch ("PRD 확인" vs "PRD 확정") to fold in.
2. **S-043 (Korean parity) is real** on the roadmap rail (Start/Open/Locked/Done/needs) plus a runtime-status English clause.
3. **S-047(a)** (no architecture/stack in the PRD) is confirmed as a real gap, exactly as the owner observed.
4. **The anti-automation-bias *step-review* gate is already solid** (evidence-gated, honest chips). S-042's real targets are the Danger-tier permission card (P1-17) and the offline verify-provocation drop (P1-21), which were not reachable in this pass and stay code-level until a delete/shell step and a network-off run are exercised.
5. **Harness note** — the 대화 보내기 / 전송 / PRD 확정 buttons frequently no-op on the first click and need a second click (round-1's intermittent-button issue persists in the QA driver, not necessarily a product defect). A stuck macOS Notification Center click-catcher also blocked input mid-session; cleared via OS-level Escape (`osascript … key code 53`).

**Recommendation**: proceed to implement Round-2 fixes, leading with **S-041** (highest-impact, fully confirmed), then **S-043** (Korean parity, high confidence, low risk) and **S-047** (architecture decision, owner-mandated). Defer the live confirmation of P1-17/P1-21 (S-042) and J1 onboarding (P1-03/04/05) to a targeted follow-up pass that contrives a Danger-tier step, a network-off run, and a fresh-onboarding state.

---

## Owner-reported: plan-confirmation loop after a too-quickly-confirmed PRD (2026-06-30)

Owner observed (solo testing): *"PRD를 너무 빨리 확정 짓더니 계획서 만드는 단계에서 내용이 부족해서 계획 확정을 못한다는 무한 루프에 빠져버리던데"* — a downstream consequence of S-041. Investigated this before starting implementation.

**Live repro attempt 1 (moderate PRD)** — confirmed `round2-prd-deadend` PRD (goal + intent + scope[junk "테스트범위입력"] + 1 non-goal + 3 ACs), then "이 PRD로 계획 만들기":
- A **"계획 인터뷰"** panel briefly appeared ("질문 6개 더 남았어요 / ✓ 인터뷰 완료") then resolved.
- Plan **generated fine**: 3 sensible steps (HTML 구조 → 추가/삭제 JS → 로컬스토리지 영속성), each AC-linked with dependencies.
- Plan-critique gate (**P1-14**) present: "이 계획에 빠진 단계가 있나요? 없음 — 승인 가능 / 있음 — 변경 요청".
- Picked "없음 — 승인 가능" → "✓ 승인" → **plan approved cleanly (step-1 ▶ START, 00/03)**. **No loop with a moderately-filled PRD.**
- ⇒ The loop is **conditional** on a thinner/more-vacuous PRD or a specific path (likely the "계획 인터뷰" never reaching "인터뷰 완료" when criteria are too thin, and/or the LLM failing to link every step to a PRD criterion so the plan-confirm gate keeps rejecting and re-requesting). A background code workflow (`w546u6lhd`) is root-causing the exact mechanism + trigger condition; a targeted repro with a truly vacuous PRD follows once the condition is known.

**NEW finding (plan step) — internal prompt + PRD JSON leak**: after plan approval, the conversation log renders the **verbatim English plan-generation system prompt** ("Each step must include: step_id, title, summary, instruction_seed, expected_files, … step_kind must be one of feature, refactor, rename, comment, debug … Do not include Markdown fences or prose.") followed by **`Saved PRD JSON: {"goal":…,"scope":"테스트범위입력",…}`**. A true-novice Korean student sees raw engineering instructions + raw JSON in their chat. Not in the round-2 audit; flag for S-043/S-046 (or a clean-conversation fix). (Nuance: appears under the center conversation/`PRD 보기` area — verify whether default-visible vs one-click expand.)

### Root cause (code workflow `w546u6lhd`, adversarially verified, + own spot-check) — CONFIRMED

The loop is the **same defect class as S-041**, now at the PRD→plan boundary, plus a **no-progress retry**. Three-tier threshold mismatch:

- **Tier A — PRD interview readiness**: `prd_interview_next_focus` returns `ready_to_save` once `is_confirmable_project_spec_draft` is true, which is a literal alias of *goal + ≥1 non-empty active criterion* (`workspace_plan.rs:1745-1767, 2099-2114`). Verified in source.
- **Tier B — plan-generation admission**: `workspace_plan_generate_draft_impl` admits on the same `is_minimal_project_spec` (`workspace_plan.rs:2744-2750`).
- **Tier C — plan-confirm content gate**: `validate_criterion_quality(&interview.goal, &plan_input)` (`workspace_plan.rs:2752`, def `4480-4559`) is far stricter — it validates the **generated plan's** criteria for per-criterion observable markers AND, **keyed off goal keywords**, full state-class coverage: a UI goal (`ui_goal_keywords()`) must cover **Responsive + Persistence + Accessibility**; a data-fetch goal must cover **Loading + Empty + Error** (`dive/src-tauri/src/dive/plan_quality_constants.rs:358-374`).

Because A/B admit a PRD that C can reject, plan-confirm is unreachable whenever the model-generated plan criteria miss a required state class. **The loop edge**: on failure the UI renders `PlanDraftRecoveryScreen` (only **Retry** + **Close**, no inline editor/add-step/force-confirm, no link back to PRD authoring — `PlanDraftRecoveryScreen.tsx:36-92`). **Retry** = `handleRetryPlanDraft` (`useProductShellController.ts:1840-1849`) which resends the **unchanged `interview.goal`** via `compact_retry_prompt` (`en/ko.json:958`) — a prompt that only restates JSON shape/step-count and passes the failure **enum slug** as `{{reason}}`; it **never tells the model which missing criterion classes to add** (the actionable `missingItems` are shown to the *user* but not fed to the model). So every Retry reproduces the **identical deterministic rejection with zero state change** → infinite "내용이 부족해서 계획 확정을 못한다".

**Refinements from the adversarial verifier** (conf 0.88): (1) trigger is **not every thin PRD** — a non-UI/non-data goal with 2 well-formed criteria passes; it bites when the goal hits ui/data keywords but the generated criteria miss a state class (explains why my moderate-PRD repro happened to pass: the capable model elaborated criteria that cleared the gate). (2) **Not strictly inescapable** — `Close` → FinalPrdReadView → Edit → PrdAuthoringBoard is a manual escape, BUT the recovery screen blocks PRD access while shown and never links there, and `validateConfirmableProjectSpec` (`projectSpec.ts:372-407`) does **not** check state-class coverage — so a student who just adds another generic criterion re-confirms and **bounces off `validate_criterion_quality` again**. For a beginner it reads as an inescapable dead-end.

**Fix direction** (fold into **S-041** — shared root cause): reconcile the PRD readiness/admission bar (Tier A/B) with `validate_criterion_quality` (Tier C) so the PRD interview drives toward state-class coverage *before* declaring ready (mirror the S-041 reconciliation); AND break the no-progress retry — feed the actual missing classes (`unresolvedQuestions`/`missingItems`) into the retry prompt and/or route the student from the recovery screen back to PRD authoring with the missing classes named. Files: `workspace_plan.rs` (gates), `useProductShellController.ts:1840-1849` + `en/ko.json:958` (retry), `PlanDraftRecoveryScreen.tsx` (escape affordance), `projectSpec.ts` (align confirmable gate).

---

## Live re-QA after S-041 fix (2026-06-30, freshly built `tauri build --bundles app`)

Rebuilt the app (release, includes Pass A/B/C) and re-QA'd the headline must-confirm journey in ko on a fresh project `round2-reqa-prd`.

| Check | Live verdict | Evidence |
| --- | --- | --- |
| **S-041 PRD dead-end fixed (P1-09/P1-10)** | **CONFIRMED FIXED** | Asked DIVE "이정도면 충분한 것 같아요. **이제 확정하면 될까요?**" with the draft not yet confirmable (no non-goal, <2 substantive criteria). DIVE replied **"아직 한 가지만 더 채워두면 완성이에요! 😊 …'처음부터 이런 건 넣지 않겠다'고 미리 정해두면…"** — i.e. it does NOT prematurely say "확정하세요"; it asks for the next genuinely-missing gate field (the non-goal) in plain Korean. PRD 확정 button stays disabled and the footer matches. The rc.5 dead-end ("충분히 갖춰졌어요 🎉 확정 버튼 누르세요" while disabled) is gone. |
| **Add-criterion affordance (P1-30)** | **CONFIRMED** | "+ 완료 기준 추가" button renders under the criteria; a trailing empty row (AC-002) appears after AC-001 gets text. |
| **Neutral placeholder (Theme 7b)** | **CONFIRMED** | Interview input placeholder is "여기에 답을 입력하세요" (no biased teacher/grading example). |
| **Field capture from conversation** | **CONFIRMED** | DIVE patched 의도 요약 + 범위 from casual answers; manually-edited 목표 preserved ("직접 고친 필드는 유지하고, 새 제안만 따로 보관했습니다"). |
| Plan-confirm loop (Pass B) | NOT FORCED LIVE | Requires a specific thin-PRD whose generated plan misses a state-class; covered by the adversarially-verified root cause + retry-progress/recovery-escape code + unit tests. The dead-end (the owner's primary live concern) is the one confirmed live. |

**Environment friction (not product defects), logged for the harness:** (1) macOS **Notification/Control Center** kept re-opening a transparent full-screen click-catcher that blocked every computer-use click — recurs on each notification; **resolved by the owner enabling Do Not Disturb**. ⚠️ Clearing it via OS-level Escape (`osascript … key code 53`) **wipes the focused PRD input** (Escape clears the textarea), so prefer DND over the Escape workaround. (2) **한컴오피스 한글 / Codex** kept stealing focus from DIVE, causing 대화 보내기 / 전송 click misfires and one duplicate send. (3) Pre-existing UX quirk: typing a fresh acceptance criterion character-by-character loses focus after the first char (the `criterionId` allocation remounts the input under a new React key) — surfaced by computer-use's per-char typing; worth a small follow-up (stable key for new rows) but out of S-041 scope.

**Conclusion:** the headline S-041 PRD interview dead-end is **fixed and confirmed on the real app**. Combined with 386 frontend + 598 Rust unit tests green, S-041 is implementation-complete and live-validated for its must-confirm journey.

## New observations (not in audit)

<!-- filled live -->
