// Guard resolution for the QA ledger (spec 015, S-080 / FR-040–FR-041).
//
// A `fixed` or `verified` defect is only as good as the regression guard that
// keeps it fixed, so each guard must resolve *through its runner* — never by
// grepping source:
//
//   vitest         `vitest list --json` must collect `<file>::<describe > it>`.
//                  vitest list omits .skip / .todo / skipIf(true) tests (and
//                  siblings of an .only), so a skipped guard is simply absent
//                  and fails like a missing one (FR-041).
//   cargo          `cargo test --features dev-mock --all-targets -- --list`
//                  must list the test; if `-- --list --ignored` also lists it,
//                  it is #[ignore]d and fails (FR-041).
//   eval-fixture   a fixture with that `id` must exist under
//                  dive/eval/supervisor/fixtures/ (S-079).
//   live-scenario  the most recent run record after the fix that includes the
//                  scenario must have passed it. "After the fix" = the run's
//                  build commit descends from `defect.fixCommit` (git), or,
//                  without a fixCommit, run date >= `defect.updated`.
//
// Runners are injected so tests can stub their output; `defaultRunners()`
// shells out to the real tools. Each runner is invoked at most once, and only
// when a guard of its kind needs checking.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isAncestor } from "./git.mjs";
import { GUARDED_STATUSES, GUARD_KINDS } from "./schema.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DIVE_DIR = join(REPO_ROOT, "dive");
const SRC_TAURI_DIR = join(DIVE_DIR, "src-tauri");
export const EVAL_FIXTURE_DIR = join(DIVE_DIR, "eval", "supervisor", "fixtures");

const toPosix = (path) => path.split(sep).join("/");

/** Split a vitest guard ref into its repo-relative file and full test name. */
export function parseVitestRef(ref) {
  const at = ref.indexOf("::");
  return { file: ref.slice(0, at), name: ref.slice(at + 2) };
}

function runOrThrow(label, command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 << 20, ...options });
  if (result.error)
    throw new Error(`${label}: could not start ${command} (${result.error.message})`);
  if (result.status !== 0) {
    const tail = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim().split("\n").slice(-20);
    throw new Error(`${label}: exited ${result.status}\n${tail.join("\n")}`);
  }
  return result.stdout;
}

function listVitestTests(files) {
  const existing = files.filter(
    (file) => file.startsWith("dive/") && existsSync(join(REPO_ROOT, file)),
  );
  if (existing.length === 0) return [];
  const outDir = mkdtempSync(join(tmpdir(), "qa-ledger-vitest-"));
  const outFile = join(outDir, "list.json");
  // Strip the parent's VITEST* markers so a list spawned from inside a vitest
  // run (the CI check in guards.test.mjs) behaves like a top-level one.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
  );
  try {
    runOrThrow(
      "vitest list",
      process.execPath,
      [
        join(DIVE_DIR, "node_modules", "vitest", "vitest.mjs"),
        "list",
        `--json=${outFile}`,
        ...existing.map((file) => file.slice("dive/".length)),
      ],
      { cwd: DIVE_DIR, env },
    );
    return JSON.parse(readFileSync(outFile, "utf8")).map((test) => ({
      file: toPosix(relative(REPO_ROOT, test.file)),
      name: test.name,
    }));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

export function parseCargoList(stdout) {
  const names = [];
  for (const line of stdout.split("\n")) {
    const match = /^(\S+): test$/.exec(line.trim());
    if (match) names.push(match[1]);
  }
  return names;
}

function listCargoTests(cargoDir = SRC_TAURI_DIR) {
  const base = ["test", "--quiet", "--features", "dev-mock", "--all-targets", "--", "--list"];
  const options = { cwd: cargoDir };
  return {
    tests: parseCargoList(runOrThrow("cargo test --list", "cargo", base, options)),
    ignored: parseCargoList(
      runOrThrow("cargo test --list --ignored", "cargo", [...base, "--ignored"], options),
    ),
  };
}

function listEvalFixtureIds(dir = EVAL_FIXTURE_DIR) {
  if (!existsSync(dir)) return null;
  const ids = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".json")) {
        const { id } = JSON.parse(readFileSync(path, "utf8"));
        if (typeof id === "string") ids.push(id);
      }
    }
  };
  walk(dir);
  return ids;
}

/**
 * The real runners: vitest, cargo, the eval fixture tree and git. `cargoDir`
 * lists cargo tests from another checkout of dive/src-tauri (e.g. a clean
 * `git worktree` of HEAD while the working tree is mid-edit).
 */
export function defaultRunners({ cargoDir } = {}) {
  return {
    listVitestTests,
    listCargoTests: () => listCargoTests(cargoDir),
    listEvalFixtureIds,
    isAncestor,
  };
}

function lazy(fn) {
  let called = false;
  let value;
  return (...args) => {
    if (!called) {
      value = fn(...args);
      called = true;
    }
    return value;
  };
}

