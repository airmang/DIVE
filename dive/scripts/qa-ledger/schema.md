# QA ledger record schema

Field reference for `docs/qa/ledger/` records (spec 015, S-077 — FR-010/FR-011,
D-015-07). The enforcing code is `schema.mjs` (per record) and `load.mjs`
(cross-record); keep this file in sync with both. Workflow (how to add or
transition a defect) lives in [`docs/qa/ledger/README.md`](../../../docs/qa/ledger/README.md).

Conventions for every record:

- One JSON object per file, named `<id>.json`. Unknown fields are errors (typo guard).
- Dates are ISO 8601: `YYYY-MM-DD`, or a full timestamp with zone (`2026-09-29T10:15:00Z`).
- Paths (`evidence[].path`, `pathGlobs[]`) are repo-relative POSIX paths — no
  leading `/`, no `..`.
- `sha256` is 64 lowercase hex characters; `commit` is a 7–40 character lowercase git sha.
- Area names come from the table in `areas.mjs` (see [Areas](#areas)).

## Defect — `defects/DEF-NNNN.json`

| Field         | Type       | Required | Notes                                                                                                          |
| ------------- | ---------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `id`          | `DEF-NNNN` | yes      | Zero-padded to 4 digits; allocate with `pnpm qa:ledger:validate -- --next-id`.                                 |
| `title`       | string     | yes      | One line, symptom-first.                                                                                       |
| `status`      | enum       | yes      | `open` · `fixing` · `fixed` · `verified` · `wontfix` · `duplicate` (lifecycle in the ledger README).           |
| `severity`    | enum       | yes      | `P0` · `P1` · `P2`.                                                                                            |
| `area`        | area name  | yes      | Single primary area; drives triage clustering (S-084).                                                         |
| `source`      | object     | yes      | `{ kind, ref, findingId? }` — see below.                                                                       |
| `specRef`     | string     | no       | Governing spec/FR, e.g. `specs/002-provocation-supervisor-agent/spec.md#FR-030`.                               |
| `stageRef`    | string     | no       | Wily Stage id, e.g. `S-080`.                                                                                   |
| `repro`       | string     | no       | Minimal reproduction steps.                                                                                    |
| `notes`       | string     | no       | Free text. **Required** when `status` is `wontfix` (record why).                                               |
| `duplicateOf` | `DEF-NNNN` | iff dup  | Required when `status` is `duplicate`, forbidden otherwise; must name an existing, non-duplicate defect.       |
| `guard`       | object     | cond.    | `{ kind, ref }`. **Required** when `status` is `fixed` or `verified` (FR-040).                                 |
| `verified`    | object     | cond.    | `{ commit, buildVersion, date, evidence? }`. Required when `status` is `verified`, forbidden for other states. |
| `created`     | date       | yes      |                                                                                                                |
| `updated`     | date       | yes      | Must not be earlier than `created`.                                                                            |

`source.kind` is one of `review` (a code-review report), `live-run` (a live QA
run — `ref` is the run id), `eval` (an S-079 eval regression), `audit`, `user`.
`source.ref` names the report/run/eval; `source.findingId` is the finding id
inside that report when there is one.

`guard.kind` and the shape of `guard.ref`:

| `kind`          | `ref` format                                        | Example                                                            |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| `vitest`        | `<repo path>.test.{ts,tsx,mjs}::<test name>`        | `dive/src/features/provocation/rules.test.ts::locale > renders en` |
| `cargo`         | Rust test path as printed by `cargo test -- --list` | `dive::supervisor::decision::tests::rejects_static_fallback`       |
| `live-scenario` | scenario id; must exist under `scenarios/`          | `SUP-01`                                                           |
| `eval-fixture`  | S-079 fixture id                                    | `verify-claim-done-ko-work`                                        |

This validator only checks the shape. S-080 (`verify:qa-ledger`) resolves each
guard through its runner and fails when it is missing, skipped or ignored.

`verified.evidence` is `[{ path, sha256 }]` — screenshots/logs stay gitignored
or in the evidence archive; the hash pins exactly which artifact was seen.

## Scenario — `scenarios/<ID>.json`

| Field           | Type        | Required | Notes                                                                                                |
| --------------- | ----------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `id`            | `PREFIX-NN` | yes      | Existing ids are kept (`ONB-01`, `STATIC-01`, …). Pattern `^[A-Z][A-Z0-9]*-\d{2,}$`.                 |
| `title`         | string      | yes      |                                                                                                      |
| `source`        | object      | yes      | `{ kind, ref }`; `kind` is `scenario-catalog` · `e2e-journey` · `ledger` (authored here directly).   |
| `areas`         | area name[] | yes      | Non-empty, unique. The scenario's code footprint is the union of these areas' globs.                 |
| `pathGlobs`     | glob[]      | yes      | Extra globs beyond the areas (may be `[]`). Same glob syntax as `areas.mjs`.                         |
| `priority`      | enum        | yes      | `P0` · `P1` · `P2`.                                                                                  |
| `requiresLlm`   | boolean     | no       | `true` when the scenario needs a live provider call (costs money; the queue may batch these).        |
| `preconditions` | string      | no       | Starting state (journeys: the persona).                                                              |
| `steps`         | string[]    | no       | Non-empty when present.                                                                              |
| `expected`      | string      | no       | What a pass looks like.                                                                              |
| `tags`          | string[]    | no       | Free-form (catalog risk probes such as `i18n`, `parse`; journeys: `journey`, category, skill level). |
| `notes`         | string      | no       | Journeys keep their "Watch for" text here.                                                           |
| `lastPass`      | object      | no       | `{ runId, date }`; `runId` must name an existing run record. Maintained by the S-082 run tooling.    |

## Run record — `runs/<YYYY-MM-DD>-<slug>.json`

Schema only for now; the tooling that writes these lands in S-082 (FR-060).

| Field             | Type         | Required | Notes                                                                                                                 |
| ----------------- | ------------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`              | string       | yes      | `YYYY-MM-DD-<slug>` (lowercase, `-` separated); the date prefix equals `date`.                                        |
| `date`            | date         | yes      |                                                                                                                       |
| `build`           | object       | yes      | `{ version, commit }` of the build under test.                                                                        |
| `platform`        | string       | yes      | e.g. `macos-arm64`, `windows-x64`.                                                                                    |
| `scenarios`       | object[]     | yes      | Non-empty `[{ id, result, notes? }]`; `result` is `pass` · `fail` · `blocked` · `skipped`; ids unique and must exist. |
| `defectsOpened`   | `DEF-NNNN`[] | yes      | Defects this run created; each must exist.                                                                            |
| `defectsVerified` | `DEF-NNNN`[] | yes      | Defects this run confirmed fixed; each must exist.                                                                    |
| `evidence`        | object[]     | yes      | `[{ path, sha256 }]` (may be `[]`).                                                                                   |
| `notes`           | string       | no       |                                                                                                                       |

## Areas

`areas.mjs` maps each area name to repo-relative path globs (`**` = any number
of path segments, `*` = within one segment). A unit test asserts every glob
matches at least one tracked file, so renaming a file out from under an area
fails `pnpm test:unit`. When adding a product surface, add its paths to the
right area(s) in the same change.
