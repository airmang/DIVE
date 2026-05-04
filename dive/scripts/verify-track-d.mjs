#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function repoPath(path) {
  return resolve(repoRoot, path);
}

const checks = [
  { name: "menu.rs exists", path: "dive/src-tauri/src/menu.rs", exists: true },
  { name: "menu.rs declares build_menu", path: "dive/src-tauri/src/menu.rs", pattern: /pub fn build_menu/ },
  { name: "menu.rs declares install_event_handler", path: "dive/src-tauri/src/menu.rs", pattern: /pub fn install_event_handler/ },
  { name: "menu.rs declares rebuild_menu_with_recents", path: "dive/src-tauri/src/menu.rs", pattern: /pub fn rebuild_menu_with_recents/ },
  { name: "menu.rs has macOS app submenu", path: "dive/src-tauri/src/menu.rs", pattern: /target_os\s*=\s*"macos"/ },
  { name: "menu.rs omits clear-recent v4 action", path: "dive/src-tauri/src/menu.rs", absent: /menu:clear-recent/ },
  { name: "lib.rs declares menu module", path: "dive/src-tauri/src/lib.rs", pattern: /pub mod menu;/ },
  { name: "lib.rs calls app.set_menu", path: "dive/src-tauri/src/lib.rs", pattern: /app\.set_menu\(/ },
  { name: "lib.rs installs menu event handler", path: "dive/src-tauri/src/lib.rs", pattern: /menu::install_event_handler/ },
  { name: "lib.rs registers menu_refresh_recents", path: "dive/src-tauri/src/lib.rs", pattern: /ipc::menu_refresh_recents/ },
  { name: "capabilities has core:event:default", path: "dive/src-tauri/capabilities/default.json", pattern: /"core:event:default"/ },
  { name: "project DAO has list_recent", path: "dive/src-tauri/src/db/dao/project.rs", pattern: /pub fn list_recent/ },
  { name: "project DAO has touch", path: "dive/src-tauri/src/db/dao/project.rs", pattern: /pub fn touch/ },
  { name: "project IPC exposes fetch_recent_projects_for_menu", path: "dive/src-tauri/src/ipc/project.rs", pattern: /pub fn fetch_recent_projects_for_menu/ },
  { name: "project IPC exposes menu_refresh_recents", path: "dive/src-tauri/src/ipc/project.rs", pattern: /pub fn menu_refresh_recents/ },
  { name: "menu-events.ts exists", path: "dive/src/lib/menu-events.ts", exists: true },
  { name: "menu-events exports useMenuEvents", path: "dive/src/lib/menu-events.ts", pattern: /export function useMenuEvents/ },
  { name: "menu-events exports refreshMenuRecents", path: "dive/src/lib/menu-events.ts", pattern: /export async function refreshMenuRecents/ },
  { name: "MainShell subscribes to menu events", path: "dive/src/components/shell/MainShell.tsx", pattern: /useMenuEvents\(/ },
  { name: "MainShell handles open project", path: "dive/src/components/shell/MainShell.tsx", pattern: /handleOpenProject/ },
  { name: "project-session exposes openProject", path: "dive/src/stores/project-session.ts", pattern: /openProject:/ },
  { name: "project-session refreshes native recents", path: "dive/src/stores/project-session.ts", pattern: /refreshMenuRecents\(\)/ },
  { name: "package has Track D verifier", path: "dive/package.json", pattern: /"verify:v4:track-d"/ },
];

let failed = 0;
for (const check of checks) {
  if (!existsSync(repoPath(check.path))) {
    console.error(`[FAIL] ${check.name}: file missing (${check.path})`);
    failed++;
    continue;
  }
  const content = readFileSync(repoPath(check.path), "utf8");
  if (check.exists && !check.pattern && !check.absent) {
    console.log(`[OK] ${check.name}`);
    continue;
  }
  if (check.pattern && !check.pattern.test(content)) {
    console.error(`[FAIL] ${check.name}`);
    failed++;
    continue;
  }
  if (check.absent && check.absent.test(content)) {
    console.error(`[FAIL] ${check.name}`);
    failed++;
    continue;
  }
  console.log(`[OK] ${check.name}`);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\n[OK] Track D 검증 통과");