function resolveVitest(guards, runners) {
  const files = [...new Set(guards.map(({ guard }) => parseVitestRef(guard.ref).file))];
  const listed = new Set(
    runners.listVitestTests(files).map((test) => `${test.file}::${test.name}`),
  );
  return guards.map(({ guard }) => {
    const { file } = parseVitestRef(guard.ref);
    if (listed.has(guard.ref)) return { outcome: "resolved" };
    if (!file.startsWith("dive/")) {
      return { outcome: "unresolved", detail: "file is outside the vitest root (dive/)" };
    }
    if (!existsSync(join(REPO_ROOT, file))) {
      return { outcome: "unresolved", detail: `test file ${file} does not exist` };
    }
    return {
      outcome: "unresolved",
      detail:
        "not collected by `vitest list` (renamed/removed, .skip/.todo/skipIf, or shadowed by .only)",
    };
  });
}

function resolveCargo(guards, runners) {
  const { tests, ignored } = runners.listCargoTests();
  const listed = new Set(tests);
  const ignoredSet = new Set(ignored);
  return guards.map(({ guard }) => {
    if (ignoredSet.has(guard.ref)) {
      return { outcome: "ignored", detail: "test is #[ignore]d, so CI never runs it (FR-041)" };
    }
    if (listed.has(guard.ref)) return { outcome: "resolved" };
    return { outcome: "unresolved", detail: "not listed by `cargo test -- --list`" };
  });
}

function resolveEvalFixture(guards, runners) {
  const ids = runners.listEvalFixtureIds();
  const known = new Set(ids ?? []);
  return guards.map(({ guard }) => {
    if (ids === null) {
      return { outcome: "unresolved", detail: "eval fixture directory does not exist yet (S-079)" };
    }
    if (known.has(guard.ref)) return { outcome: "resolved" };
    return { outcome: "unresolved", detail: `no eval fixture with id "${guard.ref}"` };
  });
}

function resolveLiveScenario(guards, ledger, runners) {
  const runs = ledger.runs.map((entry) => entry.record).filter(Boolean);
  return guards.map(({ record, guard }) => {
    const afterFix = (run) =>
      record.fixCommit
        ? runners.isAncestor(record.fixCommit, run.build?.commit)
        : Date.parse(run.date) >= Date.parse(record.updated);
    const candidates = runs
      .map((run) => ({ run, entry: run.scenarios?.find((s) => s?.id === guard.ref) }))
      .filter(({ run, entry }) => entry && afterFix(run))
      .sort(
        (a, b) =>
          Date.parse(b.run.date) - Date.parse(a.run.date) || b.run.id.localeCompare(a.run.id),
      );
    const since = record.fixCommit ? `fix commit ${record.fixCommit}` : `${record.updated}`;
    if (candidates.length === 0) {
      return { outcome: "unresolved", detail: `no run record of ${guard.ref} after ${since}` };
    }
    const [{ run, entry }] = candidates;
    if (entry.result === "pass") return { outcome: "resolved", detail: `run ${run.id}` };
    return {
      outcome: "unresolved",
      detail: `latest run of ${guard.ref} after ${since} (${run.id}) recorded "${entry.result}"`,
    };
  });
}

/**
 * Resolve the guard of every `fixed`/`verified` defect in a loaded ledger.
 * Returns `{ results, failed }`: one result per guarded defect with
 * `outcome` = resolved | unresolved | ignored | not-checked (kind filtered
 * out by `kinds`); `failed` lists the unresolved and ignored ones.
 */
export function resolveGuards(ledger, { kinds = GUARD_KINDS, runners = defaultRunners() } = {}) {
  const r = {
    listVitestTests: lazy(runners.listVitestTests),
    listCargoTests: lazy(runners.listCargoTests),
    listEvalFixtureIds: lazy(runners.listEvalFixtureIds),
    isAncestor: runners.isAncestor,
  };
  const guarded = ledger.defects
    .filter(({ record }) => GUARDED_STATUSES.includes(record?.status) && record.guard)
    .map(({ file, record }) => ({ file, record, guard: record.guard }));

  const results = [];
  for (const kind of GUARD_KINDS) {
    const ofKind = guarded.filter(({ guard }) => guard.kind === kind);
    if (ofKind.length === 0) continue;
    let outcomes;
    if (!kinds.includes(kind)) {
      outcomes = ofKind.map(() => ({ outcome: "not-checked" }));
    } else if (kind === "vitest") {
      outcomes = resolveVitest(ofKind, r);
    } else if (kind === "cargo") {
      outcomes = resolveCargo(ofKind, r);
    } else if (kind === "eval-fixture") {
      outcomes = resolveEvalFixture(ofKind, r);
    } else {
      outcomes = resolveLiveScenario(ofKind, ledger, r);
    }
    ofKind.forEach(({ file, record, guard }, i) => {
      results.push({ id: record.id, file, kind, ref: guard.ref, ...outcomes[i] });
    });
  }
  const failed = results.filter((result) => ["unresolved", "ignored"].includes(result.outcome));
  return { results, failed };
}
