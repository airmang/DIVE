# Data Model: PRD-Driven Decompose & Plan Lifecycle

## ProjectSpec

Represents the living PRD for one DIVE project.

| Field | Type | Notes |
| --- | --- | --- |
| `projectSpecId` | string | Stable ID, preferably `prd-{projectId}` or DB row ID. |
| `projectId` | number | Existing `Project.id`. |
| `currentVersion` | number | Monotonic version number. |
| `goal` | string | Required minimal PRD field. |
| `intentSummary` | string \| null | Derived from interview or direct edit. |
| `scope` | string[] | In-scope statements. |
| `nonGoals` | string[] | Explicitly out of scope. |
| `constraints` | string[] | Runtime, UX, classroom, or project constraints. |
| `acceptanceCriteria` | AcceptanceCriterion[] | Stable, linkable criteria. |
| `status` | `draft` \| `approved` | Existing plan approval can remain separate; PRD is editable. |
| `createdAt` / `updatedAt` | number | Unix ms. |

Validation:

- `goal` must be non-empty before first decomposition.
- At least one `AcceptanceCriterion` is required before a plan draft can be
  approved.
- Editing creates a new version record and EventLog entry.

## LiveProjectSpecDraft

Unsaved board state used while the PRD Authoring Board is open.

| Field | Type | Notes |
| --- | --- | --- |
| `draftId` | string | Stable draft ID for resume/log correlation. |
| `projectId` | number | Existing `Project.id`. |
| `baseVersion` | number \| null | Last official PRD version, if any. |
| `spec` | ProjectSpecDraft | Current visible canvas content. |
| `dirtyFields` | string[] | Fields changed since last save. |
| `studentEditedFields` | string[] | Fields protected from automatic LLM overwrite. |
| `lastPatchId` | string \| null | Last accepted/rejected patch. |
| `updatedAt` | number | Unix ms. |

Validation:

- Draft state may be autosaved/restored, but it is not an official PRD version.
- `studentEditedFields` take precedence over conflicting LLM patch operations.

## InterviewTurn

| Field | Type | Notes |
| --- | --- | --- |
| `turnId` | string | Stable ID for one student answer + LLM response. |
| `draftId` | string | Live draft being updated. |
| `studentAnswerSummary` | string | Sanitized summary, not raw secret-bearing text. |
| `assistantResponseSummary` | string | Sanitized summary. |
| `patchId` | string \| null | Present when LLM proposed a patch. |
| `validationOutcome` | `none` \| `applied` \| `rejected` \| `held_for_student` | Patch result. |
| `createdAt` | number | Unix ms. |

## PrdPatch

Bounded structured proposal returned by the LLM for one interview turn.

| Field | Type | Notes |
| --- | --- | --- |
| `patchId` | string | DIVE-generated correlation ID. |
| `operations` | PrdPatchOperation[] | Allowlisted field changes. |
| `rationale` | string \| null | Short explanation of why this patch follows from the answer. |
| `sourceTurnId` | string | Interview turn that produced the patch. |

Allowed operations:

- `set_goal`
- `set_intent_summary`
- `append_scope`
- `append_non_goal`
- `append_constraint`
- `append_acceptance_criterion`
- `revise_acceptance_criterion_text`

Validation:

- Unknown fields and unsupported operations are rejected.
- Operation count and text size are bounded.
- LLM-proposed acceptance criteria do not include final IDs; DIVE assigns IDs.
- Operations that conflict with `studentEditedFields` are held for explicit
  student acceptance or rejected.

## AcceptanceCriterion

| Field | Type | Notes |
| --- | --- | --- |
| `criterionId` | string | Stable ID such as `AC-001`; never reuse after deletion. |
| `text` | string | Student-facing observable outcome. |
| `source` | `interview` \| `student_edit` \| `plan_mutation` \| `migration` | Provenance. |
| `status` | `active` \| `retired` | Retired criteria remain resolvable for history. |
| `createdInVersion` | number | PRD version. |
| `retiredInVersion` | number \| null | PRD version if retired. |

Validation:

- Step links may reference only active criteria for new plans/steps.
- Legacy string criteria are adapted into active criteria with `source:
  "migration"` and stable generated IDs.

## DecompositionRationale

Attached to each plan step.

| Field | Type | Notes |
| --- | --- | --- |
| `stepId` | string | Existing stable step ID such as `step-001`. |
| `linkedCriterionIds` | string[] | At least one ID for generated/approved steps. |
| `rationale` | string | Short reason for this split, grounded in criteria. |
| `riskNotes` | string[] | Optional, for known uncertainty or sequencing risks. |
| `createdAt` / `updatedAt` | number | Unix ms. |

