# S-044 Design — Accessibility / WCAG AA contrast + semantics (Theme 4)

**Stage**: Wily `S-044` (dive-2, register via `design_stage` after S-043) · **Spec**: [spec.md](spec.md) Theme 4 · **Branch**: `010-beginner-readiness-ux`

**Evidence**: [round2-audit-findings.md](../../docs/qa/round2-audit-findings.md) P1-02, P1-24, P1-27, P1-32, P1-33, P1-34, P1-35, P1-38, P2-23, P2-25, P2-29, P2-31, P2-34, P2-35, P2-36, P2-37 (16 findings, adversarially verified). All contrast ratios below were **independently recomputed** with the WCAG 2.1 relative-luminance formula (script `scratchpad/contrast.py`); the audit's numbers reproduced within rounding.

## Problem

A limited-vision or just-tired Korean novice — often on a projector / bright classroom screen — cannot physically read the most decision-relevant supervision text. The lowest fg tier (`--color-fg-subtle`) and several light-theme semantic colors (`warn`/`success`/`accent`/`danger`) render load-bearing small text **below the WCAG AA 4.5:1 floor**: the AI's "why" at the approval gate (2.49–2.75:1), diff add/remove counts and line numbers, the "확인 필요 카드 / Needs review" eyebrow (2.93:1), criterion-ID cross-references (3.22:1), the SUPERVISED teaching badge (2.70:1), sidebar orientation text, and first-run step previews (dimmed to ~2:1 by container opacity). Plus five non-contrast a11y/semantics gaps: `<html lang>` never tracks the locale, the guided-help toggle has no accessible name, minimap SVG nodes have no keyboard-focus indicator, the supervisor eval pops in with no pending state, and the recovery control's label/aria/badge disagree.

## Decision (constitution-aligned)

Pure presentation + semantics remediation. **No** new product surface, quiz, badge, banner, score, or static fallback (Constitution I/V); every fix is contextual on the real artifact. Load-bearing supervision text becomes AA-legible; the fixes are locked by a **deterministic contrast unit test** that parses the token file (mirrors the S-043 parity-lock approach). No Rust changes — frontend/CSS only.

Two levers, chosen per finding to minimize blast radius:
- **Global token** where the token is a *text tier* (fg-subtle/fg-muted) or the spec mandates it (accent/warn/success/danger light) — one change fixes every usage, cited and uncited.
- **Per-usage** where a global change would be wrong or insufficient (opacity, aria, lang, SVG focus, loading state, the accent/15 badge, label/aria alignment).

### Visual note (in-scope, documented): light-mode accent deepens
Raising `--color-accent` (light) to clear AA on text also repaints light-mode accent **fills/rings/buttons** a deeper emerald (mint → emerald-700-ish). This is spec-sanctioned ("Raise … accent tokens (light + dark) to ≥4.5:1") and is a net improvement: white-on-accent primary-button text is **currently failing at 3.22:1** and rises to **5.47:1**. Dark mode (the default `:root`; light is OS-opt-in) is unchanged for accent. `accent-hover`/`accent-active` are re-derived to stay white-safe, and the two components that put dark text on `accent-hover` in light mode (`PlanFeedback`, `PlanStepActions`) flip to `text-accent-fg`.

## Changes (grouped)

### A. Token contrast lock — `styles/globals.css` (verified ≥4.5:1)

