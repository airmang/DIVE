# DIVE — Unified Get-Started Flow (C2) — Design

- Date: 2026-06-07
- Status: approved (brainstorming) → ready for implementation plan
- Source: `docs/ui-ux-audit-2026-06-07.md` finding **C2**
- Branch target: `main` (frontend-only)

## 1. Problem

First-run guidance is scattered across four surfaces, so a beginner discovers each
prerequisite one at a time ("whack-a-mole"), with CTAs in inconsistent places:

- Auto-opening `OnboardingDialog` (AI connection) — `useProductShellController.ts:188`
- Chat `emptyState` (project / session prompts) — `useProductShellController.ts:786`
- `inputBlocked` 3-gate banner above the composer — `useProductShellController.ts:741`
- `ProviderSetupBanner` in the TopBar — `components/product/ProviderSetupBanner.tsx`

Chat genuinely cannot run without a connected provider (no AI to call) and a session
(nowhere to persist messages), so those are **unavoidable technical prerequisites**, not the
pedagogical instruction gate that C1 already softened.

## 2. Goal

Replace the scattered anchors with **one coherent "Get Started" checklist** in the cockpit
center that shows the whole path up front, emphasizes the current step, and reuses existing
flows. Reduce first-run confusion without hiding the cockpit.

## 3. Decisions (from brainstorming)

1. **Interaction model:** checklist showing all steps at once, with the current step
   emphasized; not an auto-advancing wizard. Aligns with cockpit-first (C1).
2. **Placement:** cockpit center (option A) — render in `ChatArea` where the empty state is.
   The 3-column shell stays visible; the right roadmap rail stays inactive until ready.
3. **Single entry point:** remove the first-run auto-open of `OnboardingDialog`
   (`useProductShellController.ts:188`). The checklist's "Connect AI" step opens it on click.
4. **Steps:** `project → provider → session`. When all three are satisfied, the checklist
   disappears and the normal chat / empty state shows.
5. **Reactive / re-entrant:** derived purely from store state, so it reappears if a
   prerequisite is later lost (e.g. all projects deleted).
6. **Composer:** stays disabled until ready (technical necessity). The redundant
   `inputBlocked` banner and `ProviderSetupBanner` are **suppressed while the checklist is
   shown** (the checklist explains what's needed).
7. **Demo routes** (`isDemoRoute`): unaffected.

## 4. Architecture (frontend-only)

### New component — `GetStartedChecklist`
`dive/src/components/product/GetStartedChecklist.tsx`. Pure presentational; receives a model
and renders the card. No store access of its own (testable in isolation).

```ts
type GetStartedStepKey = "project" | "provider" | "session";
type GetStartedStepStatus = "done" | "current" | "pending";

interface GetStartedStep {
  key: GetStartedStepKey;
  status: GetStartedStepStatus;
  title: string;        // i18n
  description: string;  // i18n
  doneHint?: string;    // e.g. the connected project/provider name, shown when done
  actionLabel?: string; // present only on the current step
  onAction?: () => void;
}

interface GetStartedModel {
  steps: GetStartedStep[];
}
```

### Controller — `useProductShellController`
- Add a `getStarted: GetStartedModel | null` memo. `null` when all prerequisites met
  (project + provider + session) or on demo routes. Otherwise build the three steps; the
  first unmet one is `current`, earlier ones `done`, later ones `pending`.
- Step actions reuse existing handlers:
  - `project` → `handleEmptyStateAction` (opens New Project)
  - `provider` → open `OnboardingDialog` (`setOnboardingOpen(true)`) — provider choices incl.
    the Codex sign-in added in A4
  - `session` → `createSession(currentProjectId)` (guard: project must exist)
- Remove the auto-open effect at `useProductShellController.ts:188` (decision 3).
- Pass `getStarted` into the `conversation` object.

### ChatArea
- Accept `getStarted?: GetStartedModel | null`.
- Render priority in the message region: `planDraftApproval` → `messagesLoading` skeleton →
  `getStarted` checklist → `hasConversation` MessageList → empty state.
- Suppress `inputBlocked` banner and (via controller/TopBar) `ProviderSetupBanner` while
  `getStarted` is non-null (decision 6). Simplest: when `getStarted` is active the controller
  sets `inputBlocked = null` (composer still disabled via `inputDisabled`) and
  `providerBanner.show = false`.

### Data flow
`store(currentProjectId, hasConnectedProvider+provider name, currentSessionId)` →
controller `getStarted` memo → `ChatArea` → `GetStartedChecklist`. Reactive; no new IPC.

## 5. Visual design — explicitly NOT "AI-generated" looking

This must look native to DIVE, not like a generic AI mockup. Hard rules:

- **Use existing design tokens only** (`tailwind.config.ts`; raw hex is already banned in
  `src/`): `bg-panel2`/`border` for the card, `accent` (brand blue) for the current step —
  **never purple/indigo or gradients**, `success` for done, `fg-muted`/`fg-subtle` for
  pending. Status by icon **and** text/weight, not color alone.
- **Match existing patterns**: mirror the restraint of `PlanStep` / `PermissionCard` —
  bordered panels, the project radius scale (`rounded-md`/`lg`, **no `rounded-2xl`**),
  `shadow-soft` at most (no layered shadows), the existing spacing scale (no oversized
  padding), and the existing type scale (no giant hero text).
- **Lucide icons** already in use (e.g. `Check`, `Circle`); small sizes consistent with the
  app. Current-step affordance is the standard `Button` (`variant="primary" size="sm"`), not
  a custom pill.
- Completed steps are visually de-emphasized (reduced opacity + check), current step has a
  thin `border-accent` + `bg-accent-subtle`, pending steps muted. One card, calm hierarchy.

## 6. i18n & a11y

- New `get_started.*` namespace in `en.json` + `ko.json` (title, subtitle, per-step
  title/description, action labels, done hints). Maintain en/ko key parity (0 drift).
- Semantics: ordered list (`<ol>`); current step marked `aria-current="step"`; each step
  conveys status in text (not color only). Action buttons are real `<button>`s, keyboard
  reachable; the card region has an appropriate label.

## 7. Testing / verification

- `pnpm typecheck`, `pnpm lint --max-warnings 0`, en/ko key parity script (both lists empty).
- `pnpm verify:product-flow` stays green; if its static checks reference the removed
  auto-open or the old scattered anchors, update them to assert the new wiring
  (`GetStartedChecklist`, `getStarted` model) rather than the removed pieces — do not weaken
  intent.
- Manual EN-locale pass; tab through the checklist; confirm it disappears once
  project+provider+session exist and reappears if a prerequisite is removed.

## 8. Out of scope (YAGNI)

- No new onboarding screen/route, no wizard auto-advance, no progress persistence beyond
  store state, no changes to the underlying project/provider/session flows themselves.

## 9. Files touched

- New: `dive/src/components/product/GetStartedChecklist.tsx`
- Edit: `dive/src/components/product/useProductShellController.ts` (getStarted memo; remove
  auto-open; suppress redundant banner/inputBlocked when active)
- Edit: `dive/src/components/shell/ChatArea.tsx` (render branch + prop)
- Edit: `dive/src/i18n/en.json`, `dive/src/i18n/ko.json` (`get_started.*`)
- Possibly: `dive/scripts/verify-product-flow.mjs` (align static checks)
