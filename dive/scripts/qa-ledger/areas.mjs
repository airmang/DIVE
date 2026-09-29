// QA ledger area table (spec 015, S-077 / FR-011).
//
// Scenarios and defects name product areas; each area maps to path globs
// relative to the repository root, so tooling can ask "which scenarios does
// this diff touch?" (S-082 qa:queue) with plain `git diff --name-only` output.
// Areas overlap on purpose — a file can belong to several areas.
//
// Glob syntax is deliberately small: `**` (a whole segment) matches any number
// of path segments, `*` matches within one segment. A vitest test asserts every glob
// here matches at least one tracked file, so a rename that orphans an area
// fails CI instead of silently shrinking the rerun set.

export const CROSS_CUTTING_AREA = "app-core";

export const AREAS = Object.freeze({
  onboarding: [
    "dive/src/components/onboarding/**",
    "dive/src/components/product/GetStartedChecklist.tsx",
    "dive/src/components/rc1/**",
    "dive/src/lib/rc1-migration.ts",
    "dive/src/lib/tauri-dialog.ts",
    "dive/src/pages/user-guide.tsx",
  ],
  "project-session": [
    "dive/src/stores/project-session.ts",
    "dive/src/components/product/ProjectRail.tsx",
    "dive/src/components/shell/Sidebar.tsx",
    "dive/src-tauri/src/ipc/project.rs",
    "dive/src-tauri/src/ipc/session.rs",
    "dive/src-tauri/src/db/dao/project.rs",
    "dive/src-tauri/src/db/dao/session.rs",
  ],
  "provider-settings": [
    "dive/src/pages/settings.tsx",
    "dive/src/components/settings/**",
    "dive/src/components/codex/**",
    "dive/src/components/product/ProviderSetupBanner.tsx",
    "dive/src/components/shell/RuntimeBadge.tsx",
    "dive/src/components/chat/RuntimeModelSelector.tsx",
    "dive/src/lib/provider-format.ts",
    "dive/src-tauri/src/ipc/provider.rs",
    "dive/src-tauri/src/ipc/provider_runtime.rs",
    "dive/src-tauri/src/ipc/codex_oauth.rs",
    "dive/src-tauri/src/auth/**",
    "dive/src-tauri/src/providers/**",
    "dive/src-tauri/src/db/dao/provider_config.rs",
  ],
  "pi-sidecar": [
    "dive/pi-sidecar/src/**",
    "dive/pi-sidecar/build-sidecar.mjs",
    "dive/pi-sidecar/package.json",
    "dive/pi-sidecar/package-lock.json",
    "dive/src-tauri/src/pi_sidecar.rs",
    "dive/src-tauri/src/pi_sidecar/**",
  ],
  i18n: [
    "dive/src/i18n/**",
    "dive/src/lib/document-lang.ts",
    "dive/src-tauri/src/dive/prompt_locale.rs",
  ],
  "theme-ui": [
    "dive/src/hooks/useTheme.ts",
    "dive/src/stores/theme.ts",
    "dive/src/styles/**",
    "dive/src/components/ui/**",
    "dive/src/assets/fonts/*.woff2",
    "dive/src/lib/utils.ts",
    "dive/tailwind.config.ts",
    "dive/postcss.config.js",
    "dive/public/**",
    "dive/src-tauri/icons/**",
  ],
  "shell-layout": [
    "dive/src/App.tsx",
    "dive/src/components/shell/**",
    "dive/src/components/product/ProductShellLayout.tsx",
    "dive/src/components/product/TopBar.tsx",
    "dive/src/components/product/ActionDock.tsx",
    "dive/src/components/product/useReviewSidebarWidth.ts",
    "dive/src/components/product/useShellMenus.ts",
    "dive/src/components/toast/**",
    "dive/src/stores/ui-preferences.ts",
    "dive/src/hooks/useGlobalShortcuts.ts",
    "dive/src-tauri/src/menu.rs",
    "dive/src/components/product/ProductModalHost.tsx",
    "dive/src/components/product/productShellControllerLogic.ts",
    "dive/src/components/product/useProductShellController.ts",
    "dive/src/components/product/useProductShellDialogs.ts",
    "dive/src/lib/menu-events.ts",
    "dive/src/lib/runUserAction.ts",
  ],
  chat: [
    "dive/src/components/chat/**",
    "dive/src/hooks/useChatSession.ts",
    "dive/src/hooks/chat-session-reducer.ts",
    "dive/src/hooks/agent-events.ts",
    "dive/src/stores/chatComposer.ts",
    "dive/src/lib/composerKeys.ts",
    "dive/src/lib/error-classify.ts",
    "dive/src/components/product/ConversationPanel.tsx",
    "dive/src/components/product/ConversationSurfaces.tsx",
    "dive/src/components/product/productShellConversationLogic.ts",
    "dive/src/components/product/useProductConversationModel.ts",
    "dive/src-tauri/src/ipc/chat.rs",
    "dive/src-tauri/src/agent/**",
    "dive/src-tauri/src/db/dao/message.rs",
  ],
  "prompt-helper": [
    "dive/src/components/prompt-helper/**",
    "dive/src/lib/ambiguity.ts",
    "dive/src/lib/prompt-templates.ts",
    "dive/src-tauri/src/dive/prompt_check.rs",
    "dive/src-tauri/src/dive/assist.rs",
    "dive/src-tauri/src/ipc/assist.rs",
  ],
  permission: [
    "dive/src/components/permission-card/**",
    "dive/src-tauri/src/agent/permission.rs",
    "dive/src-tauri/src/ipc/policy.rs",
    "dive/src-tauri/src/dive/approval.rs",
    "dive/src-tauri/src/tools/guard.rs",
    "dive/src-tauri/src/tools/fs_guard.rs",
    "dive/src-tauri/src/db/dao/tool_call.rs",
  ],
  "agent-tools": ["dive/src-tauri/src/tools/**"],
  "web-egress": [
    "dive/src-tauri/src/tools/web_fetch.rs",
    "dive/src-tauri/src/tools/egress_guard.rs",
    "dive/src-tauri/src/http_client.rs",
  ],
  mcp: ["dive/src/components/mcp/**", "dive/src-tauri/src/mcp/**", "dive/src-tauri/src/ipc/mcp.rs"],
  prd: [
    "dive/src/components/product/PrdAuthoringBoard.tsx",
    "dive/src/components/product/FinalPrdReadView.tsx",
    "dive/src/components/product/SocraticInterviewPanel.tsx",
    "dive/src/components/product/QuickIntakePanel.tsx",
    "dive/src/features/planning/**",
    "dive/src/components/chat/filterInterviewNoise.ts",
    "dive/src-tauri/src/ipc/workspace_plan/prd_*.rs",
    "dive/src-tauri/src/dive/plan_interview.rs",
    "dive/src-tauri/src/db/dao/prd.rs",
    "dive/src-tauri/src/db/dao/interview*.rs",
    "dive/src-tauri/src/ipc/workspace_plan/commands.rs",
    "dive/src-tauri/src/ipc/workspace_plan/mod.rs",
    "dive/src-tauri/src/ipc/workspace_plan/types.rs",
  ],
  plan: [
    "dive/src/components/plan/**",
    "dive/src/components/product/PlanDraft*.tsx",
    "dive/src/components/product/PlanAddStepPanel.tsx",
    "dive/src/components/product/PlanDashboardPanel.tsx",
    "dive/src/components/product/PlanReplaceConfirmModal.tsx",
    "dive/src/components/product/PlanRouteConfirmModal.tsx",
    "dive/src/components/product/usePlanChatRouting.ts",
    "dive/src/components/product/usePlanDraftLifecycle.ts",
    "dive/src/features/planning/usePlan.ts",
    "dive/src/features/planning/usePlanRouter.ts",
    "dive/src-tauri/src/ipc/workspace_plan/plan_*.rs",
    "dive/src-tauri/src/ipc/workspace_plan/quality_gate.rs",
    "dive/src-tauri/src/dive/plan_router.rs",
    "dive/src-tauri/src/dive/plan_quality_constants.rs",
    "dive/src-tauri/src/db/dao/plan*.rs",
    "dive/src-tauri/src/workspace_plan/**",
    "dive/src-tauri/src/ipc/workspace_plan/commands.rs",
    "dive/src-tauri/src/ipc/workspace_plan/mod.rs",
    "dive/src-tauri/src/ipc/workspace_plan/types.rs",
  ],
  roadmap: [
    "dive/src/features/roadmap/**",
    "dive/src/components/product/RoadmapPanel.tsx",
    "dive/src/components/product/RoadmapRail.tsx",
    "dive/src/components/product/StepDetailSlideIn.tsx",
    "dive/src/components/product/StepDetailSections.tsx",
    "dive/src/components/product/productShellPlanStepLogic.ts",
    "dive/src/components/product/useProductPlanStepRuntime.ts",
    "dive/src-tauri/src/ipc/workspace_plan/roadmap.rs",
    "dive/src-tauri/src/ipc/workspace_plan/dashboard.rs",
    "dive/src-tauri/src/dive/state_machine.rs",
    "dive/src-tauri/src/db/dao/step*.rs",
  ],
  supervision: [
    "dive/src/features/provocation/**",
    "dive/src/components/product/stepDetailSupervisorRequests.ts",
    "dive/src-tauri/src/dive/supervisor/**",
    "dive/src-tauri/src/dive/prompt_version.rs",
    "dive/src-tauri/src/dive/supervision_policy.rs",
    "dive/src-tauri/src/dive/card_metrics.rs",
    "dive/src-tauri/src/ipc/provocation*.rs",
    "dive/src-tauri/src/ipc/cards.rs",
    "dive/src-tauri/src/db/dao/card.rs",
  ],
  verification: [
    "dive/src/components/product/VerificationReviewStepper.tsx",
    "dive/src/components/product/VerificationCoachPanel.tsx",
    "dive/src/components/product/DecisionGate.tsx",
    "dive/src/components/product/decisionGatePolicy.ts",
    "dive/src/components/product/stepDetailEvidence.ts",
    "dive/src/features/verification-coach/**",
    "dive/src/features/provocation/verification*.ts",
    "dive/src-tauri/src/dive/verification_coach.rs",
    "dive/src-tauri/src/dive/verify.rs",
    "dive/src-tauri/src/ipc/verification_coach.rs",
  ],
  recovery: [
    "dive/src/components/product/Recovery*.tsx",
    "dive/src/components/product/productShellRecoveryLogic.ts",
    "dive/src/components/product/useProductRecovery.ts",
    "dive/src/components/slide-in/CheckpointTimeline.tsx",
    "dive/src/components/slide-in/RestoreConfirmDialog.tsx",
    "dive/src-tauri/src/checkpoint/**",
    "dive/src-tauri/src/ipc/checkpoint.rs",
    "dive/src-tauri/src/db/dao/checkpoint.rs",
  ],
  "slide-in": ["dive/src/components/slide-in/**", "dive/src/stores/slideIn.ts"],
  preview: [
    "dive/src/components/slide-in/Preview*.tsx",
    "dive/src/components/slide-in/previewModeHint.ts",
    "dive/src-tauri/src/ipc/preview.rs",
  ],
  terminal: [
    "dive/src/components/slide-in/TerminalTab.tsx",
    "dive/src/lib/test-command-help.ts",
    "dive/src-tauri/src/tools/run_process.rs",
    "dive/src-tauri/src/tools/process_exec.rs",
    "dive/src-tauri/src/tools/terminal_script.rs",
  ],
  workmap: [
    "dive/src/components/workmap/**",
    "dive/src/hooks/useWorkmap.ts",
    "dive/src/stores/workmap.ts",
    "dive/src-tauri/src/ipc/workmap.rs",
    "dive/src-tauri/src/db/dao/workmap.rs",
  ],
  "eventlog-export": [
    "dive/src-tauri/src/export/**",
    "dive/src-tauri/src/dive/event_log.rs",
    "dive/src-tauri/src/ipc/events.rs",
    "dive/src-tauri/src/ipc/ui_events.rs",
    "dive/src-tauri/src/ipc/timeline.rs",
    "dive/src-tauri/src/db/dao/event_log.rs",
    "dive/src-tauri/src/telemetry.rs",
    "dive/src/features/provocation/logging.ts",
    "dive/src/pages/research-survey.tsx",
  ],
  persistence: ["dive/src-tauri/src/db/**"],
  "build-release": [
    "dive/package.json",
    "dive/scripts/**",
    "dive/src-tauri/Cargo.toml",
    "dive/src-tauri/tauri.conf.json",
    ".github/workflows/**",
  ],
  "docs-spec": ["docs/**", "specs/**", ".specify/**", "README.md", "AGENTS.md"],
  // Cross-cutting: app entry points, IPC registration/state, the IPC bridge,
  // lockfiles, Cargo.toml and build config (dive/package.json is NON_PRODUCT). No scenario lists it; qa:queue
  // treats a change here as touching every scenario.
  [CROSS_CUTTING_AREA]: [
    "dive/src/main.tsx",
    "dive/src/lib/tauri.ts",
    "dive/src-tauri/src/lib.rs",
    "dive/src-tauri/src/main.rs",
    "dive/src-tauri/src/ipc/mod.rs",
    "dive/src-tauri/src/ipc/state.rs",
    "dive/src-tauri/src/dive/mod.rs",
    "dive/pnpm-lock.yaml",
    "dive/index.html",
    "dive/vite.config.ts",
    "dive/tsconfig.json",
    "dive/src-tauri/Cargo.toml",
    "dive/src-tauri/Cargo.lock",
    "dive/src-tauri/build.rs",
    "dive/src-tauri/tauri.conf.json",
    "dive/src-tauri/capabilities/**",
  ],
});