Validation:

- New generated steps require at least one `linkedCriterionId`.
- `rationale` must be non-empty and should be short enough for plan cards.
- Links must resolve against the current `ProjectSpec`.

## PlanMutation

Auditable plan-mutation contract. The shipped visible mutation path is
`add_step`; `change_step` and `retire_step` are reserved contract values for a
future visible mutation feature.

| Field | Type | Notes |
| --- | --- | --- |
| `mutationId` | string | Stable event ID. |
| `projectId` / `planId` | number | Existing project/plan IDs. |
| `type` | `add_step` \| `change_step` \| `retire_step` | Shipped visible behavior covers `add_step`. `change_step` and `retire_step` are future/contract-reserved until a later feature implements visible paths. |
| `stepDbId` | number \| null | Present after persistence. |
| `stableStepId` | string \| null | Step ID after assignment. |
| `reason` | string \| null | Student or router reason. |
| `criterionIds` | string[] | Links encouraged for student-added steps. |
| `prdDelta` | ProjectSpecDelta | Required when mutation changes PRD. |
| `scopeExpansion` | ScopeExpansionAssessment | Deterministic result. |
| `createdAt` | number | Unix ms. |

Validation:

- Mutations happen through the dedicated plan area.
- Add-step mutations on approved plans reuse existing dependency, duplicate,
  and execution-envelope validation.
- `change_step` and `retire_step` must not be documented or exposed as shipped
  behavior without a separate visible path, tests, EventLog/export coverage, and
  spec-status update.
- A mutation that expands scope creates a non-blocking specs/002 review-card
  evaluation near the add-step area.

## ProjectSpecDelta

| Field | Type | Notes |
| --- | --- | --- |
| `fromVersion` | number | Previous PRD version. |
| `toVersion` | number | New PRD version. |
| `addedCriteria` | AcceptanceCriterion[] | Criteria added by the mutation. |
| `retiredCriterionIds` | string[] | Criteria retired by the mutation. Non-empty retirement is future/contract-reserved until a visible retire-step or PRD-edit path implements it. |
| `scopeChanges` | string[] | Human-readable summary of scope changes. |
| `nonGoalChanges` | string[] | Human-readable summary of non-goal changes. |

## ScopeExpansionAssessment

| Field | Type | Notes |
| --- | --- | --- |
| `expanded` | boolean | True when new work appears outside the current PRD. |
| `reasonCodes` | string[] | Examples: `missing_criterion_link`, `new_scope_area`, `target_outside_scope`. |
| `evidenceRefs` | string[] | IDs or paths for criteria, step draft, files, or PRD fields. |

## Objection

Student challenge to a step rationale.

| Field | Type | Notes |
| --- | --- | --- |
| `objectionId` | string | Stable event ID. |
| `projectId` / `planId` | number | Existing IDs. |
| `stepDbId` | number | Existing `Step.id`. |
| `stableStepId` | string | Existing `Step.step_id`. |
| `text` | string | Student's objection or selected reason. |
| `linkedCriterionIds` | string[] | Criteria involved in the challenge. |
| `suggestionStatus` | `none` \| `offered` \| `accepted` \| `dismissed` | Re-decomposition is optional. |
| `createdAt` | number | Unix ms. |

Validation:

- Objections never block plan execution.
- Every objection is EventLogged/exportable.

## Persistence Notes

- Existing `Plan.acceptance_criteria` and `Step.acceptance_criteria` can hold
  object arrays during migration, but typed adapters must accept legacy strings.
- If JSON-in-existing-columns becomes ambiguous, add `ProjectSpecVersion` and
  `PlanMutation` tables through a small migration rather than broad rewrites.
- `.dive/plan.json` schema must include PRD, criteria links, rationales, and
  mutation/version metadata once 004 is implemented.

## OnboardingState

Derived view model for first-run guidance.

| Field | Type | Notes |
| --- | --- | --- |
| `projectConnected` | boolean | Existing project setup state. |
| `providerConfigured` | boolean | Existing provider/model setup state. |
| `prdStatus` | `missing` \| `draft` \| `minimal` | New PRD readiness state. |
| `planStatus` | `missing` \| `draft` \| `approved` | Existing plan state. |
| `currentStep` | `project` \| `provider` \| `prd` \| `plan` \| `session` | `prd` comes before plan/session. |

Validation:

- `currentStep` cannot be `plan` or `session` when `prdStatus` is `missing` or
  `draft`.
- `prdStatus: draft` routes to PRD Authoring Board restore, not a new PRD.
