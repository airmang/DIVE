#!/usr/bin/env node
// `pnpm qa:ledger:validate` — schema + reference check over docs/qa/ledger/
// (spec 015, S-077). Exits 1 and prints one line per problem when anything is
// invalid. Guard *resolution* through the test runners is S-080's
// `verify:qa-ledger`; this command only checks the records themselves.
//
// Usage: node scripts/qa-ledger/validate.mjs [--root <ledger dir>] [--next-id]
//   --next-id  print the next free DEF-NNNN id (after validating) and exit

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_LEDGER_ROOT, loadLedger, nextDefectId } from "./load.mjs";

function parseArgs(argv) {
  const args = { root: DEFAULT_LEDGER_ROOT, nextId: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      // `pnpm qa:ledger:validate -- --next-id` forwards the separator itself.
      continue;
    } else if (arg === "--root") {
      const value = argv[(i += 1)];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--root needs a directory argument");
      }
      args.root = resolve(value);
    } else if (arg === "--next-id") {
      args.nextId = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`qa-ledger: ${error.message}`);
    return 2;
  }
  if (args.help) {
    console.log("Usage: pnpm qa:ledger:validate [-- --root <ledger dir>] [-- --next-id]");
    return 0;
  }

  const ledger = loadLedger(args.root);
  if (ledger.errors.length > 0) {
    console.error(`qa-ledger: ${ledger.errors.length} problem(s) in ${args.root}`);
    for (const error of ledger.errors) console.error(`  ${error}`);
    return 1;
  }
  if (args.nextId) {
    console.log(nextDefectId(ledger));
    return 0;
  }
  console.log(
    `qa-ledger: OK — ${ledger.defects.length} defect(s), ${ledger.scenarios.length} scenario(s), ` +
      `${ledger.runs.length} run(s)`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
