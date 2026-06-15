# Contract: Workspace Plan IPC

This contract describes the IPC surface needed for 004. Names are proposed and
may be adjusted during tasks, but the behavioral requirements are binding.

## Compatibility Rules

- Existing callers of `workspace_plan_start_interview`,
  `workspace_plan_submit_interview`, `workspace_plan_generate_draft`,
  `workspace_plan_current_draft`, and `workspace_plan_append_step` must keep
  working during migration.
- New payloads may accept object-form criteria/rationales while reading legacy
  string arrays.
- Rust validates persistence, PRD versioning, criterion links, mutation records,
  and EventLog writes.

## ProjectSpec Payload

```ts
interface ProjectSpecPayload {
  projectSpecId: string;
  projectId: number;
  currentVersion: number;
  goal: string;
  intentSummary: string | null;
  scope: string[];
  nonGoals: string[];
  constraints: string[];
  acceptanceCriteria: AcceptanceCriterionPayload[];
  status: "draft" | "approved";
  createdAt: number;
  updatedAt: number;
}
```

## AcceptanceCriterion Payload

```ts
interface AcceptanceCriterionPayload {
  criterionId: string;
  text: string;
  source: "interview" | "student_edit" | "plan_mutation" | "migration";
  status: "active" | "retired";
  createdInVersion: number;
  retiredInVersion: number | null;
}
```

## PrdPatch Payload

```ts
interface PrdPatchPayload {
  patchId: string;
  sourceTurnId: string;
  operations: PrdPatchOperationPayload[];
  rationale: string | null;
}

type PrdPatchOperationPayload =
  | { op: "set_goal"; value: string }
  | { op: "set_intent_summary"; value: string }
  | { op: "append_scope"; value: string }
  | { op: "append_non_goal"; value: string }
  | { op: "append_constraint"; value: string }
  | { op: "append_acceptance_criterion"; text: string }
  | { op: "revise_acceptance_criterion_text"; criterionId: string; text: string };
```

Rules:

- LLM output may contain criteria text, but DIVE assigns final criterion IDs.
- Unknown operations or fields are rejected.
- Patch operations that conflict with student-edited fields are held for
  explicit acceptance or rejected.

## StepDraftInput Extension

```ts
interface StepDraftInput {
  stepId: string;
  title: string;
  summary: string;
  instructionSeed: string;
  expectedFiles: string[];
  acceptanceCriteria: string[] | AcceptanceCriterionPayload[];
  linkedCriterionIds?: string[];
  rationale?: string;
  verificationCommand: string | null;
  verificationType: string | null;
  dependencies: string[];
  parallelGroup: number | null;
  position: number;
}
```

Validation:

- Generated plan drafts require `linkedCriterionIds.length >= 1` and non-empty
  `rationale` for every step.
- Student-added steps may omit links at first, but the mutation must record
  `scopeExpansion.reasonCodes` and offer linking assistance.

## Commands

### `workspace_prd_status`

Input:

```ts
{ projectId: number }
```

Output:

```ts
{
  status: "missing" | "draft" | "minimal";
  projectSpecId: string | null;
  currentVersion: number | null;
}
```

Behavior:

- Used by onboarding to decide whether the current step is PRD authoring,
  plan generation, or roadmap/session.
- Must distinguish an unsaved/missing PRD from a resumable draft.

### `workspace_prd_get`

Input:

```ts
{ projectId: number }
```

Output:

```ts
ProjectSpecPayload | null
```

### `workspace_prd_interview_turn`

Input:

```ts
{
  projectId: number;
  draftId: string;
  answer: string;
  provider: string;
  model: string;
}
```

Output:

```ts
{
  turnId: string;
  assistantMessage: string;
  patch: PrdPatchPayload | null;
  validationOutcome: "none" | "applied" | "rejected" | "held_for_student";
  appliedFieldPaths: string[];
  rejectedReasons: string[];
  liveDraft: ProjectSpecDraftPayload;
}
```

Behavior:

- Invokes the selected provider/model for the interview turn.
- Treats the returned `PrdPatch` as a proposal.
- Validates the patch before merge.
- Assigns stable acceptance-criterion IDs during merge.
- Does not create an official PRD version.
- Logs proposed/applied/rejected patch outcome for export.

### `workspace_prd_save`

Input:

```ts
{
  projectId: number;
  spec: ProjectSpecDraftPayload;
  reason: "interview" | "student_edit" | "plan_mutation";
}
```

Output:

```ts
ProjectSpecPayload
```

Behavior:

- Creates a new PRD version.
- Logs `prd_authored` for first save or `prd_edited`/`prd_version_created` for
  later saves.
- Redacts obvious PII/secrets before EventLog persistence.

### `workspace_plan_generate_draft`

Existing command with stricter payload validation.

Behavior additions:

- Requires an existing minimal PRD for `projectId`.
- Validates each step's `linkedCriterionIds`.
- Persists `DecompositionRationale` with each step.
- Logs `plan_generated` with PRD version and criterion coverage summary.

### `workspace_plan_append_step`

Existing command with mutation additions.

Input additions:

```ts
{
  mutationReason?: string | null;
  linkedCriterionIds?: string[];
  prdDelta?: ProjectSpecDeltaPayload | null;
}
```

Behavior additions:

- Must be invoked from the dedicated plan area.
- Creates a `PlanMutation` record and updates PRD version when needed.
- Logs `plan_step_appended` with mutation ID, PRD version delta, linked
  criteria, and scope-expansion assessment.
- If `scopeExpansion.expanded === true`, asks specs/002 review-card path for a
  non-blocking card near the add-step surface.

### `workspace_plan_challenge_step_rationale`

Input:

```ts
{
  planId: number;
  stepDbId: number;
  text: string;
  linkedCriterionIds?: string[];
}
```

Output:

```ts
{
  objectionId: string;
  suggestionStatus: "none" | "offered";
}
```

Behavior:

- Logs `plan_step_rationale_challenged`.
- Does not block step execution.
- May return a re-decomposition suggestion, but the suggestion must require
  explicit student acceptance before any plan mutation.
