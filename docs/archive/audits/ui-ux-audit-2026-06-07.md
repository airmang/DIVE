# DIVE-2 UI/UX Audit — 2026-06-07

> Scope: comprehensive UI/UX inspection of the desktop product, checking the front-end
> against **newly-added backend features** (Pi supervised runtime, provider runtime,
> opencode-zen / Codex OAuth, plan-view, MCP, approval judgment) **and** pre-existing
> rough edges. Goal: realign the UI so the flow matches what the product can now do.
>
> Method: read the real code — design system (`tailwind.config.ts`, `globals.css`),
> shell (`ProductShellLayout`, `useProductShellController`, `TopBar`), cockpit
> (`ChatArea`, `ChatInput`, `MessageList`), onboarding/settings/providers, plan/roadmap,
> and the Rust IPC surface (`ipc/*`, `agent/mod.rs`, `providers/*`). Branch notes below.

## 0. Branch reality (important)

- **`main`** (current): provider runtime (`Anthropic/OpenAI/OpenRouter/Codex/opencode-zen/custom`),
  Codex OAuth, plan-view redesign, MCP, approval judgment — all backend-present.
- **`codex/s-005-pi-embed`** (worktree `../DIVE-2-s-005`): **Pi supervised runtime**
  (`pi_sidecar.rs` 1128 LoC, `agent/mod.rs` supervised tool-call loop). Backend-only —
  the only FE file it touched is `CodexOAuthDialog.tsx`. **Pi has zero UI surfacing.**
  Not merged to `main`.

## 1. Headline diagnosis

The backend grew a **provider/runtime/supervision layer**; the cockpit UI never caught up.
The product can now talk through 6 providers and (on s-005) a supervised Pi runtime with
per-tool risk/approval — but a user in the cockpit **cannot see which AI is answering, which
runtime is executing, or that tool-calls are being supervised.** Separately, the
"cockpit-first" identity from internal UX research notes is
still undercut by a hard chat-gate, and i18n integrity has regressed in shipping components.

## 2. Findings

Severity: **P0** = breaks a stated capability / blocks the core flow · **P1** = real friction
or invisible feature · **P2** = polish.

### A. New-feature surfacing gaps

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| A1 | P1 | **Active provider/model is invisible in the cockpit.** `modelLabel` is only set while routing; otherwise the chat input shows the generic `chat.input.model_select_default_label` placeholder. The user never sees "Anthropic · claude-…" or that a key is connected. | `useProductShellController.ts:1128`, `ChatInput.tsx:43,174` |
| A2 | P1 | **No runtime indicator.** Backend tags every event `runtime:"pi_sidecar"` and supports a fallback Rust loop, but nothing in the UI says which runtime is active or what "supervised" means. | `agent/mod.rs:584` (s-005); no FE consumer |
| A3 | P1 | **Supervised tool-call flow is not explained.** Pi runs each tool through risk → permission card → checkpoint. The permission card exists, but there is no framing that the *student is supervising an autonomous runtime* — the core pedagogy. | `agent/mod.rs:688` (s-005), `components/permission-card/*` |
| A4 | P2 | **Codex OAuth (ChatGPT login) absent from onboarding.** README lists it as a provider; onboarding offers only anthropic/openai/openrouter/opencode_zen. First-run users can't pick the OAuth path. | `OnboardingDialog.tsx:29-38` |
| A5 | P2 | **opencode-zen surfaced but unlabeled as "agent provider."** Choice exists with a warning, but no positioning vs. the others. | `OnboardingDialog.tsx:33-37,115` |

### B. i18n integrity (English locale is shipped but leaks Korean)

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| B1 | P1 | **Cockpit hardcodes Korean** despite importing `useT()`: header "대화", "세션 없음", the Code/Preview button ("코드"/"미리보기"), empty-state defaults, learning hint. EN users see mixed language at the front door. | `ChatArea.tsx:114,116,134-137,171-179` |
| B2 | P1 | **Shipping dialogs hardcode Korean**: `CodexOAuthDialog`, `PromptCheckDialog`, `Rc1MigrationDialog`, `RestoreConfirmDialog`, `StepDetailSlideIn`, `PromptHelperPanel`, `card-state-meta`. | grep: 75–226 KR chars/file in `src/components/**` (excl. DEV demos) |
| B3 | P2 | Confirm `lib/prompt-templates.ts`, `lib/ambiguity.ts`, `lib/test-command-help.ts` Korean is intentional *content* vs. UI strings; gate behind locale if user-visible. | `lib/*.ts` |

> Note: the high-count `src/pages/*-demo.tsx` / `showcase.tsx` files are DEV-only routes
> (`import.meta.env.DEV`) and do not ship — out of scope.

### C. Cockpit-first flow friction

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| C1 | P1 | **Hard chat-gate on missing instruction.** When a card is `instructed` with an empty summary, the composer is blocked with "write instruction first." This is the exact "pedagogy-as-obstruction" the UX diagnosis named as a removal candidate. → product decision (see §4). | `useProductShellController.ts:763-771` |
| C2 | P2 | Prerequisite gates (no project / provider / session) are reasonable but stack as three separate blocking states with different CTAs; a single progressive "get started" affordance would reduce first-run confusion. | `useProductShellController.ts:741-762` |

### D. Polish / states / a11y

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| D1 | P2 | Empty state in `ChatArea` is hardcoded + branches awkwardly (`!emptyState?.description`). Should always route through the i18n empty-state object. | `ChatArea.tsx:168-193` |
| D2 | P2 | The Code/Preview slide-panel button packs two icons + text + a literal "/" separator — visually noisy, not localized, ambiguous affordance. | `ChatArea.tsx:127-138` |
| D3 | P2 | No skeleton/loading state for message history load; relies on empty state. | `MessageList.tsx`, `ChatArea.tsx:158-195` |

## 3. Prioritized plan

- **P0** — none that are outright broken; the foundation (design tokens, a11y attrs, testids) is sound.
- **P1 (do now, low controversy):**
  1. **B1/B2 i18n integrity** — move shipping-component strings to `en/ko.json`. Restores the advertised bilingual support.
  2. **A1 provider/model visibility** — show connected provider + model in the cockpit (chat input chip and/or TopBar), driven by `provider_list`/`provider_set_model`.
  3. **A2/A3 runtime + supervision framing** — surface the active runtime and a one-line "you are supervising the agent" framing near the permission card. (Pi-specific parts land on `s-005`.)
- **P2 (polish batch):** A4/A5 onboarding completeness, C2 unified get-started, D1–D3 states/affordances.

## 4. Decisions needed from the owner

1. **C1 — remove the hard instruction-gate?** The UX diagnosis recorded "cockpit-first, no
   hard D/I/V/E gates for v1," but gating also feeds the supervision-thesis research design.
   Soften to a non-blocking coach prompt, or keep as a hard gate? (Default recommendation:
   soften to a dismissible inline hint; keep the *event* for research telemetry.)
2. **Pi runtime UI — which branch?** A2/A3 Pi-specific surfacing must land on
   `codex/s-005-pi-embed` (that's where the runtime lives). Do the FE work there, or first
   merge/rebase s-005 onto `main` so the cockpit changes and the runtime ship together?

## 5. Verification gates for any change

`pnpm typecheck` · `pnpm lint --max-warnings 0` · existing `scripts/verify-product-flow.mjs`
where flow logic changes · manual EN-locale pass for i18n work.
