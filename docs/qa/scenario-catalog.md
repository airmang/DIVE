# DIVE Visual QA — Scenario Catalog (50)

Scenarios for driving the **real built `.app`** (rc.4, `/Applications/DIVE.app`) via macOS computer-use. Results recorded in [run-log.md](run-log.md); defects in [defect-log.md](defect-log.md).

**Legend**
- **AI?** — `Y` = needs a live LLM call (real provider: OpenRouter `claude-sonnet-4.6`, id 8). `N` = deterministic (UI/CRUD/render).
- **Pri** — `P0` critical path / crash / data-loss · `P1` important flow · `P2` edge / polish / i18n.
- **Risk** — links a known-issue probe: `i18n` (hardcoded strings), `sidecar` (verification-coach Pi unavailable must degrade), `parse` (supervisor/verify card JSON parse → must still render), `review-card` (pure-provocation hides revise/nudge), `visibility` (provider/runtime visibility gaps).

**Method note (read before running):** computer-use on this 4K/Retina display is reliable for most clicks but can mis-fire on small targets and is interrupted by notification banners. **Before logging any "control does nothing" defect, cross-check the component source** — an early false positive (New Project `취소`) was code-correct. Take a fresh screenshot immediately before each click; on an `알림 센터` block, retry after the banner clears.

**Clean-state handling:** ONB-* need empty app data. Back up `~/Library/Application Support/com.coreelab.dive/dive.db*` (+ optionally the whole dir), run, then restore.

---

## A. Onboarding & first-run (ONB)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| ONB-01 | N | P0 | First launch on clean data shows onboarding | App data backed up & `dive.db*` removed | 1. Launch DIVE | Onboarding/welcome or "Choose a project folder" empty state renders; no crash; "AI 연결" reflects no provider (or file-secret provider) | visibility |
| ONB-02 | N | P1 | New Project modal renders & fields work | Any state | 1. Click `+ 새 프로젝트` 2. Observe modal 3. Type a name 4. Click `찾아보기` | Modal shows folder field + browse + name + 취소/생성; name accepts input; 찾아보기 opens native folder picker | |
| ONB-03 | N | P1 | New Project modal dismissal | Modal open | 1. Click `취소` 2. (reopen) Press Esc 3. (reopen) Click ✕ | Each dismisses the modal with no project created. **NOTE: 취소/Esc appeared not to dismiss in baseline (code looks correct) — verify carefully, cross-check vs code before logging** | |
| ONB-04 | N | P2 | Create project end-to-end | Clean sandbox folder available | 1. `+ 새 프로젝트` 2. 찾아보기 → pick empty folder 3. confirm name 4. `프로젝트 생성` | Project appears in sidebar, selected; `.dive/` created in folder; create button was disabled until folder chosen | |

## B. Project & session management (PROJ)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| PROJ-01 | N | P0 | Select project loads sessions/plan | ≥1 project with sessions | 1. Click a project in sidebar | Sessions list + center conversation + right PROJECT PLAN populate (verified baseline PASS on demo-clean-0930) | |
| PROJ-02 | N | P1 | Switch between projects | ≥2 projects | 1. Select project A 2. Select project B | Center + plan + sessions update to B; no stale A content | |
| PROJ-03 | N | P1 | Delete project with confirm | ≥2 projects | 1. Click trash on a project 2. Confirm | Confirm prompt appears; on confirm project removed; selection moves sensibly; no crash | |
| PROJ-04 | N | P1 | Session create / select / delete | Project selected | 1. `+ 새 세션` 2. Select it 3. Delete via trash + confirm | New session appears & selectable; delete confirms & removes; empty-state if none | |
| PROJ-05 | N | P2 | Empty states | Project with no sessions / no project selected | 1. Deselect/observe | "프로젝트를 선택하세요" / "세션 없음" style empty states render correctly | i18n |

## C. Provider & settings (PROV)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| PROV-01 | N | P0 | Open Settings | Any | 1. Click provider card (현재 모델 …) / settings entry | Settings page renders: providers, model selector, locale, theme, tool permissions | visibility |
| PROV-02 | N | P1 | Model selector reflects active provider | Settings open | 1. Open model dropdown | Lists models; current = `claude-sonnet-4.6` (OpenRouter); selecting persists | visibility |
| PROV-03 | N | P1 | Locale switch en ⇄ ko | Settings open | 1. Switch locale to English 2. Sweep all screens 3. Switch back to 한국어 | All visible strings switch; **probe hardcoded-Korean leftovers** | i18n |
| PROV-04 | N | P1 | Theme dark ⇄ light persists | Any | 1. `라이트 모드로 전환` 2. Relaunch app | Theme toggles immediately; persists across relaunch | |
| PROV-05 | N | P2 | Tool permission policy editor | Settings open | 1. Open tool permissions 2. Change a tool to review/warn/safe | Policy UI renders & edits persist | |
| PROV-06 | N | P2 | Codex OAuth dialog UI | Settings open | 1. Add provider → Codex 2. Observe OAuth dialog (do not complete) | OAuth dialog renders with sign-in flow copy; cancel closes | |

