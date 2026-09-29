#!/usr/bin/env node
// `pnpm verify:qa-ledger` — validate the ledger, then resolve the guard of
// every fixed/verified defect through its runner (spec 015, S-080 / FR-040).
// Exits 1 if the ledger is invalid or any checked guard is unresolved or
// ignored.
//
// Usage: node scripts/qa-ledger/verify.mjs [--kinds vitest,cargo,...] [--root <ledger dir>]
//                                          [--cargo-dir <dive/src-tauri of another checkout>]
//   --kinds  restrict resolution to these guard kinds (default: all). Guards of
//            other kinds are reported as "not checked", not as failures.
//            CI (verify:v4) passes `vitest,eval-fixture,live-scenario` because
//            its frontend job has no Rust toolchain; run the full check
//            locally / before a release to cover cargo guards (D-015-08).

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultRunners, resolveGuards } from "./guards.mjs";
import { DEFAULT_LEDGER_ROOT, loadLedger } from "./load.mjs";
import { GUARD_KINDS } from "./schema.mjs";

export function parseVerifyArgs(argv) {
  const args = { root: DEFAULT_LEDGER_ROOT, kinds: [...GUARD_KINDS] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[(i += 1)];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--") {
      continue;
    } else if (arg === "--root") {
      args.root = resolve(value());
    } else if (arg === "--cargo-dir") {
      args.cargoDir = resolve(value());
    } else if (arg === "--kinds") {
      args.kinds = value()
        .split(",")
        .map((kind) => kind.trim())
        .filter(Boolean);
      const unknown = args.kinds.filter((kind) => !GUARD_KINDS.includes(kind));
      if (unknown.length > 0 || args.kinds.length === 0) {
        throw new Error(`--kinds takes a comma list of ${GUARD_KINDS.join(", ")}`);
      }
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return args;
}

/** Per-kind summary lines plus one line per failure. */
export function formatReport({ results, failed }) {
  const lines = [];
  for (const kind of GUARD_KINDS) {
    const ofKind = results.filter((result) => result.kind === kind);
    if (ofKind.length === 0) continue;
    const count = (outcome) => ofKind.filter((result) => result.outcome === outcome).length;
    if (count("not-checked") === ofKind.length) {
      lines.push(`  ${kind}: ${ofKind.length} not checked (excluded by --kinds)`);
      continue;
    }
    lines.push(
      `  ${kind}: ${count("resolved")} resolved, ${count("unresolved")} unresolved, ` +
        `${count("ignored")} ignored`,
    );
  }
  for (const result of failed) {
    lines.push(`  FAIL ${result.id} [${result.kind}] ${result.ref} — ${result.detail}`);
  }
  return lines;
}

function main() {
  let args;
  try {
    args = parseVerifyArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`verify:qa-ledger: ${error.message}`);
    return 2;
  }
  const ledger = loadLedger(args.root);
  if (ledger.errors.length > 0) {
    console.error(`verify:qa-ledger: ${ledger.errors.length} schema problem(s)`);
    for (const error of ledger.errors) console.error(`  ${error}`);
    return 1;
  }
  let report;
  try {
    const runners = defaultRunners({ cargoDir: args.cargoDir });
    report = resolveGuards(ledger, { kinds: args.kinds, runners });
  } catch (error) {
    console.error(`verify:qa-ledger: a guard runner failed — ${error.message}`);
    return 1;
  }
  const out = report.failed.length > 0 ? console.error : console.log;
  out(
    `verify:qa-ledger: ${report.failed.length === 0 ? "OK" : "FAILED"} — ` +
      `${report.results.length} guarded defect(s), kinds: ${args.kinds.join(",")}`,
  );
  for (const line of formatReport(report)) out(line);
  return report.failed.length > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
