import { describe, expect, it, vi } from "vitest";
import {
  defaultRunners,
  failsDeclarationIn,
  parseCargoList,
  parseVitestRef,
  resolveGuards,
} from "./guards.mjs";
import { DEFAULT_LEDGER_ROOT, loadLedger } from "./load.mjs";

function defect(id, guard, overrides = {}) {
  return {
    file: `defects/${id}.json`,
    record: {
      id,
      title: id,
      status: "fixed",
      severity: "P2",
      area: "chat",
      source: { kind: "user", ref: "x" },
      guard,
      created: "2026-09-01",
      updated: "2026-09-10",
      ...overrides,
    },
  };
}

function run(id, date, commit, scenarios, startedAt = `${date}T10:00:00Z`) {
  return {
    record: {
      id,
      date,
      startedAt,
      build: { version: "1.0.0-rc.11", commit },
      platform: "macos-arm64",
      scenarios,
      defectsOpened: [],
      defectsVerified: [],
      evidence: [],
    },
  };
}

function stubRunners(overrides = {}) {
  return {
    listVitestTests: vi.fn(() => []),
    listCargoTests: vi.fn(() => ({ tests: [], ignored: [] })),
    listEvalFixtureIds: vi.fn(() => []),
    isAncestor: vi.fn(() => false),
    commitPresence: vi.fn(() => "present"),
    readTestSource: vi.fn(() => ""),
    ...overrides,
  };
}

const byId = (report) => Object.fromEntries(report.results.map((r) => [r.id, r]));