// Tracked source files that are deliberately in no area: changing them cannot
// change what a release .app does, so they never trigger a live re-run and
// qa:queue drops them from a diff before matching. A test asserts every
// tracked file is in an area or here, so an unmapped change (which makes
// qa:queue select everything and warn) only happens for genuinely new paths.
// The docs-spec / build-release areas exist for defect classification; their
// files are non-product here and never trigger a live re-run.
export const NON_PRODUCT = Object.freeze([
  { glob: "dive/src/**/*.test.ts", reason: "unit test" },
  { glob: "dive/src/**/*.test.tsx", reason: "unit test" },
  { glob: "dive/src-tauri/src/**/tests.rs", reason: "#[cfg(test)] test module" },
  { glob: "dive/src/vite-env.d.ts", reason: "type declarations only" },
  { glob: "dive/src/assets/fonts/LICENSE-*.txt", reason: "font licence text" },
  { glob: "dive/src/pages/*-demo.tsx", reason: "dev-only demo route (import.meta.env.DEV)" },
  { glob: "dive/src/pages/showcase.tsx", reason: "dev-only demo route" },
  { glob: "dive/src/pages/phase5-integration.tsx", reason: "dev-only demo route" },
  { glob: "dive/src/pages/settings-mcp-dev.tsx", reason: "dev-only settings section (DEV)" },
  { glob: "dive/src/components/demo/**", reason: "dev-only demo shell" },
  { glob: "dive/src/lib/dev-demo.ts", reason: "dev-only demo routing" },
  { glob: "dive/src/lib/demo-routes.ts", reason: "dev-only demo routing" },
  { glob: "dive/src/hooks/useMockChatStream.ts", reason: "only used by the chat demo page" },
  { glob: "dive/src-tauri/tests/**", reason: "cargo integration tests" },
  { glob: "dive/pi-sidecar/*.test.mjs", reason: "sidecar build test" },
  { glob: "dive/scripts/**", reason: "dev/CI tooling, not bundled" },
  { glob: "dive/src-tauri/scripts/**", reason: "CI tooling, not bundled" },
  { glob: "dive/eval/**", reason: "offline eval fixtures (S-079)" },
  { glob: "dive/vitest.config.ts", reason: "test runner config" },
  { glob: "dive/tsconfig.node.json", reason: "typechecks build config only" },
  { glob: "dive/eslint.config.js", reason: "lint config" },
  { glob: "dive/.prettier*", reason: "format config" },
  { glob: "dive/.editorconfig", reason: "editor config" },
  { glob: "dive/src-tauri/rustfmt.toml", reason: "format config" },
  { glob: "dive/.vscode/**", reason: "editor config" },
  { glob: "**/.gitignore", reason: "git config" },
  { glob: ".gitattributes", reason: "git config" },
  { glob: ".github/**", reason: "CI workflows (build pipeline, not app behavior)" },
  { glob: ".agents/**", reason: "agent skills" },
  { glob: "docs/**", reason: "documentation" },
  { glob: "specs/**", reason: "spec-kit specs" },
  { glob: ".specify/**", reason: "spec-kit config" },
  { glob: "*.md", reason: "repo-level documentation" },
  { glob: "dive/README.md", reason: "documentation" },
  { glob: "LICENSE", reason: "licence text" },
  {
    glob: "dive/package.json",
    reason:
      "script-only edits are not product changes; a dependency bump also changes " +
      "pnpm-lock.yaml, which stays cross-cutting (Cargo.toml stays there too: feature " +
      "flags can change without Cargo.lock changing)",
  },
]);