| Token | Mode | Old RGB | New RGB | Fixes (worst pair → new) |
| --- | --- | --- | --- | --- |
| `--color-fg-muted` | dark | 111 125 138 | **137 149 161** | P2-35/P2-23 micro-text 4.16 → 5.7; P1-38 |
| `--color-fg-subtle` | dark | 79 90 102 | **128 138 149** | P1-02 why 2.49 → 5.0; P1-27 line #, P1-32 disabled-reason, P1-38, P2-34 |
| `--color-fg-subtle` | light | 130 144 152 | **100 111 117** | P2-34 empty 2.91 → 4.57; P1-38 3.14 → 4.9 |
| `--color-accent` | light | 22 163 116 | **15 114 81** | P2-29 id 3.22 → 5.25; P1-27 links, P2-36 badge 2.70 → 4.97; accent/10 chip 4.58 |
| `--color-accent-hover` | light | 30 178 128 | **46 132 103** | white-safe on hover (white 4.55) |
| `--color-accent-active` | light | 17 140 100 | **13 96 68** | white 7.57; `link` variant text |
| `--color-success` | light | 22 163 116 | **15 109 77** | P1-27 add-count 2.85 → 5.62; P1-32 "saved"; success/15 badge 4.54 |
| `--color-warn` | light | 176 132 40 | **121 91 28** | P1-32 label on warn/10 2.74 → 4.89; P1-35; warn/15 badge 4.56 |
| `--color-danger` | light | 200 70 70 | **166 58 58** | P1-27 del-count 4.21 → 5.66; danger/10 chip 4.89 |

`fg-muted` light (5.10) and all dark warn/success/accent/danger already pass — **left untouched** (minimal change). Ordering preserved: dark fg > fg-muted > fg-subtle; light fg < fg-muted < fg-subtle. Binding bg for the dark fg tiers is `accent-subtle` (13 37 30, the lightest dark surface they sit on).

**Chip-composite coverage.** The pervasive status-chip / `Badge` pattern `text-X on bg-X/{10,15}` (~71 usages) was *already sub-AA before S-044* (e.g. `text-success` on `success/15` ≈ 2.8:1); the light `success`/`warn`/`danger`/`accent` values above are chosen to clear that tint composite too (worst binding: the darker `/15` badge over `bg-panel`), not just solid `bg-panel`. The keystone test asserts these composites. Collateral: `CheckpointTimeline` restore button used `bg-accent text-fg` (a pre-existing dark-mode contrast bug too) → flipped to `text-accent-fg`, matching the other accent-fill buttons. **Out of scope / follow-up**: `--color-info` (light) still fails `info/15` badges at 3.85:1 — not among the 16 Theme-4 findings; deferred (rare usage), like S-043's P2-38.

### B. `text-fg-subtle` → covered by token
P1-02 (`ToolActivity.tsx` why-line ×2), P1-27 (`DiffViewer` line numbers), P1-32 (`ProvocationCard` disabled-reason), P1-38 (`RecoveryPanel`, `CodeTab`), P2-34 (`Sidebar` EmptyLine) all read from the raised token — **no per-usage className churn needed**. The decorative chevrons (`text-accent/60`, aria-hidden) are unaffected by tier and stay quiet.

### C. Size bumps for sub-12px load-bearing micro-text
Token now clears AA at any size (contrast is size-independent), but these stay uncomfortably small; bump for readability, not compliance:
- **P2-23** `OnboardingDialog.tsx:153` provider hint `text-[10px]` → `text-xs`.
- **P2-35** the load-bearing identity fields — `Sidebar.tsx` project path & archived tag, `PlanDashboardPanel.tsx` project path (`text-[10px]/[9px]`) → **`text-xs` (12px)** to honor the audit's ≥12px target. Decorative counts left as-is (meet 3:1 UI floor).
- **P2-36** `RuntimeBadge.tsx:50` `text-[10px]` → `text-[11px]` ("slightly larger" per the audit; token already gives 4.59; 12px uppercase would crowd the chrome).

