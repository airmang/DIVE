// Fixture for guards.test.mjs ("default vitest runner"): `vitest list` must
// report only the runnable test below, never the .skip / .todo ones. It runs
// (and skips) as part of `pnpm test:unit` like any other test file.
import { it } from "vitest";

it("runs", () => {});
it.skip("skipped", () => {});
it.todo("todo");
