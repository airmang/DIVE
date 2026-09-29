import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CLI = fileURLToPath(new URL("./validate.mjs", import.meta.url));

const tempRoots = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runCli(...args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

function ledgerWithDefect(record) {
  const root = mkdtempSync(join(tmpdir(), "qa-ledger-cli-"));
  tempRoots.push(root);
  mkdirSync(join(root, "defects"));
  writeFileSync(join(root, "defects", `${record.id}.json`), JSON.stringify(record));
  return root;
}

const DEFECT = {
  id: "DEF-0004",
  title: "Example",
  status: "open",
  severity: "P2",
  area: "chat",
  source: { kind: "user", ref: "owner" },
  created: "2026-09-29",
  updated: "2026-09-29",
};

describe("qa:ledger:validate CLI", () => {
  it("exits 0 on the real ledger", () => {
    const result = runCli();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^qa-ledger: OK/);
  });

  it("exits 1 and lists each problem", () => {
    const result = runCli("--root", ledgerWithDefect({ ...DEFECT, status: "fixed" }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("1 problem(s)");
    expect(result.stderr).toContain(
      'defects/DEF-0004.json: $.guard: is required when status is "fixed" (FR-040)',
    );
  });

  it("prints the next free defect id", () => {
    const result = runCli("--root", ledgerWithDefect(DEFECT), "--next-id");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("DEF-0005");
  });

  it("rejects unknown arguments with exit 2", () => {
    expect(runCli("--bogus").status).toBe(2);
  });
});
