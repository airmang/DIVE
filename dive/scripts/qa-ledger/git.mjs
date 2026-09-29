// Small git helpers shared by the QA-ledger tools (guards, run records, queue).
// All read-only. Paths come back repo-relative with `core.quotePath=false`, so
// non-ASCII file names (e.g. Korean docs) are not C-quoted.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function git(args) {
  return spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
}

function gitOrThrow(args) {
  const result = git(args);
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? result.stderr.trim();
    throw new Error(`git ${args.join(" ")} failed: ${reason}`);
  }
  return result.stdout;
}

/** True iff `ancestor` is an ancestor of (or equal to) `descendant`. Unknown commits → false. */
export function isAncestor(ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  return git(["merge-base", "--is-ancestor", ancestor, descendant]).status === 0;
}

/**
 * Whether a commit is in the local object store: "present", "shallow" (absent,
 * but this is a shallow clone, e.g. CI's depth-1 checkout — so absence proves
 * nothing) or "missing" (absent from full history: squashed or rebased away).
 */
export function commitPresence(sha) {
  if (sha && git(["cat-file", "-e", `${sha}^{commit}`]).status === 0) return "present";
  const shallow = git(["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
  return shallow ? "shallow" : "missing";
}

export function headCommit() {
  return gitOrThrow(["rev-parse", "--short=12", "HEAD"]).trim();
}

/** Uncommitted changes to tracked files (a build from this tree is not exactly HEAD). */
export function isDirty() {
  return gitOrThrow(["status", "--porcelain", "--untracked-files=no"]).trim() !== "";
}

/**
 * Files changed between `ref` and HEAD (committed history only), as
 * `{ path, deleted }`. Renames are split into a delete and an add so both
 * paths are classified.
 */
export function changedFilesSince(ref) {
  return gitOrThrow(["diff", "--name-status", "--no-renames", `${ref}`, "HEAD"])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      return { path, deleted: status === "D" };
    });
}
