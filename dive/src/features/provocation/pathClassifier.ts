import type { ChangedFileCategory } from "./types";

// S-064 E7: the single source of truth for classifying a changed-file path into
// a review category. Every token below is anchored to a path-segment or
// filename boundary (`(^|/)` … `([/._-]|$)`) rather than matched as a bare
// substring. The previous live-path classifier used unbounded alternations, so
// "AuthorCard.tsx" fell into `auth`, any path containing "config" fell into
// `config`, and "packages/…" fell into `routing` — producing high-risk review
// cards with no real basis. The rules-engine classifier already used bounded
// patterns; both now share this module so there is only one behaviour.

const SECRET_PATTERNS = [/\.(pem|key)$/i, /(^|\/)(id_rsa|credentials|\.npmrc|\.netrc)($|[./_-])/i];

const CI_PATTERNS = [
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)(\.gitlab-ci(\.ya?ml)?|dockerfile|makefile)$/i,
];

const DEPENDENCY_PATTERNS = [
  /(^|\/)package\.json$/i,
  /(^|\/)(pnpm-lock\.ya?ml|package-lock\.json|yarn\.lock|cargo\.lock|poetry\.lock|gemfile\.lock|go\.sum|requirements\.txt)$/i,
];

const CONFIG_PATTERNS = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)[\w.-]+\.config\.[cm]?[jt]s$/i,
  /(^|\/)(vite|vitest|webpack|rollup|eslint|tailwind|postcss|babel|jest)\.[cm]?[jt]s$/i,
  /(^|\/)tsconfig([.\w-]*)?\.json$/i,
];

const AUTH_PATTERNS = [
  /(^|\/)(auth|oauth|permission|permissions|policy|policies|security)([/._-]|$)/i,
];

const DB_PATTERNS = [/(^|\/)(schema|migration|migrations|db|database)([/._-]|$)/i];

const ROUTING_PATTERNS = [/(^|\/)(route|routes|router|routing|page|pages)([/._-]|$)/i];

// Evaluated in order: the first bounded category that matches wins, then the
// generic file-extension fallbacks.
const CATEGORY_PATTERNS: ReadonlyArray<readonly [ChangedFileCategory, readonly RegExp[]]> = [
  ["secret", SECRET_PATTERNS],
  ["ci", CI_PATTERNS],
  ["dependency", DEPENDENCY_PATTERNS],
  ["config", CONFIG_PATTERNS],
  ["auth", AUTH_PATTERNS],
  ["db", DB_PATTERNS],
  ["routing", ROUTING_PATTERNS],
];

const HIGH_RISK_CATEGORIES: ReadonlySet<ChangedFileCategory> = new Set<ChangedFileCategory>([
  "auth",
  "config",
  "db",
  "dependency",
  "routing",
  "ci",
  "secret",
]);

export function classifyChangedFilePath(path: string): ChangedFileCategory {
  for (const [category, patterns] of CATEGORY_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(path))) return category;
  }
  const lower = path.toLowerCase();
  if (/(\.test\.|\.spec\.)/.test(lower)) return "test";
  if (/\.(css|scss|tsx|jsx)$/.test(lower)) return "ui";
  if (/\.(ts|js|rs)$/.test(lower)) return "logic";
  return "unknown";
}

export function isHighRiskCategory(category: ChangedFileCategory): boolean {
  return HIGH_RISK_CATEGORIES.has(category);
}
