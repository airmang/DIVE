# S-045 Design — Beginner vocabulary & first-run framing (Theme 5)

**Stage**: Wily `S-045` (dive-2, register via `design_stage` after S-044) · **Spec**: [spec.md](spec.md) Theme 5 · **Branch**: `010-beginner-readiness-ux`

**Evidence**: [round2-audit-findings.md](../../docs/qa/round2-audit-findings.md) P1-04, P1-07, P1-11, P1-19, P2-03, P2-04, P2-05, P2-06, P2-07, P2-10, P2-21 (11 findings; P2-08 was already handled in S-043).

## Problem

A true-novice, limited-English Korean student meets DIVE's key terms with **no in-context gloss** and **no purpose frame**: the first screen lists 4 setup chores but never says DIVE is for *supervising* an AI (P2-03); the connect dialog asks for an `API 키`/`sk-...` with no explanation or storage reassurance and a provider choice (`Claude 계열` vs `GPT 계열`) that is meaningless to them (P1-04), while its own description tells them to "select a project folder" it can't do (P2-04) and the disabled provider shows internal `Pi 런타임` jargon (P2-21); the create dialog leads with `.dive/` dotfolder jargon and no new-empty-folder guidance (P1-07, P2-05, P2-06) behind a step labeled "프로젝트 열기" that opens a "새 프로젝트" dialog (P2-07); the PRD canvas labels `의도 요약`/`수락 기준` are bare jargon on the exact fields the confirm gate enforces (P1-11); and the Safe/Warn/Danger risk model is first met live on a real permission card with no prior frame — while the quickstart mis-teaches Danger as "auto-blocked" (P1-19, P2-10).

## Decision (constitution-aligned)

Pure vocabulary + framing scaffolding, all **contextual on the real artifact** (Constitution I/II/V) — **no quiz, badge, score, standalone card deck, lesson track, or separate intro screen**. Two treatments, chosen by kind:

- **Always-on inline glosses / purpose lines** for essential vocabulary a beginner must read to act (API key, folder choice, PRD fields, the DIVE purpose line). These are static help text beside the field, mirroring the QuickIntake help strings already shipped.
- **Guided-help coachmark** for the one conceptual intro (the Safe/Warn/Danger primer, P1-19): a dismissible, one-time, opt-out-able `LearningHint` rendered **above the first permission card**, mirroring the shipped `PreviewOnboardingCoachmark` pattern (gated on `tutorialEnabled` + a persisted `permissionCardPrimerDismissed` flag). Like that coachmark it is UI scaffolding, not a supervision decision, so it does **not** add an EventLog IPC (consistency with the existing coachmark; deliberate non-goal, avoids a new Rust surface).

