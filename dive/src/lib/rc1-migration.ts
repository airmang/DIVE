export const RC1_MIGRATION_KEY = "dive:rc1_migrated";

export const RC1_REMOVED_KEYS = [
  "dive:project-session",
  "dive:current-project-id",
  "dive:current-session-id",
  "dive:onboarded",
] as const;

export const RC1_PRESERVED_KEYS = ["dive:locale", "dive.theme", "dive:theme-mode"] as const;

export interface Rc1MigrationResult {
  needed: boolean;
  removedKeys: string[];
  preservedKeys: string[];
}

export function runRc1Migration(storage: Storage | null = browserStorage()): Rc1MigrationResult {
  if (!storage) {
    return { needed: false, removedKeys: [], preservedKeys: [] };
  }
  if (storage.getItem(RC1_MIGRATION_KEY) === "true") {
    return { needed: false, removedKeys: [], preservedKeys: [] };
  }

  const removedKeys: string[] = [];
  for (const key of RC1_REMOVED_KEYS) {
    if (storage.getItem(key) !== null) {
      removedKeys.push(key);
    }
    storage.removeItem(key);
  }

  const preservedKeys = RC1_PRESERVED_KEYS.filter((key) => storage.getItem(key) !== null);
  return { needed: true, removedKeys, preservedKeys };
}

export function acknowledgeRc1Migration(storage: Storage | null = browserStorage()) {
  storage?.setItem(RC1_MIGRATION_KEY, "true");
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}
