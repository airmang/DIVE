// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  RC1_MIGRATION_KEY,
  RC1_PRESERVED_KEYS,
  RC1_REMOVED_KEYS,
  runRc1Migration,
} from "./rc1-migration";

describe("runRc1Migration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("silently removes rc1 project/session keys and sets the migrated flag immediately", () => {
    for (const key of RC1_REMOVED_KEYS) {
      window.localStorage.setItem(key, `rc1-${key}`);
    }
    window.localStorage.setItem(RC1_PRESERVED_KEYS[0], "ko");
    window.localStorage.setItem(RC1_PRESERVED_KEYS[1], "light");

    const result = runRc1Migration(window.localStorage);

    expect(result).toEqual({
      needed: false,
      removedKeys: [...RC1_REMOVED_KEYS],
      preservedKeys: [RC1_PRESERVED_KEYS[0], RC1_PRESERVED_KEYS[1]],
    });
    for (const key of RC1_REMOVED_KEYS) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
    expect(window.localStorage.getItem(RC1_PRESERVED_KEYS[0])).toBe("ko");
    expect(window.localStorage.getItem(RC1_PRESERVED_KEYS[1])).toBe("light");
    expect(window.localStorage.getItem(RC1_MIGRATION_KEY)).toBe("true");
  });

  it("does not request a dialog after the silent migration has already run", () => {
    window.localStorage.setItem(RC1_MIGRATION_KEY, "true");

    expect(runRc1Migration(window.localStorage)).toEqual({
      needed: false,
      removedKeys: [],
      preservedKeys: [],
    });
  });
});