The honest 3-tier model (Safe auto / Warn diff-confirm / Danger student-judges-and-approves; `자동 차단` reserved for the guard's truly-destructive patterns) is stated **consistently** in the primer and the quickstart (P2-10). Mostly i18n copy + small component edits + one store field; no new mechanic.

## Changes (grouped)

### A. Connect dialog — `OnboardingDialog.tsx` + i18n
- **P1-04** Add an always-on plain-Korean helper under the API-key field: `onboarding.api_key_help` — "API 키 = AI 회사에서 받는 비밀 번호예요. 이 컴퓨터에만 안전하게 저장돼요. 처음이면 Anthropic을 추천해요." (en mirror). Contextual gloss + storage reassurance + default nudge.
- **P2-04** Reword `onboarding.description` to describe only this dialog (drop the folder-selection clause): "계획·코딩·검증에 DIVE가 사용할 AI를 연결하세요. 키는 이 컴퓨터에만 저장됩니다." (ko + en).
- **P2-21** The disabled-provider hint (`:154`) and the opencode-zen warning (`:170-183`) render the internal `runtime.capability.reasons.provider_not_pi_capable` ("Pi 런타임" jargon, code-switched ko). Show a beginner reason instead: new `onboarding.provider_unavailable_beginner` ("DIVE에서 아직 쓸 수 없어요 — Anthropic·OpenAI·ChatGPT 로그인 중에서 골라 주세요.") for the disabled hint, and repoint the opencode-zen warning to the already-authored-but-**dead** `onboarding.opencode_warning` ("베타 서비스 · 일부 무료 모델은 데이터 훈련에 사용될 수 있습니다"). Fully Korean, no stray `provider`/`Pi 런타임`.

### B. Create-project dialog — `NewProjectDialog.tsx` + `GetStartedChecklist` copy
- **P1-07** Add an always-on hint under the folder field: `new_project.folder_hint` — "비어 있는 새 폴더를 고르세요. AI 작업은 이 폴더 안에서만 일어나고, 언제든 되돌릴 수 있어요." Plus a lightweight non-blocking inline note (`new_project.folder_root_note`) when the typed/picked path is exactly the home/Desktop/Documents root (grounded in real path state; never a hard gate — Constitution V).
- **P2-05 + P2-06** Reword `new_project.description` to a purpose+safety gloss, dropping `.dive/`: "여기 고른 폴더 안에서 AI가 코드를 만들고, 너는 그걸 확인·승인하게 돼요. 비어 있는 새 폴더를 고르면 가장 안전해요." (ko + en).
- **P2-07** Align the checklist step-1 wording with the create flow it opens: `get_started.project_title` "프로젝트 열기" → "첫 프로젝트 만들기", `get_started.project_action` "프로젝트 열기" → "새 프로젝트 만들기" (ko + en).

### C. First-run purpose line — `GetStartedChecklist` copy (P2-03)
Rewrite `get_started.subtitle` to state the supervision frame, not just the chores: "DIVE는 AI가 직접 코딩하고, 당신은 그 결과를 확인·승인하는 감독자가 됩니다. 아래 4단계로 시작하세요." (ko + en). One contextual sentence on the existing guide (no new screen).

### D. PRD canvas field glosses — `PrdAuthoringBoard.tsx` (P1-11)
Add an always-on gloss line under the two jargon labels the confirm gate enforces (reusing the QuickIntake help style): under `prd.fields.intent_summary` (`:585`) → `prd.fields.intent_summary_help` "누가, 왜 쓰는지를 한 문장으로", under `prd.fields.acceptance_criteria` (`:653`) → `prd.fields.acceptance_criteria_help` "끝났는지 직접 확인할 수 있는 조건". Also relabel the ko value `prd.fields.acceptance_criteria` "수락 기준" → **"완료 기준"** to match the term used everywhere else (`완료 기준 추가`, validation strings); en stays "Acceptance criteria". Also shows in `FinalPrdReadView` (same key).

### E. Safe/Warn/Danger primer — new `PermissionCardPrimer.tsx` (P1-19)
New component mirroring `PreviewOnboardingCoachmark`: gated on `useTutorialEnabled()` **and** `!permissionCardPrimerDismissed`, wrapped in `LearningHint`, rendered in `ToolActivity.tsx` just above `<PermissionCard>` (`:319`, inside the `showCard` article). Plain-Korean 3-tier note + honest block statement:
`permission_card.primer.*` — title "권한은 이렇게 작동해요", three tiers (초록=읽기만·자동 / 노랑=변경·diff 확인 후 허용 / 빨강=삭제·명령 실행·내가 직접 판단해 허용), one line "정말 파괴적인 명령은 DIVE가 아예 차단해요", dismiss "확인" + `dismiss_aria`. Store: extend `ui-preferences.ts` with `permissionCardPrimerDismissed: boolean` + `dismissPermissionCardPrimer()` + `usePermissionCardPrimerDismissed()` (persisted, mirrors `previewOnboardingDismissed`).

### F. Quickstart safe-rules — `docs/student-quickstart.md` (P2-10)
Rewrite the `안전 규칙` section (`:63-67`) to name **three interactive tiers** honestly and reserve `자동 차단` for the guard's destructive patterns: Safe(자동 실행) / Warn(변경 — diff 확인 후 내가 허용) / Danger(삭제·명령 실행 — 내가 직접 판단해 허용); "정말 파괴적인 명령(rm -rf 등)만 DIVE가 자동 차단". Matches the in-app primer copy.

### G. i18n parity
All new keys added to **both** `en.json` and `ko.json`; the S-043 `parity.test.ts` locks the key sets. Dead `onboarding.error_*` keys left untouched (harmless, parity-symmetric); `onboarding.opencode_warning` becomes used (P2-21).

## Test strategy
- **Vitest**: `PermissionCardPrimer.test.tsx` (renders when guided-help on + not dismissed; hidden when guided-off or dismissed; dismiss calls the store setter) — mirror `PreviewOnboardingCoachmark.test.tsx`; extend `ui-preferences.test.ts` for the persisted primer flag; en/ko parity via `parity.test.ts`. Assert `OnboardingDialog` renders `api_key_help` and the beginner unavailable reason (no `Pi 런타임`); `NewProjectDialog` renders `folder_hint`; `PrdAuthoringBoard` renders the two field glosses.
- **Frontend CI**: `format:check`/`typecheck`/`lint`/`test:unit`. No Rust surface.
- **Live re-QA (ko + en)**: first-run checklist shows the supervision purpose line + "첫 프로젝트 만들기"; connect dialog shows the API-key gloss and a beginner reason for opencode zen (no `Pi 런타임`); create dialog shows the empty-folder hint (no `.dive/`); PRD canvas shows the field glosses (완료 기준); with guided-help on, the Safe/Warn/Danger primer appears above the first permission card and dismisses one-time.

## Out of scope / preserve
- No quiz/badge/score/deck/lesson-track/separate intro screen; glosses are static field help, the primer is the existing opt-out-able guided-help coachmark (Constitution I/V).
- The primer intentionally does not add an EventLog IPC (matches the shipped `PreviewOnboardingCoachmark`); EventLog integration is a possible follow-up, not this Stage.
- Do not hard-gate on non-empty folders (P1-07 note stays non-blocking, Constitution V). Preserve S-041–S-044 behavior. `--color-info` (S-044 deferral) unrelated.