### D. Structural / semantic fixes (per-usage)
- **P1-24** `GetStartedChecklist.tsx:53-54` — drop `opacity-70`/`opacity-50` from the `<li>` (they dim the text layer to ~2:1). Keep single-current-step emphasis via the existing icon/border state; pending/done titles+descriptions render at full-opacity `text-fg`/`text-fg-muted` (AA).
- **P1-33** `App.tsx:116-118` — in the existing `[locale]` effect also set `document.documentElement.lang = locale` (ko→`ko`, en→`en`). Mirror a `lang` bootstrap in `index.html`'s inline script (reads persisted `dive.locale`) so first paint matches. Fixes AT mispronunciation.
- **P1-34** `settings.tsx` guided-help checkbox — add `aria-label={t("settings.guided_help_title")}`, matching the review-cards toggle pattern at `:411`.
- **P1-35** `settings.tsx:499` active-provider badge — `bg-accent/15 text-accent` (2.45:1) → solid `bg-accent text-accent-fg` chip (5.47:1); reads clearly as "In use / 사용 중". (The `:508/:513` warn warnings are fixed by the token darken; bump `text-[10px]`→`text-[11px]`.)
- **P2-25** `PlanMiniMap.tsx` + `globals.css` — SVG `ring-*` (box-shadow) does not paint on `<g>`. Add an SVG-paintable focus halo: a dedicated `<circle>` (larger r, `fill=none`, `stroke=var(--color-ring)`) shown via `.plan-minimap-node:focus-visible .focus-halo`, so **every** node — including the current one (already strokeWidth 3) — gets a distinct focus indicator.
- **P2-31** `StepDetailSlideIn.tsx` / `VerificationReviewStepper.tsx` — deterministic pending state for the async `evaluateProvocationSupervisor` call, mirroring `coach_loading`: while the eval promise is in flight for the current step, render a labeled "검토 카드 확인 중… / Checking for review cards…" placeholder (real status tied to a real async op — not a fake card) so the stepper total/layout does not silently reflow.
- **P2-37** `TopBar.tsx` — align the visible label with the accessible name (both name the recovery/checkpoint concept instead of "Undo" vs "Open recovery panel"); give the count a title so a bare number gains scent and a failed step is distinguishable. Copy-only + existing recovery state; no new surface.

### E. i18n (both en/ko, parity preserved per Theme 3)
- New: `stepper.review_eval_pending` (ko "검토 카드 확인 중…", en "Checking for review cards…").
- Reword: `topbar.recovery_trigger_label` "실행 취소/Undo" → "복구/Recovery" (align with `recovery_trigger_aria` + panel title); optional `topbar.recovery_trigger_title` for badge scent.

## Test strategy

- **Vitest `styles/__tests__/contrast.test.ts` (keystone)**: parse `globals.css` `:root`/`.dark`/`.light` token RGBs, implement WCAG relative-luminance + ratio, assert the full load-bearing table (fg-subtle/fg-muted on bg/panel/panel2/accent-subtle both modes; light warn on panel/white/warn-10; success/danger/accent on their surfaces; white-on-accent + white-on-accent-hover/active) all ≥4.5. Locks every A-value against future drift.
- **Vitest**: `App` locale effect sets `document.documentElement.lang` (ko/en) (P1-33); guided-help checkbox exposes an accessible name (P1-34); `GetStartedChecklist` non-current steps carry no opacity utility on the text layer (P1-24); supervisor-eval pending label renders while the eval is in flight (P2-31); en/ko key parity still holds with the new keys (reuse S-043 `parity.test.ts`).
- **Frontend CI**: `pnpm format:check` / `typecheck` / `lint` / `test:unit`. No Rust surface.
- **Live re-QA (ko + en, light + dark)**: rebuild the `.app`; confirm at the approval gate the "why" text is legible; the review card eyebrow, diff counts, criterion IDs, SUPERVISED badge, sidebar empty text, and first-run steps are readable in **light** theme; switch locale → `<html lang>` updates; Tab through the minimap shows a focus ring on the current node; the review stepper shows a pending line instead of a silent reflow.

## Out of scope / preserve
- Vocabulary/first-run primers (Theme 5 → S-045), error/loading/composer gating (Theme 6 → S-046).
- Do not add quizzes/badges/scores/banners/static-fallback (Constitution I/V). Do not touch dark-mode accent/warn/success (they pass). Preserve the S-042/S-043 behavior.
- The accent deepening in light mode is intended and documented above, not a regression to "fix" back.