## D. Chat & agent loop (CHAT)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| CHAT-01 | Y | P0 | Send goal, see streamed reply | Project+session, provider connected | 1. Type a simple goal 2. Send | Assistant streams; reasoning card collapsible; runtime badge shows model; no parse errors | |
| CHAT-02 | Y | P1 | Cancel mid-stream | A stream in progress | 1. Send 2. Click cancel | Stream stops; session stays open; partial message preserved/labelled | |
| CHAT-03 | Y | P1 | Tool activity expansion | Turn that proposes a tool | 1. Send a goal needing a file read 2. Expand tool activity | Tool call details render; approve/deny controls present | |
| CHAT-04 | N | P2 | Input gating message | Session where chat is gated (PRD incomplete / no project) | 1. Observe input | Blocked message renders ("프로젝트/세션 먼저…" or "PRD 먼저…"); send disabled | i18n |

## E. Permission / tool-approval cards (PERM)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| PERM-01 | Y | P0 | Safe (read) card | Turn proposes read_file/list_dir | 1. Trigger read tool | Green/safe card with command explainer; Approve/Deny present | |
| PERM-02 | Y | P0 | Write/edit card shows patch preview | Turn proposes write_file/edit_file | 1. Trigger write 2. Inspect card | Warn-tier card; DiffViewer + PatchPreviewPanel show before approval | |
| PERM-03 | Y | P1 | Approve with modified args | A tool card with args | 1. Edit args 2. Approve | Args editor accepts edit; approval uses modified args | |
| PERM-04 | Y | P1 | Deny with reason | Any tool card | 1. Deny 2. Enter reason | Denial recorded; turn proceeds/halts gracefully | |
| PERM-05 | Y | P1 | Blocked destructive command | Turn proposes e.g. `rm -rf` / `curl … \| bash` | 1. Trigger blocked command | Guard refuses (danger tier / block reason shown); cannot execute | |

## F. PRD authoring (PRD)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| PRD-01 | Y | P0 | Socratic interview turns | New session, no PRD | 1. Describe a goal 2. Answer clarifying Qs | AI asks criterion-linked questions; answers advance the interview | |
| PRD-02 | Y | P1 | PRD draft board fills | Mid/late interview | 1. Continue interview | PrdAuthoringBoard shows goal/scope/non-goals/criteria sections | |
| PRD-03 | Y | P1 | Confirm PRD → final read view | Draft ready | 1. Click Confirm PRD | FinalPrdReadView renders with a version; chat ungates | |
| PRD-04 | N | P2 | Show/Hide PRD toggle | PRD exists | 1. Toggle `PRD 보기` | PRD surface expands/collapses (verified collapsible present on demo-clean-0930) | |

## G. Plan creation & approval (PLAN)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| PLAN-01 | Y | P0 | Generate plan draft from PRD | Confirmed PRD | 1. Create/Generate plan | Draft steps with deps + parallel groups + rationale render for review | |
| PLAN-02 | N | P1 | Review & accept plan | Draft plan present | 1. Review 2. Accept | Roadmap (right rail) appears; run mode floor → Build | |
| PLAN-03 | N | P1 | Discard plan | Draft plan present | 1. Discard | Plan cleared; returns to pre-plan state with confirm | |
| PLAN-04 | N | P2 | Add step modal | Plan exists | 1. `+ Add step` | PlanAddStepPanel renders & validates | |

## H. Roadmap & step execution (STEP)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| STEP-01 | N | P0 | Roadmap renders step status | Project with plan (demo-clean-0930) | 1. Observe right PROJECT PLAN | Steps with status badges (진행 중/검토/완료) + progress (00/01) render (baseline PASS) | |
| STEP-02 | N | P0 | Open step detail slide-in | Plan with a step | 1. Click a step | StepDetailSlideIn opens: title/desc/status/changed files/verification/AC list | |
| STEP-03 | N | P1 | Dependency graph view | Plan with deps | 1. `의존성 그래프 보기` | Dependency/parallel-group visualization renders | |
| STEP-04 | N | P2 | Mini-map toggle | Plan present | 1. Toggle mini-map | Collapsed/expanded plan view switches | |