export function isNonProduct(path) {
  return NON_PRODUCT.some(({ glob }) => matchesGlob(path, glob));
}

export const AREA_NAMES = Object.freeze(Object.keys(AREAS));

const regexCache = new Map();

// Why a glob is not valid ledger syntax, or null. `**` must be a whole path
// segment: `dive/src/**` and `dive/**/x.ts` are fine, `dive/src**` and
// `dive/**.ts` are ambiguous and rejected.
export function globError(glob) {
  if (glob.split("/").some((segment) => segment.includes("**") && segment !== "**")) {
    return "`**` must be a whole path segment";
  }
  return null;
}

/** Compile a ledger glob (`**`, `*` only) into an anchored RegExp. */
export function globToRegExp(glob) {
  let cached = regexCache.get(glob);
  if (cached) return cached;
  const error = globError(glob);
  if (error) throw new Error(`invalid glob "${glob}": ${error}`);
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      // `**/` matches zero or more whole segments; a trailing `**` matches the rest.
      if (glob[i + 2] === "/") {
        source += "(?:[^/]+/)*";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (ch === "*") {
      source += "[^/]*";
    } else {
      source += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  cached = new RegExp(`^${source}$`);
  regexCache.set(glob, cached);
  return cached;
}

export function matchesGlob(path, glob) {
  return globToRegExp(glob).test(path);
}

/** Effective globs for a scenario: its areas' globs plus any extra `pathGlobs`. */
export function scenarioGlobs(scenario) {
  const globs = new Set(scenario.pathGlobs ?? []);
  for (const area of scenario.areas ?? []) {
    for (const glob of AREAS[area] ?? []) globs.add(glob);
  }
  return [...globs];
}
