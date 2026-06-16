# Contract: Scope Expansion Supervisor Event

## Purpose

Move add-step scope-expansion review cards from frontend-authored rule cards to
the dedicated SupervisorAgent review path.

## Trigger

`scope_expansion` is triggered only when DIVE's deterministic add-step
assessment reports `expanded = true`.

## Supervisor Context Requirements

Required fields:

- `schemaVersion`
- `event`: `scope_expansion`
- `artifactRef`: add-step draft or candidate step
- `mode`: `work` or `guided`
- `locale`
- `contextHash`
- `evidenceHash`
- `allowedActionIds`
- `evidenceRefs`
- `scopeExpansion.reasonCodes`
- `scopeExpansion.evidenceRefs`

Evidence refs may include:

- Current PRD goal or scope summary.
- Active acceptance criterion IDs and short text.
- Add-step title, reason, linked criteria, expected files, and PRD delta summary.
- Scope-expansion reason codes such as missing criterion link, new scope area,
  or out-of-scope target.

## Allowed Actions

Allowed suggested actions are review nudges only:

- `link_criterion`
- `split_scope`
- `edit_prd`
- `dismiss_review`

Proceed/approve actions are not valid SupervisorAgent suggestions.

## Validation

DIVE must drop a decision when:

- It references unknown evidence refs.
- It has no evidence refs.
- It is not phrased as a question.
- It exceeds card string caps.
- It is a duplicate for the same artifact, concern, and evidence hash.
- It suggests disallowed proceed/approve actions after action filtering.

DIVE may strip unknown non-critical actions and still render the card when the
remaining decision is valid.

## Rendering

A valid card:

- Appears near the dedicated add-step area.
- Is non-blocking.
- Shows one focal question, bounded evidence, and bounded actions.
- Allows dismiss and mark-irrelevant.
- Logs exposure and response through the local ledger.

## Failure Behavior

Supervisor timeout, unavailable runtime, malformed output, invalid decision, or
duplicate decision results in no card plus local log. No static fallback card is
shown.
