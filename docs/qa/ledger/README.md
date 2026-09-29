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
  runs/       <YYYY-MM-DD>-<slug>.json one file per live QA run (pnpm qa:run)
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
skipped or `#[ignore]`d, and on a vitest guard declared `.fails` or whose
name is shared by several tests — run it before moving a defect to `fixed`,
and set `fixCommit` at the same time. CI checks the non-cargo kinds
(`test:unit`, `verify:v4`); cargo guards are not enforced by CI until the owner
adds the release-gate line in `dive/scripts/README.md`.

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
last pass. Journey areas were re-derived on 2026-09-29 (S-082 / T071) from
per-area evidence in each journey's text — an area is listed only when the
journey shows the user touching it (so STATIC-01's "no dev server" no longer
implies `terminal`). Every scenario that needs a live model call or touches
supervision/verification also lists `pi-sidecar`. Journey priority defaults
to `P1`.

New scenarios use `source.kind: ledger`, a fresh `PREFIX-NN` id, and should
name the narrowest areas that cover them.

## Runs

Live QA runs (release `.app` + computer-use) are recorded as
`runs/<YYYY-MM-DD>-<slug>.json` — build version + commit, per-scenario result,
defects opened/verified and hashed evidence paths. The loop (S-082), from `dive/`:

1. `pnpm qa:queue [--since <ref>]` picks the scenarios to run and writes a work
   order to `.harness/work-orders/qa/<date>.md` (gitignored): why each scenario
   was picked, its steps and expected result, and the release-`.app` recipe
   (`DIVE_SESSION_ORIGIN=qa` so the sessions stay out of research aggregates).
2. `pnpm qa:run init --scenarios <ids>` writes a run draft (build version +
   HEAD commit) to `.harness/work-orders/qa/runs/`.
3. Fill in results, new defects (`opened`), confirmed fixes (`verify`) and
   evidence paths while testing.
4. `pnpm qa:run apply <draft>` writes the run record, the new `open` defects,
   `fixed → verified` transitions and scenario `lastPass` — all or nothing,
   validated as a whole ledger first, then written temp-file + rename, run
   record first. A defect becomes `verified` only when the build was clean
   (`build.dirty: false`), it has a `fixCommit` that the tested build
   contains, and this run passed its live-scenario guard — or, for a test
   guard, at least one scenario in the defect's area. `verified.runId` points
   at that run.

## Seed provenance

`seed/2026-09-29-post-cleanup-recheck.json` holds the evidence-cited re-check
of all 70 surviving findings of `docs/qa/post-cleanup-review-2026-07-22.md`.
Per D-015-04, `still-valid` and `partially-fixed` findings became `open`
defects (DEF-0002–DEF-0018); `fixed` findings were not imported. DEF-0001 is a
new regression the re-check found (dotenv exemption bypass), fixed in
`c9290acc`.
