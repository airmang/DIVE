import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pnpmRoot = resolve(here, "..", "node_modules", ".pnpm");

const entries = readdirSync(pnpmRoot).filter((d) => d.startsWith("playwright@"));
if (entries.length === 0) throw new Error("playwright not found in node_modules/.pnpm");
const pwPath = resolve(pnpmRoot, entries[0], "node_modules", "playwright");

const playwright = require(pwPath);

export const { chromium, firefox, webkit } = playwright;
