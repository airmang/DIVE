# Contract: Runtime Capability

## Purpose

Define the v2 behavior for selecting or rejecting a runtime before a user work
turn begins.

## Inputs

- Selected provider kind.
- Selected model label.
- Provider credential/configuration state.
- Pi capability descriptor availability.
- Local runtime override or saved preference, if present.
- Current project root availability.

## Outcomes

### `ready`

DIVE may start the work turn through the supervised Pi runtime.

Required user-visible fields:

- Runtime label: supervised Pi runtime.
- Provider/model label.
- Short reason describing the supported capability.

Required ledger fields:

- `event`: `runtime.capability_evaluated`
- `status`: `ready`
- `providerKind`
- `model`
- `reasonCode`
- `createdAt`

### `unavailable`

DIVE must not start the work turn.

Required user-visible fields:

- Short explanation of why supervised v2 execution cannot proceed.
- Immediate setup action when one exists.

Required ledger fields:

- `event`: `runtime.capability_evaluated`
- `status`: `unavailable`
- `providerKind`
- `model`
- `reasonCode`
- `setupAction`
- `createdAt`

## Required Reason Codes

- `provider_not_configured`
- `provider_not_pi_capable`
- `legacy_requested`
- `missing_credentials`
- `missing_project_root`
- `runtime_unavailable`

## Rules

- `legacy_requested` is never a successful runtime selection for v2 user work.
- A provider without confirmed Pi capability is blocked, not routed elsewhere.
- Capability records must redact secrets and must not include raw environment
  dumps.
- Existing internal migration/test code may continue to exist only if it cannot
  become the user-visible runtime for v2 work.
