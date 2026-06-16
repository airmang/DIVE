# Quickstart: V2 Spec Conformance Gaps

## Prerequisites

- DIVE repository checked out locally.
- Provider setup available for at least one Pi-capable provider.
- A test workspace with an approved plan and a saved PRD.

## Validation Commands

From `dive/`:

```bash
pnpm typecheck
pnpm test:unit
```

From `dive/src-tauri/`:

```bash
cargo test
cargo test supervisor
cargo test pi_sidecar_supervisor
```

Targeted tests added by this feature should cover:

- Runtime capability selection and blocked legacy/provider fallback states.
- Scope-expansion supervisor event construction, validation, timeout/no-card,
  and no static fallback.
- Add-step panel placement and non-blocking card behavior.
- Rationale challenge offer creation, acceptance/dismissal, and no silent plan
  mutation.
- EventLog/export redaction for runtime, supervisor, and plan-adjustment
  records.
- Canonical status docs distinguish shipped behavior from future/reserved
  contracts.

## Documentation Status Regression

From the repository root:

```bash
cd dive/src-tauri
cargo test --test spec_status_docs
cd ../..
! rg -n "User-visible legacy runtime fallback.*Planned|frontend rule card.*Planned|does not offer plan adjustment.*Planned" docs/spec-status.md
rg -n "change_step.*future/contract-reserved|retire_step.*future/contract-reserved" docs/spec-status.md specs/004-prd-decompose-lifecycle
```

Expected:

- The Rust docs-status test passes.
- `docs/spec-status.md` lists 005 gaps as closed or clarified, not planned.
- `change_step` and `retire_step` appear only as future/contract-reserved
  behavior unless a later visible path is implemented.
- `specs/003-supervision-card-ux/decisions.md` states that broad
  permission/guard-card harmonization remains active/future unless separately
  validated.

## Scenario 1: Legacy Runtime Request Is Blocked

1. Configure a provider with confirmed Pi capability.
2. Attempt a normal DIVE work turn.
3. Confirm the runtime label reports supervised Pi execution.
4. Set or simulate a legacy runtime request.
5. Attempt another work turn.
6. Expected: no legacy work turn starts; DIVE shows an explicit unavailable
   state and logs `runtime.capability_evaluated` with `legacy_requested`.

## Scenario 2: Unsupported Provider Does Not Fall Back

1. Select or simulate a provider without confirmed Pi capability.
2. Attempt to start a DIVE work turn.
3. Expected: DIVE blocks the turn with setup/capability copy and logs
   `provider_not_pi_capable`. No `legacy_loop` runtime is emitted.

## Scenario 3: Add-Step Scope Expansion Uses Supervisor

1. Open a project with a saved PRD and approved plan.
2. In the dedicated add-step area, enter a step with no linked criterion or a
   clearly new scope area.
3. Expected: DIVE creates a `scope_expansion` supervisor evaluation with PRD and
   add-step evidence refs.
4. If the supervisor returns a valid decision, a non-blocking card appears near
   the add-step area.
5. If the supervisor times out or returns invalid output, no card appears and a
   dropped/no-card evaluation is logged.

## Scenario 4: Static Scope Card Is Gone

1. Force the supervisor evaluation to be unavailable or invalid.
2. Repeat Scenario 3.
3. Expected: no hardcoded scope review card appears.

## Scenario 5: Rationale Challenge Offers Plan Adjustment

1. Open a step detail panel for a step with linked criteria and rationale.
2. Submit a "why this step?" objection.
3. Expected: the objection is logged and the UI shows a non-blocking
   plan-adjustment/re-decomposition offer.
4. Continue the current step without accepting the offer.
5. Expected: execution is not blocked solely by the objection.
6. Accept the offer.
7. Expected: DIVE routes to a reviewable plan-area suggestion; no plan mutation
   happens until the student confirms it there.

## Scenario 6: Status Docs Match Product State

1. Review `specs/README.md` and `docs/spec-status.md`.
2. Expected: `005-v2-spec-conformance-gaps` is listed as an implemented
   conformance cleanup after S-020.
3. Expected: status docs identify closed gaps and label
   change-step/retire-step mutation behavior as future/contract-reserved unless
   separately implemented.
4. Expected: 003 card UX status distinguishes already-shipped review-card
   presentation baseline from broader permission/guard-card harmonization
   follow-up.

## Final Validation Results

S-020 docs/status validation was run on 2026-06-16:

```bash
cd dive/src-tauri
cargo test --test spec_status_docs
```

Result: 4 passed, 0 failed.

```bash
! rg -n "User-visible legacy runtime fallback.*Planned|frontend rule card.*Planned|does not offer plan adjustment.*Planned" docs/spec-status.md
```

Result: no matches.

```bash
rg -n "change_step.*future/contract-reserved|retire_step.*future/contract-reserved" docs/spec-status.md specs/004-prd-decompose-lifecycle
```

Result: matched future/contract-reserved references in `docs/spec-status.md`
and `specs/004-prd-decompose-lifecycle/`.
