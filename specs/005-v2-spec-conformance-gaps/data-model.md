# Data Model: V2 Spec Conformance Gaps

## RuntimeCapabilityState

Represents whether a v2 work turn can start through the supervised Pi runtime.

| Field | Type | Notes |
| --- | --- | --- |
| `state` | `ready` \| `unavailable` | `ready` means supervised v2 execution can start. |
| `providerKind` | string | Selected provider category. |
| `model` | string \| null | Selected model label when available. |
| `reasonCode` | string \| null | Stable unavailable reason, such as `provider_not_pi_capable`, `legacy_requested`, `missing_credentials`, or `missing_project_root`. |
| `message` | string | Short user-facing explanation. |
| `setupAction` | string \| null | Optional next action such as configure provider or choose supported provider. |
| `recordedAt` | number | Unix ms. |

Validation:

- A v2 work turn can start only when `state = ready`.
- `legacy_requested` is an unavailable state, not an execution choice.
- Capability records must not include raw secrets, keys, or environment dumps.

## ScopeExpansionReviewEvent

Deterministic review event created when an add-step draft may expand the PRD.

| Field | Type | Notes |
| --- | --- | --- |
| `event` | `scope_expansion` | Supervisor event name for this feature. |
| `artifactRef` | object | Points to the add-step draft or saved step candidate. |
| `projectId` / `planId` | number | Local project and plan IDs. |
| `mode` | `work` \| `guided` | Canonical supervisor mode. |
| `locale` | string | UI language for generated question. |
| `evidenceRefs` | EvidenceRef[] | PRD/add-step evidence assigned by DIVE. |
| `allowedActionIds` | string[] | Feasibility-filtered actions; no approve/proceed actions. |
| `scopeExpansion` | ScopeExpansionAssessment | Deterministic result and reason codes. |
| `contextHash` / `evidenceHash` | string | Stable hashes used for validation/dedup. |

Validation:

- The event exists only when deterministic scope assessment reports
  `expanded = true`.
- Evidence refs must identify PRD criteria, PRD scope/non-goals, add-step title,
  expected files, linked criteria, or PRD delta fields.
- Supervisor output must reference existing evidence refs and must be a
  criterion-linked question.
- Invalid, duplicate, unavailable, or timed-out results produce no card plus log.

## RationaleObjection

Student challenge to a decomposition rationale.

| Field | Type | Notes |
| --- | --- | --- |
| `objectionId` | string | Stable local ID. |
| `projectId` / `planId` | number | Local project and plan IDs. |
| `stepDbId` | number | Local step row ID. |
| `stableStepId` | string | Stable step ID such as `step-001`. |
| `text` | string | Student objection or question. |
| `linkedCriterionIds` | string[] | Criteria shown with the challenged rationale. |
| `offerStatus` | `none` \| `offered` \| `accepted` \| `dismissed` | Current plan-adjustment offer state. |
| `createdAt` | number | Unix ms. |

Validation:

- Empty objections are rejected.
- A valid objection must be exportable even when no offer is accepted.
- `accepted` cannot directly mutate a plan; it only routes to a reviewable
  plan-area proposal.

## PlanAdjustmentOffer

Non-blocking next action created after a rationale objection.

| Field | Type | Notes |
| --- | --- | --- |
| `offerId` | string | Stable local ID. |
| `objectionId` | string | Source objection. |
| `kind` | `redecompose_step` \| `adjust_plan` | Offer category. |
| `status` | `offered` \| `accepted` \| `dismissed` | User response. |
| `suggestedSeed` | string \| null | Optional concise seed for the plan-area proposal. |
| `createdAt` / `respondedAt` | number \| null | Unix ms. |

Validation:

- The offer is visible near the rationale challenge result.
- Accepting the offer cannot bypass dedicated plan-area confirmation.
- Dismissing the offer does not block step execution.

## SpecConformanceRecord

Documentation/status record connecting this cleanup to the older active specs.

| Field | Type | Notes |
| --- | --- | --- |
| `specId` | string | Affected spec, such as `001`, `002`, `003`, or `004`. |
| `gap` | string | Human-readable conformance gap. |
| `status` | `closed` \| `clarified_future` \| `deferred` | Final state after this feature. |
| `evidence` | string[] | Validation commands, quickstart scenarios, or docs updated. |
| `updatedAt` | number | Unix ms or document date. |

Validation:

- Records must not mark future/reserved contracts as shipped.
- Status summaries must cite the active spec this feature closes or clarifies.
