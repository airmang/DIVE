// Minimal ambient declaration so the S-044 contrast test (contrast.test.ts) can
// read globals.css at runtime under vitest's Node environment without adding
// @types/node as a project dependency. Scoped to the one call the test uses.
// If @types/node is ever added, this can be deleted.
declare module "fs" {
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
}
