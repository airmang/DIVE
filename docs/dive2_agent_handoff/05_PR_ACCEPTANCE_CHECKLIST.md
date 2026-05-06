# DIVE-2 Refactor PR Acceptance Checklist

Use this checklist after every agent-produced PR.

## Scope

- [ ] The PR matches exactly one planned PR scope.
- [ ] No unrelated refactor was added.
- [ ] No unrelated formatting churn.
- [ ] No unnecessary DB schema change.
- [ ] Rust backend architecture was not rewritten unless explicitly requested.

## Product UX

- [ ] The change supports beginner desktop product UX.
- [ ] User-facing language avoids classroom/research framing.
- [ ] D/I/V/E/card/gate terminology is reduced or hidden where expected.
- [ ] The user can see current state and next action.
- [ ] Raw logs are not the primary beginner UI.
- [ ] Errors include next actions.

## Safety

- [ ] Plan approval still gates implementation.
- [ ] No edit/write/bash path opens before plan approval.
- [ ] Permission approval flow is preserved.
- [ ] No dangerous auto-approval defaults were added.
- [ ] `.env` and secrets remain protected.
- [ ] Project folder boundary remains protected.

## Code Quality

- [ ] TypeScript types are explicit enough.
- [ ] Components are not overgrown.
- [ ] New adapters isolate old internal models from new product UI models.
- [ ] Rust changes have tests when logic changes.
- [ ] No duplicated state source of truth was introduced without justification.

## Validation

Frontend:

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm build`

Rust, if touched:

- [ ] `cargo fmt --all -- --check`
- [ ] `cargo test --features dev-mock --all-targets`
- [ ] `cargo clippy --features dev-mock --all-targets -- -D warnings`

## PR Description

- [ ] Summary is clear.
- [ ] Product UX impact is explained.
- [ ] Tests run are listed.
- [ ] Known risks are listed.
- [ ] Follow-up tasks are listed.
