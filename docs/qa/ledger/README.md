# QA ledger

Machine-readable record of DIVE's QA defects, scenarios and live-run results
(spec [015](../../../specs/015-self-improvement-loops/spec.md), Loop B, Stage
S-077). From S-077 on, **this ledger is the authoritative defect list**; the
older Markdown reports under `docs/qa/` stay as history and are not
bulk-migrated (D-015-04).

```
docs/qa/ledger/
  defects/    DEF-NNNN.json            one file per defect
  scenarios/  <ID>.json                one file per QA scenario (ONB-01, STATIC-01, ...)
  runs/       <YYYY-MM-DD>-<slug>.json one file per live QA run (tooling: S-082)
```

Every field is documented in
[`dive/scripts/qa-ledger/schema.md`](../../../dive/scripts/qa-ledger/schema.md).
Validate before committing (from `dive/`):

```sh
pnpm qa:ledger:validate            # exit 1 + one line per problem
pnpm qa:ledger:validate -- --next-id   # print the next free DEF-NNNN
```

The same check runs inside `pnpm test:unit` (and therefore CI), so an invalid
record fails the build.

## Why one JSON file per record

Parallel agents and branches add records independently; separate files merge
cleanly and diff readably. JSON (not YAML) because `dive/` carries no YAML
parser or JSON-Schema library — the validator is hand-written (D-015-07).

## Adding a defect

1. Run `pnpm qa:ledger:validate -- --next-id` and take the id it prints
   (highest existing number + 1, zero-padded to 4 digits: `DEF-0001`).
2. Create `defects/<id>.json` — the filename must equal the `id` (illustrative
   values):

   ```json
   {
     "id": "DEF-0001",
     "title": "Review card question is Korean while locale is English",
     "status": "open",
     "severity": "P1",
     "area": "supervision",
     "source": {
       "kind": "review",
       "ref": "docs/qa/post-cleanup-review-2026-07-22.md",
       "findingId": "S3"
     },
     "specRef": "specs/002-provocation-supervisor-agent/spec.md",
     "repro": "Set locale=en, drive a step to verify, observe the card question.",
     "created": "2026-09-29",
     "updated": "2026-09-29"
   }
   ```

3. Run the validator. If two branches allocate the same id, git reports an
   add/add conflict on the file (or the validator reports a duplicate id) —
   renumber the later one.

Never reuse or renumber a committed id; a defect that turns out not to be one
becomes `wontfix` (with `notes`) or `duplicate` (with `duplicateOf`), it is not
deleted.

## Lifecycle

```
open ──▶ fixing ──▶ fixed ──▶ verified
  │         │         │
  └─────────┴─────────┴──▶ wontfix | duplicate
```

| Status      | Meaning                                                 | Extra fields required                                         |
| ----------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| `open`      | Reproduces on the current tree / build.                 | —                                                             |
| `fixing`    | Someone is working on it (put the Stage in `stageRef`). | —                                                             |
| `fixed`     | A fix is merged; not yet confirmed on a built app.      | `guard`                                                       |
| `verified`  | Confirmed fixed on a named build with evidence.         | `guard`, `verified { commit, buildVersion, date, evidence? }` |
| `wontfix`   | Deliberately not fixed.                                 | `notes` (why)                                                 |
| `duplicate` | Same defect as another record.                          | `duplicateOf` (an existing, non-duplicate defect)             |

A `guard` is the regression test that keeps the defect fixed: `vitest`,
`cargo`, `live-scenario` (a scenario id in `scenarios/`) or `eval-fixture`.
"The AI said it is fixed" is never a guard. `pnpm verify:qa-ledger` (S-080)
resolves each guard through its runner and fails on a guard that is missing,
skipped or `#[ignore]`d — run it before moving a defect to `fixed`, and set
`fixCommit` at the same time. CI checks the non-cargo kinds (`test:unit`,
`verify:v4`); cargo guards need the full local run (see `dive/scripts/README.md`).

On every transition, update `status` and `updated`. A regression reopens the
defect: set `status` back to `open` and remove the `verified` block (git keeps
the history).

## Scenarios

The 104 scenario records were imported once on 2026-09-29 from
[`docs/archive/qa/scenario-catalog.md`](../../archive/qa/scenario-catalog.md)
(54 rows, `source.kind: scenario-catalog`) and
[`docs/qa/e2e-journeys.md`](../e2e-journeys.md) (50 journeys,
`source.kind: e2e-journey`). Those documents are now background; edit the JSON.
Each scenario's `areas` refer to the area → path-glob table in
[`dive/scripts/qa-ledger/areas.mjs`](../../../dive/scripts/qa-ledger/areas.mjs),
which `qa:queue` (S-082) uses to pick scenarios whose code changed since their
last pass. Journey areas were derived from the journey text (every journey
covers the full PRD → plan → permission → roadmap → verify path, plus preview,
recovery, terminal, i18n, ... where the text mentions them); journey priority
defaults to `P1`.

New scenarios use `source.kind: ledger`, a fresh `PREFIX-NN` id, and should
name the narrowest areas that cover them.

## Runs

Live QA runs (release `.app` + computer-use) are recorded as
`runs/<YYYY-MM-DD>-<slug>.json` — build version + commit, per-scenario result,
defects opened/verified and hashed evidence paths. The schema is enforced now;
the writing/queue tooling arrives in S-082.

## Seed provenance

`seed/2026-09-29-post-cleanup-recheck.json` holds the evidence-cited re-check
of all 70 surviving findings of `docs/qa/post-cleanup-review-2026-07-22.md`.
Per D-015-04, `still-valid` and `partially-fixed` findings became `open`
defects (DEF-0002–DEF-0018); `fixed` findings were not imported. DEF-0001 is a
new regression the re-check found (dotenv exemption bypass), fixed in
`c9290acc`.