describe("resolveGuards", () => {
  it("resolves vitest guards against the listed <file>::<name> ids", () => {
    const ref = "dive/src/hooks/chat-session-reducer.test.ts::reducer > keeps cancel";
    const runners = stubRunners({
      listVitestTests: vi.fn(() => [
        { file: "dive/src/hooks/chat-session-reducer.test.ts", name: "reducer > keeps cancel" },
      ]),
    });
    const ledger = {
      defects: [
        defect("DEF-0001", { kind: "vitest", ref }),
        defect("DEF-0002", { kind: "vitest", ref: `${ref} (renamed)` }),
        defect("DEF-0003", { kind: "vitest", ref: "dive/src/gone.test.ts::x" }),
      ],
      runs: [],
    };
    const report = resolveGuards(ledger, { runners });
    const results = byId(report);
    expect(runners.listVitestTests).toHaveBeenCalledTimes(1);
    expect(runners.listVitestTests).toHaveBeenCalledWith([
      "dive/src/hooks/chat-session-reducer.test.ts",
      "dive/src/gone.test.ts",
    ]);
    expect(results["DEF-0001"].outcome).toBe("resolved");
    expect(results["DEF-0002"]).toMatchObject({ outcome: "unresolved" });
    expect(results["DEF-0002"].detail).toMatch(/not collected by `vitest list`.*\.skip/);
    expect(results["DEF-0003"].detail).toBe("test file dive/src/gone.test.ts does not exist");
    expect(report.failed.map((r) => r.id)).toEqual(["DEF-0002", "DEF-0003"]);
  });

  it("fails a vitest guard whose name is shared or whose test is declared .fails", () => {
    const file = "dive/src/a.test.ts";
    const runners = stubRunners({
      listVitestTests: vi.fn(() => [
        { file, name: "outer > twice" },
        { file, name: "outer > twice" },
        { file, name: "outer > expected to fail" },
        { file, name: "outer > fine" },
      ]),
      readTestSource: vi.fn(
        () => `describe("outer", () => {
  it("twice", () => {});
  it("twice", () => {});
  it.fails("expected to fail", () => { throw new Error("bug"); });
  it("fine", () => {});
});`,
      ),
    });
    const ledger = {
      defects: [
        defect("DEF-0001", { kind: "vitest", ref: `${file}::outer > twice` }),
        defect("DEF-0002", { kind: "vitest", ref: `${file}::outer > expected to fail` }),
        defect("DEF-0003", { kind: "vitest", ref: `${file}::outer > fine` }),
      ],
      runs: [],
    };
    const results = byId(resolveGuards(ledger, { runners }));
    expect(results["DEF-0001"].detail).toBe(
      `ambiguous: 2 tests in ${file} share this name — rename one`,
    );
    expect(results["DEF-0002"]).toMatchObject({ outcome: "unresolved" });
    expect(results["DEF-0002"].detail).toMatch(/declared with \.fails/);
    expect(results["DEF-0003"].outcome).toBe("resolved");
  });

  it("finds .fails anywhere in the describe chain and in chained modifiers", () => {
    expect(
      failsDeclarationIn(`describe.fails("outer", () => { it("x", () => {}) })`, "outer > x"),
    ).toBe("outer");
    expect(failsDeclarationIn("test.concurrent.fails('a.b', () => {})", "a.b")).toBe("a.b");
    expect(failsDeclarationIn('it("a.b", () => {}); it.fails("axb", () => {})', "a.b")).toBeNull();
  });

  it("fails cargo guards that are missing or #[ignore]d", () => {
    const runners = stubRunners({
      listCargoTests: vi.fn(() => ({
        tests: ["tools::guard::tests::a", "db::tests::slow"],
        ignored: ["db::tests::slow"],
      })),
    });
    const ledger = {
      defects: [
        defect("DEF-0001", { kind: "cargo", ref: "tools::guard::tests::a" }),
        defect("DEF-0002", { kind: "cargo", ref: "db::tests::slow" }),
        defect("DEF-0003", { kind: "cargo", ref: "db::tests::missing" }),
      ],
      runs: [],
    };
    const results = byId(resolveGuards(ledger, { runners }));
    expect(results["DEF-0001"].outcome).toBe("resolved");
    expect(results["DEF-0002"]).toMatchObject({ outcome: "ignored" });
    expect(results["DEF-0003"]).toMatchObject({ outcome: "unresolved" });
  });

  it("resolves eval-fixture guards by fixture id and fails when the fixture dir is absent", () => {
    const ledger = {
      defects: [defect("DEF-0001", { kind: "eval-fixture", ref: "verify-ko-work" })],
      runs: [],
    };
    const found = resolveGuards(ledger, {
      runners: stubRunners({ listEvalFixtureIds: () => ["verify-ko-work"] }),
    });
    expect(found.failed).toEqual([]);
    const absent = resolveGuards(ledger, {
      runners: stubRunners({ listEvalFixtureIds: () => null }),
    });
    expect(absent.failed[0].detail).toMatch(/fixture directory does not exist/);
  });

  it("needs the latest post-fix run of a live-scenario guard to be a pass", () => {
    const guard = { kind: "live-scenario", ref: "SUP-01" };
    const ledger = {
      defects: [
        // No fixCommit: runs dated on/after `updated` (2026-09-10) count.
        defect("DEF-0001", guard),
        defect("DEF-0002", guard, { updated: "2026-09-21" }),
        defect("DEF-0003", guard, { updated: "2026-09-30" }),
        // fixCommit: only runs built from a descendant count.
        defect("DEF-0004", guard, { fixCommit: "aaaaaaa" }),
      ],
      runs: [
        run("2026-09-05-a", "2026-09-05", "1111111", [{ id: "SUP-01", result: "fail" }]),
        run("2026-09-12-b", "2026-09-12", "2222222", [{ id: "SUP-01", result: "pass" }]),
        run("2026-09-20-c", "2026-09-20", "3333333", [{ id: "SUP-01", result: "fail" }]),
        run("2026-09-25-d", "2026-09-25", "4444444", [{ id: "SUP-01", result: "pass" }]),
      ],
    };
    const isAncestor = vi.fn((fix, commit) => fix === "aaaaaaa" && commit === "2222222");
    const results = byId(resolveGuards(ledger, { runners: stubRunners({ isAncestor }) }));
    expect(results["DEF-0001"]).toMatchObject({ outcome: "resolved", detail: "run 2026-09-25-d" });
    expect(results["DEF-0002"]).toMatchObject({ outcome: "resolved" });
    expect(results["DEF-0003"].detail).toBe("4 run(s) of SUP-01, none dated on/after 2026-09-30");
    expect(results["DEF-0004"]).toMatchObject({ outcome: "resolved", detail: "run 2026-09-12-b" });

    const failing = {
      defects: [defect("DEF-0005", guard, { updated: "2026-09-15" })],
      runs: [
        run("2026-09-20-c", "2026-09-20", "3333333", [{ id: "SUP-01", result: "fail" }]),
        run("2026-09-12-b", "2026-09-12", "2222222", [{ id: "SUP-01", result: "pass" }]),
      ],
    };
    expect(resolveGuards(failing, { runners: stubRunners() }).failed[0].detail).toBe(
      'latest post-fix run of SUP-01 (2026-09-20-c) recorded "fail"',
    );

    const none = { defects: [defect("DEF-0006", guard)], runs: [] };
    expect(resolveGuards(none, { runners: stubRunners() }).failed[0].detail).toBe(
      "no run record of SUP-01 yet",
    );
    const noneAfterFix = {
      defects: [defect("DEF-0007", guard, { fixCommit: "aaaaaaa" })],
      runs: [run("2026-09-12-b", "2026-09-12", "2222222", [{ id: "SUP-01", result: "pass" }])],
    };
    expect(resolveGuards(noneAfterFix, { runners: stubRunners() }).failed[0].detail).toBe(
      "1 run(s) of SUP-01, none built from a descendant of fix commit aaaaaaa",
    );
  });

  it("orders same-date runs by startedAt", () => {
    const guard = { kind: "live-scenario", ref: "SUP-01" };
    const ledger = {
      defects: [defect("DEF-0001", guard, { updated: "2026-09-20" })],
      runs: [
        // Ids sort the other way round; startedAt must win.
        run(
          "2026-09-20-a",
          "2026-09-20",
          "1111111",
          [{ id: "SUP-01", result: "fail" }],
          "2026-09-20T18:00:00Z",
        ),
        run(
          "2026-09-20-b",
          "2026-09-20",
          "2222222",
          [{ id: "SUP-01", result: "pass" }],
          "2026-09-20T09:00:00Z",
        ),
      ],
    };
    expect(resolveGuards(ledger, { runners: stubRunners() }).failed[0].detail).toBe(
      'latest post-fix run of SUP-01 (2026-09-20-a) recorded "fail"',
    );
  });

  it("warns instead of failing when a commit is absent from a shallow clone", () => {
    const guard = { kind: "live-scenario", ref: "SUP-01" };
    const passRun = run("2026-09-25-d", "2026-09-25", "4444444", [
      { id: "SUP-01", result: "pass" },
    ]);
    const ledger = {
      defects: [defect("DEF-0001", guard, { fixCommit: "aaaaaaa" })],
      runs: [passRun],
    };

    const shallowFix = resolveGuards(ledger, {
      runners: stubRunners({ commitPresence: () => "shallow" }),
    });
    expect(shallowFix.failed).toEqual([]);
    expect(shallowFix.unverifiable[0]).toMatchObject({ outcome: "unverifiable" });
    expect(shallowFix.unverifiable[0].detail).toMatch(/aaaaaaa is not in this shallow clone/);

    const shallowRun = resolveGuards(ledger, {
      runners: stubRunners({
        commitPresence: (sha) => (sha === "aaaaaaa" ? "present" : "shallow"),
      }),
    });
    expect(shallowRun.failed).toEqual([]);
    expect(shallowRun.unverifiable[0].detail).toBe(
      "build commit of run(s) 2026-09-25-d not in this shallow clone",
    );

    const missing = resolveGuards(ledger, {
      runners: stubRunners({ commitPresence: () => "missing" }),
    });
    expect(missing.unverifiable).toEqual([]);
    expect(missing.failed[0].detail).toBe(
      "fix commit aaaaaaa not in history (squashed/rebased?) — update fixCommit",
    );
  });

  it("only checks fixed/verified defects and skips runners for excluded kinds", () => {
    const runners = stubRunners();
    const ledger = {
      defects: [
        defect("DEF-0001", { kind: "cargo", ref: "a::b" }),
        defect("DEF-0002", { kind: "vitest", ref: "dive/src/a.test.ts::x" }, { status: "open" }),
      ],
      runs: [],
    };
    const report = resolveGuards(ledger, { kinds: ["vitest"], runners });
    expect(report.results).toEqual([
      expect.objectContaining({ id: "DEF-0001", outcome: "not-checked" }),
    ]);
    expect(report.failed).toEqual([]);
    expect(runners.listCargoTests).not.toHaveBeenCalled();
    expect(runners.listVitestTests).not.toHaveBeenCalled();
  });
});

