# Contract: UI Lifecycle

## PRD Authoring Board

Surface: a dedicated board replacing/elevating the current
`SocraticInterviewPanel` and its `ChatArea` swap-in behavior.

The board is the first screen for a project that has no minimal PRD. It is not a
landing page, not ordinary chat, not a modal-only flow, and not a multi-step
wizard.

### Layout Regions

1. **Board Header**
   - Shows project name/path or compact project identity.
   - Shows PRD state: `Not started`, `Draft`, `Saved`, or `Version N`.
   - Shows the same provider/model selector available in normal chat.
   - Offers a compact "Open PRD history" or version affordance after save.

2. **Interview Rail**
   - Left side on desktop; top/collapsible section on narrow mobile widths.
   - Contains the short conversational prompts and student responses.
   - Uses a single composer for the next answer.
   - Allows "Use this in PRD" / "Refine" style actions only when tied to visible
     PRD fields.
   - Does not show quiz language, scores, badges, lesson progress, or generic AI
     warnings.

3. **Live PRD Canvas**
   - Right side on desktop; primary section under the rail on narrow widths.
   - Editable fields:
     - Goal
     - Intent summary
     - In scope
     - Out of scope
     - Constraints
     - Acceptance criteria
   - Acceptance criteria render as rows with stable IDs after save/generation
     (`AC-001`, `AC-002`, ...).
   - Empty fields show concise placeholders, not instructional paragraphs.
   - Field edits are local draft edits until the student saves.

4. **Bottom Action Bar**
   - Persistent within the board viewport.
   - Primary action: `Save PRD & Create Plan` or Korean equivalent.
   - Secondary action: save draft/open later.
   - Primary action is disabled until goal and at least one acceptance criterion
     are present.
   - Shows compact validation text only for missing required fields.

### State Model

- `empty`: no PRD draft yet; goal input and provider/model selector are visible.
- `interviewing`: prompts/responses are visible; PRD canvas updates as fields
  are inferred or edited.
- `prd_draft_ready`: goal and at least one acceptance criterion exist; primary
  action is enabled.
- `prd_saved`: PRD version is persisted and decomposition can begin.
- `prd_editing`: existing PRD is open for direct student edits; saving creates a
  new version.

### Interaction Rules

- The student must be able to edit PRD fields directly without asking the AI.
- The interview may propose field text through validated `PrdPatch` objects, but
  the visible canvas is the source of what will be saved.
- Each accepted interview-turn patch must visibly update the live PRD canvas and
  briefly mark changed fields.
- Rejected patches must not change the canvas; the board shows a compact
  non-blocking explanation.
- Direct student edits take precedence over later LLM patch suggestions.
- The board must preserve provider/model selection during the first
  conversation.
- The board must not require more than the minimal PRD to proceed to
  decomposition.
- The board must log PRD authored/edited/version-created events when saved.

### Turn-by-Turn Patch Flow

1. Student submits an answer in the interview rail.
2. LLM returns conversational text and optional `PrdPatch`.
3. DIVE validates the patch shape, allowed fields, operation count, text size,
   and criterion-ID rules.
4. DIVE assigns any new acceptance-criterion IDs.
5. DIVE merges accepted changes into `LiveProjectSpecDraft`.
6. The canvas highlights changed fields.
7. Proposed/applied/rejected patch outcomes are logged.
8. Official PRD version remains unchanged until the student saves.

## Final PRD Read View

Surface: default completed-state view for a saved PRD.

This view is separate from the PRD Authoring Board. It is optimized for review,
not drafting.

### Layout

1. **Compact Header**
   - Project name.
   - PRD version and last updated time.
   - Actions: `Edit PRD`, `Create Plan` or `Review Plan`, and optional history.

2. **Goal Summary**
   - One prominent goal statement.
   - Optional one-sentence intent summary.

3. **Acceptance Criteria**
   - Primary body of the view.
   - Each criterion shows stable ID and text.
   - No patch status or interview transcript is shown.

4. **Scope Boundary**
   - In-scope and out-of-scope shown as compact lists or two short columns.

5. **Key Constraints**
   - Collapsed or compact by default when there are more than three items.

Rules:

- The read view must not show the interview rail.
- The read view must not show patch logs, draft validation hints, or inline
  editing controls.
- Editing intentionally reopens the PRD Authoring Board or a dedicated edit mode.
- Plan generation starts from this read view once a minimal PRD exists.
- The read view must fit the first screen better than the authoring board and
  reduce cognitive load for novice users.

## Onboarding To PRD Transition

Surface: `GetStartedChecklist` and the product shell/controller that decides the
first-run current step.

Required sequence:

1. `project`: local project connected.
2. `provider`: provider/model configured.
3. `prd`: minimal PRD authored or draft restored.
4. `plan`: plan generated/reviewed from the PRD, then step session/roadmap.

Rules:

- If no project exists, onboarding behaves as today and asks for a project.
- If project exists but provider/model is missing, onboarding asks for provider
  setup.
- If project and provider/model exist but no minimal PRD exists, onboarding's
  current action opens the PRD Authoring Board.
- If a PRD draft exists, the current action resumes the draft in the board.
- If a minimal PRD exists but no plan exists, onboarding routes to plan creation
  or plan draft review from the PRD.
- If an approved plan exists, onboarding may route to the roadmap/next step.
- The UI must not label PRD as optional setup; it is the required bridge between
  provider setup and decomposition.

## Criterion-Linked Decomposition

Surfaces: `PlanDraftApprovalScreen`, `RoadmapPanel`, `StepDetailSlideIn`.

Each step must show:

- Stable step ID and title.
- At least one linked PRD criterion ID and criterion text.
- Short rationale for why the work was split this way.
- Existing expected files, dependencies, verification plan, and status.

Required affordances:

- "Why this step?" / rationale challenge action.
- Objection input or short reason choices.
- Non-blocking re-decomposition suggestion area when offered.

The objection flow must not block approve/start/continue actions unless another
existing plan or permission gate already blocks them.

## Dedicated Add-Step Area

Surface: plan area, likely `PlanDashboardPanel` or the active roadmap/plan
detail area.

Required behavior:

- Add step from a dedicated plan UI, not by sending ordinary chat.
- One primary action to create/add a proposed step.
- Encourage criterion linking but allow low-friction save when the student is
  still discovering scope.
- Show the resulting PRD delta before or immediately after save.
- Show non-blocking scope-expansion review card near this surface when the
  deterministic scope gate fires.

Required fields for a manual add-step draft:

- Title.
- Summary or reason.
- Expected files or target area.
- Optional linked criterion.
- Optional verification command/manual check.

## Living PRD Access

Required locations:

- From the PRD Authoring Board before first decomposition.
- From plan approval and roadmap/plan dashboard after decomposition.
- From step detail when reviewing linked criteria/rationale.

Required behavior:

- Open current PRD.
- Edit PRD directly.
- See version metadata in compact form.
- Return to plan without losing current step context.
