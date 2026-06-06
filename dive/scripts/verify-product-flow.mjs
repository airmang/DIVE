#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const diveRoot = resolve(__dirname, "..");
const repoRoot = resolve(diveRoot, "..");
const checks = [];

function filePath(rel, root = repoRoot) {
  return resolve(root, rel);
}

function read(rel, root = repoRoot) {
  return readFileSync(filePath(rel, root), "utf8");
}

function exists(rel, root = repoRoot) {
  return existsSync(filePath(rel, root));
}

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

function includesAll(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

const lib = read("dive/src-tauri/src/lib.rs");
const projectSession = read("dive/src/stores/project-session.ts");
const controller = read("dive/src/components/product/useProductShellController.ts");
const productLayout = read("dive/src/components/product/ProductShellLayout.tsx");
const chatSession = read("dive/src/hooks/useChatSession.ts");
const workmap = read("dive/src/hooks/useWorkmap.ts");
const usePlan = read("dive/src/features/planning/usePlan.ts");
const usePlanRouter = read("dive/src/features/planning/usePlanRouter.ts");
const planInterviewLlm = read("dive/src/features/planning/usePlanInterviewLLM.ts");
const usePlanRoadmap = read("dive/src/features/roadmap/usePlanRoadmap.ts");
const sidebar = read("dive/src/components/shell/Sidebar.tsx");
const projectRail = read("dive/src/components/product/ProjectRail.tsx");
const onboarding = read("dive/src/components/onboarding/OnboardingDialog.tsx");
const providerBanner = read("dive/src/components/product/ProviderSetupBanner.tsx");
const providerIpc = read("dive/src-tauri/src/ipc/provider.rs");
const chatArea = read("dive/src/components/shell/ChatArea.tsx");
const messageList = read("dive/src/components/chat/MessageList.tsx");
const toolCallMessage = read("dive/src/components/chat/ToolCallMessage.tsx");
const permissionCard = read("dive/src/components/permission-card/PermissionCard.tsx");
const safeCard = read("dive/src/components/permission-card/SafeCard.tsx");
const warnCard = read("dive/src/components/permission-card/WarnCard.tsx");
const dangerCard = read("dive/src/components/permission-card/DangerCard.tsx");
const patchPreview = read("dive/src/components/permission-card/PatchPreviewPanel.tsx");
const planApproval = read("dive/src/components/product/PlanDraftApprovalScreen.tsx");
const planRecovery = read("dive/src/components/product/PlanDraftRecoveryScreen.tsx");
const socraticPanel = read("dive/src/components/product/SocraticInterviewPanel.tsx");
const roadmapRail = read("dive/src/components/product/RoadmapRail.tsx");
const stepDetail = read("dive/src/components/product/StepDetailSlideIn.tsx");
const slideInStore = read("dive/src/stores/slideIn.ts");
const slideInPanel = read("dive/src/components/slide-in/SlideInPanel.tsx");
const codeTab = read("dive/src/components/slide-in/CodeTab.tsx");
const previewTab = read("dive/src/components/slide-in/PreviewTab.tsx");
const recoveryPanel = read("dive/src/components/product/RecoveryPanel.tsx");
const recoverySlideIn = read("dive/src/components/product/RecoverySlideIn.tsx");
const releaseSmoke = read("dive/scripts/release-gate-smoke.mjs");
const ablationDoc = read("docs/research-ablation.md");
const ablationDocLower = ablationDoc.toLowerCase();
const stagePlanDoc = read("docs/research/conference-poster/04-Wily-Stage-실행계획.md");
const evidenceTemplatePath =
  "docs/research/conference-poster/evidence/connected-provider-smoke-template.md";
const evidenceTemplate = exists(evidenceTemplatePath) ? read(evidenceTemplatePath) : "";

const registeredCommands = [
  "ipc::project_create",
  "ipc::project_open",
  "ipc::project_select",
  "ipc::session_create",
  "ipc::session_list",
  "ipc::provider_connect",
  "ipc::provider_list",
  "ipc::chat_send",
  "ipc::tool_approve",
  "ipc::tool_deny",
  "ipc::card_verify",
  "ipc::checkpoint_create",
  "ipc::checkpoint_list",
  "ipc::checkpoint_restore",
  "ipc::workspace_plan_status",
  "ipc::workspace_plan_start_interview",
  "ipc::workspace_plan_save_interview_answer",
  "ipc::workspace_plan_submit_interview",
  "ipc::workspace_plan_generate_draft",
  "ipc::workspace_plan_approve",
  "ipc::workspace_plan_discard_plan",
  "ipc::workspace_plan_list_steps",
  "ipc::workspace_plan_step_mappings",
  "ipc::workspace_plan_route_chat",
  "ipc::workspace_plan_append_step",
  "ipc::roadmap_step_open",
  "ipc::roadmap_step_update_state",
];

check("Tauri registers product-flow IPC commands", includesAll(lib, registeredCommands));
check("Tauri startup uses disk-backed AppState", lib.includes("AppState::from_app_handle"));

check(
  "project/session store creates, opens, selects, and persists workspace state",
  includesAll(projectSession, [
    '"project_create"',
    '"project_open"',
    '"project_select"',
    '"session_create"',
    '"session_list"',
    "CURRENT_PROJECT_KEY",
    "CURRENT_SESSION_KEY",
    "window.localStorage.setItem(CURRENT_PROJECT_KEY",
    "window.localStorage.setItem(CURRENT_SESSION_KEY",
  ]),
);
check(
  "workspace rail exposes project/session setup and plan dashboard",
  includesAll(sidebar, [
    'data-testid="btn-new-project"',
    'data-testid="btn-new-session"',
    "createSession(currentProject.id)",
  ]) && includesAll(projectRail, ["<Sidebar", "<PlanDashboardPanel"]),
);

check(
  "provider readiness comes from provider_list/provider_connect and runtime-ready selector",
  includesAll(projectSession, [
    '"provider_list"',
    '"provider_connect"',
    "selectHasConnectedProvider",
    "setOnboardedFlag(v && hasConnectedProvider(providers))",
  ]) &&
    includesAll(providerIpc, [
      "provider_connect",
      "health_check",
      "provider_list",
      "connection_summary",
    ]),
);
check(
  "product shell blocks chat until a provider is connected",
  includesAll(controller, [
    "selectHasConnectedProvider",
    "showProviderSetupBanner",
    "stage.gate_no_provider",
    "inputBlocked",
  ]) &&
    includesAll(providerBanner, [
      'data-testid="provider-required-banner"',
      'data-testid="provider-banner-cta"',
    ]) &&
    includesAll(onboarding, ["connectProvider(kind", "onConnected?.()", "PROVIDER_CHOICES"]),
);

check(
  "goal/interview flow starts with Socratic input and plan interview IPC",
  includesAll(socraticPanel, [
    'data-testid="socratic-interview-panel"',
    "onSubmitGoal(trimmed)",
    "onSubmitAnswer(trimmed)",
    "onComplete",
  ]) &&
    includesAll(usePlan, [
      '"workspace_plan_start_interview"',
      '"workspace_plan_save_interview_answer"',
      '"workspace_plan_submit_interview"',
      '"workspace_plan_generate_draft"',
    ]) &&
    includesAll(controller, [
      "handleStartInterview",
      "handleSubmitInterviewAnswer",
      "handleCompleteInterview",
      "usePlanInterviewLLM",
      'chat.sendUserMessage(goal, "interview", false)',
    ]),
);
check(
  "LLM plan draft parser is wired to assistant_end without mock draft fallback",
  includesAll(planInterviewLlm, [
    "decodeWorkspacePlanDraftFromLlm",
    "assistant_end",
    "invalid_json",
    "invalid_plan_shape",
  ]) && !planInterviewLlm.includes("mockPlanDraft"),
);

check(
  "plan approval requires an explicit approval/revision/discard surface",
  includesAll(planApproval, [
    'data-testid="plan-draft-approval"',
    "onApprove",
    "onRequestRevision",
    "onDiscard",
    "PlanDraftDependencyMap",
    'data-testid="plan-critique-rep"',
  ]) &&
    includesAll(usePlan, ['"workspace_plan_approve"', '"workspace_plan_discard_plan"']) &&
    includesAll(controller, [
      "handleApproveGeneratedPlan",
      "handleRequestPlanRevision",
      "handleDiscardGeneratedPlan",
      "PlanDraftRecoveryScreen",
    ]) &&
    includesAll(planRecovery, [
      'data-testid="plan-draft-recovery"',
      'data-testid="plan-draft-recovery-retry"',
    ]),
);

check(
  "roadmap/step flow lists approved steps, opens sessions, and updates step state",
  includesAll(usePlanRoadmap, [
    '"workspace_plan_status"',
    '"workspace_plan_list_steps"',
    '"workspace_plan_step_mappings"',
    '"roadmap_step_open"',
    '"roadmap_step_update_state"',
    "derivePlanRoadmapSteps",
  ]) &&
    includesAll(roadmapRail, [
      'data-testid="roadmap-rail"',
      'data-testid="roadmap-step-list"',
      "onOpenPlanStep",
      "onMarkPlanStepDone",
      "onOpenSession",
    ]) &&
    includesAll(productLayout, ["handleOpenPlanStep", "handleMarkPlanStepDone", "usePlanActivity"]),
);
check(
  "opening a roadmap step seeds the build prompt with plan context",
  includesAll(controller, [
    "buildPlanStepExecutionPrompt",
    "pendingAutoRunPlanStepBySession",
    "Expected files:",
    "Acceptance criteria:",
    'chat.sendUserMessage(buildPlanStepExecutionPrompt(item), "build", true, item.step.id)',
  ]),
);
check(
  "approved-plan chat routing asks before adding new plan steps",
  includesAll(usePlanRouter, [
    '"workspace_plan_route_chat"',
    '"workspace_plan_route_cancel"',
    '"workspace_plan_append_step"',
  ]) &&
    includesAll(controller, [
      "requestPlanRouteConfirmation",
      "settlePlanRouteConfirmation",
      "planRouter.appendStep",
    ]),
);

check(
  "tool permission approval path renders permission cards and calls approve/deny IPC",
  includesAll(chatSession, [
    "tool_call_start",
    "tool_call_approved",
    '"tool_approve"',
    '"tool_deny"',
    "modifiedArgs",
    "diff_preview",
  ]) &&
    includesAll(chatArea, ["onApproveToolCall", "onDenyToolCall"]) &&
    includesAll(messageList, ["<ToolCallMessage", "onApproveToolCall", "onDenyToolCall"]) &&
    includesAll(toolCallMessage, ["<PermissionCard", "onApprove", "onDeny"]) &&
    includesAll(permissionCard, ["<SafeCard", "<WarnCard", "<DangerCard"]) &&
    [safeCard, warnCard, dangerCard].every((source) =>
      includesAll(source, ['data-testid="card-approve"', 'data-testid="card-deny"']),
    ),
);
check(
  "write/edit permission cards surface patch previews before approval",
  includesAll(patchPreview, ['data-testid="patch-preview-panel"', "<DiffViewer"]) &&
    includesAll(warnCard, ["PatchPreviewPanel", "ArgsEditor"]) &&
    includesAll(dangerCard, ["PatchPreviewPanel", "ArgsEditor"]),
);

check(
  "changed files and preview are reachable from step detail and slide-in panel",
  includesAll(workmap, ["parseChangedFiles", "changedFilesFor", "changed_files"]) &&
    includesAll(stepDetail, [
      'data-testid="step-detail-open-code"',
      "changedFiles.length",
      'data-testid="step-detail-change-summary"',
    ]) &&
    includesAll(controller, [
      "openCodePanelWithContext",
      "handleOpenCodeForCard",
      'tab: "code"',
      "replaceFiles: true",
    ]) &&
    includesAll(slideInStore, ["changedFiles", "previewUrl", "setPreviewUrl"]) &&
    includesAll(slideInPanel, ["<CodeTab", "<PreviewTab", "<TerminalTab"]) &&
    includesAll(codeTab, [
      'data-testid="changed-files-list"',
      'data-testid="changed-file-item"',
      "<DiffViewer",
    ]) &&
    includesAll(previewTab, [
      'data-testid="preview-url-input"',
      'data-testid="preview-iframe"',
      "isSafeUrl",
    ]),
);

check(
  "verification is honest about AI self-report versus external/manual checks",
  includesAll(workmap, ['"card_verify"', "verifyLogFor", "verifyStateFor", "verifyErrorFor"]) &&
    includesAll(chatSession, ['"card_verify"', "VerifyLogPayload"]) &&
    includesAll(stepDetail, [
      "AI 자가보고: 의도 충족(주장)",
      'data-testid="step-detail-test-result"',
      'data-testid="step-detail-unverified-note"',
      "ApprovalJudgment",
    ]) &&
    includesAll(controller, ["handleVerify", "currentVerifyLog", "currentVerifyState"]),
);

check(
  "checkpoint/recovery flow can save, list, and restore checkpoints",
  includesAll(chatSession, [
    '"checkpoint_create"',
    '"checkpoint_list"',
    '"checkpoint_restore"',
    "CheckpointRowPayload",
  ]) &&
    includesAll(controller, [
      "handleManualCheckpoint",
      "refreshCheckpoints",
      "handleRestoreCheckpoint",
      "checkpointToRecoveryItem",
    ]) &&
    includesAll(recoveryPanel, [
      'data-testid="recovery-save-point"',
      'data-testid="recovery-restore"',
      'data-testid="restore-confirm-inline-action"',
    ]) &&
    includesAll(recoverySlideIn, ['data-testid="recovery-slide-in"', "<RecoveryPanel"]),
);

check(
  "restart persistence reloads projects, sessions, messages, and disk DB evidence path",
  includesAll(projectSession, [
    "window.localStorage.getItem(CURRENT_PROJECT_KEY",
    "window.localStorage.getItem(CURRENT_SESSION_KEY",
    '"project_list"',
    '"session_list"',
  ]) &&
    includesAll(chatSession, ['"message_list"', "`chat://event/${sessionId}`"]) &&
    includesAll(releaseSmoke, ["restart preserves disk DB", "collectEvidence"]),
);

check(
  "ablation doc uses current plan-first approval-judgment framing",
  includesAll(ablationDocLower, [
    "plan-first",
    "frictionless approval",
    "judgmental approval",
    "require_approval_judgment",
  ]) && !ablationDoc.includes("D/I/V/E gates enabled"),
);
check(
  "pilot freeze procedure exists and requires product-flow verifier",
  includesAll(stagePlanDoc, [
    "버전 프리즈",
    "pnpm verify:product-flow",
    "connected-provider smoke",
    "실 프로바이더",
    "증거 없이는 통과로 기록하지 않는다",
  ]),
);
check(
  "connected-provider smoke evidence template is clearly not completed evidence",
  exists(evidenceTemplatePath) &&
    includesAll(evidenceTemplate, [
      "TEMPLATE ONLY",
      "Do not mark this file as passed evidence",
      "pnpm verify:product-flow",
      "connected-provider smoke",
    ]) &&
    !/status:\s*(passed|complete|green|done)/i.test(evidenceTemplate),
);

const failed = checks.filter((item) => !item.ok);
console.log(
  JSON.stringify({ passed: checks.length - failed.length, failed: failed.length, checks }, null, 2),
);

if (failed.length > 0) {
  console.error(
    "\nProduct-flow static verification failed. This script checks wiring only; connected-provider smoke still requires real provider credentials and separate evidence.",
  );
  process.exit(1);
}

console.log(
  "\n[OK] Product-flow static wiring verified. Connected-provider smoke is not proven by this script.",
);