describe("runner output parsing", () => {
  it("parses `cargo test -- --list` lines and ignores the rest", () => {
    const stdout = [
      "tools::guard::tests::a: test",
      "db::tests::slow: test",
      "bench_x: bench",
      "",
      "2 tests, 1 benchmark",
    ].join("\n");
    expect(parseCargoList(stdout)).toEqual(["tools::guard::tests::a", "db::tests::slow"]);
  });

  it("splits a vitest ref at the first ::", () => {
    expect(parseVitestRef("dive/src/a.test.ts::outer > uses a::b")).toEqual({
      file: "dive/src/a.test.ts",
      name: "outer > uses a::b",
    });
  });
});

describe("default vitest runner", () => {
  it("omits .skip and .todo tests from what it lists", { timeout: 60_000 }, () => {
    // A committed fixture, not a temp file: concurrent vitest/prettier runs
    // would otherwise race on a file that appears and vanishes in the tree.
    const probe = "dive/scripts/qa-ledger/fixtures/vitest-list-probe.test.mjs";
    expect(defaultRunners().listVitestTests([probe])).toEqual([{ file: probe, name: "runs" }]);
  });
});

// CI enforcement (D-015-08): test:unit has no Rust toolchain, so the vitest-
// side check resolves every non-cargo guard of the real ledger; cargo guards
// are resolved by `pnpm verify:qa-ledger` locally / before a release.
describe("real ledger guards", () => {
  it(
    "resolve through their runners (vitest, eval-fixture, live-scenario)",
    { timeout: 120_000 },
    () => {
      const ledger = loadLedger(DEFAULT_LEDGER_ROOT);
      expect(ledger.errors).toEqual([]);
      const report = resolveGuards(ledger, { kinds: ["vitest", "eval-fixture", "live-scenario"] });
      expect(report.failed).toEqual([]);
    },
  );
});