## I. Provocation / supervisor cards (SUP)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| SUP-01 | Y | P0 | Card renders on AI-claimed-done | Session reaching verify/claim-done | 1. Drive a step to "검증 중" | Provocation/review card renders with criterion-linked question + evidence (≤3) + actions; **NOT a parse_error blank** | parse |
| SUP-02 | N | P0 | Review card hides revise/nudge | A review (pure-provocation) card present (demo-clean-0930 has "검토 열기") | 1. Open the review card | Revise/nudge action buttons are HIDDEN (pure provocation) | review-card |
| SUP-03 | Y | P1 | Card actions open evidence | Card with actions | 1. Click open_diff/open_preview/run_tests | Action routes to slide-in (diff/preview/terminal) | |
| SUP-04 | N | P1 | Dismiss / mark-irrelevant | Card present | 1. Dismiss 2. (new) Mark irrelevant | Card dismisses; dedup prevents immediate re-show of same concern | |

## J. Verification coach (VC)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| VC-01 | Y | P0 | Generate guidance for criteria | Step in verify with criteria | 1. Open `검토 열기` / verification coach | Guide renders: steps + recommended checks + acceptance criteria | sidecar |
| VC-02 | N | P0 | Sidecar-unavailable degrades gracefully | Force unavailable (no provider / sidecar) | 1. Trigger coach when sidecar can't run | Status Unavailable/Dropped message; **no crash/hang** | sidecar |
| VC-03 | N | P1 | Record observation | Coach guide shown | 1. Record manual/terminal/file observation | Observation persists; guide_version/lineage updates | |

## K. Recovery & checkpoints (REC)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| REC-01 | N | P0 | Recovery badge + panel | Session with checkpoints (demo-clean-0930 shows "되돌리기 1건") | 1. Click 되돌리기 | RecoverySlideIn opens with CheckpointTimeline (baseline: badge renders) | |
| REC-02 | N | P1 | Checkpoint list detail | Recovery open | 1. Inspect entries | Timestamps + labels + diff summary per checkpoint | |
| REC-03 | N | P1 | Restore to checkpoint | ≥1 checkpoint | 1. Restore 2. Confirm | Rolls back; chat/plan resume from checkpoint; confirm guard present | |

## L. Slide-in panel (SLIDE)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| SLIDE-01 | N | P1 | Open + tab switch | Step with changed files | 1. `코드·미리보기` / open slide-in 2. Switch Code/Preview/Terminal | Panel slides in; tabs switch; state persists | |
| SLIDE-02 | N | P1 | Preview tab | Step with preview | 1. Preview tab | preview-url-input + preview-iframe render | |
| SLIDE-03 | N | P2 | Terminal output | Step that ran a command | 1. Terminal tab | Command output/log renders | |

## M. Cross-cutting (XC)

| ID | AI? | Pri | Title | Preconditions | Steps | Expected | Risk |
|----|-----|-----|-------|---------------|-------|----------|------|
| XC-01 | N | P1 | Locale-flash on first paint | Cold launch | 1. Launch & watch first paint | UI should not flash English then switch to Korean (baseline OBSERVED a flash — verify) | i18n |
| XC-02 | N | P1 | i18n full sweep ko vs en | Settings locale toggle | 1. Toggle to en 2. Visit every screen | No hardcoded Korean leaks in en; no missing keys | i18n |
| XC-03 | N | P0 | Provider-disconnected error state | No usable provider | 1. Force runtime unavailable | "Connect provider" / RuntimeUnavailable banner + setup action; chat blocked cleanly | visibility |
| XC-04 | N | P2 | Window resize / rail widths | Any | 1. Resize window 2. Drag rail handles | Layout reflows; rail widths persist | |
| XC-05 | N | P2 | Keyboard nav / focus | Any | 1. Tab through controls | Focus rings visible; logical order; no traps | |

---

**Run order:** AI-independent P0/P1 first (PROJ, STEP, REC, SLIDE, PROV, XC, ONB) for fast deterministic coverage → then AI-dependent (CHAT, PERM, PRD, PLAN, SUP, VC) which cost live LLM calls. Batch per area; record results in run-log; cross-check suspicious findings vs code before logging defects.
