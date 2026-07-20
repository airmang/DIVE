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

// S-066/S-067/S-068/S-069 split several god-files into a primary file plus the
// sibling files it composes. A module's wiring contract now spans that file set,
// so readAll() reads them as one unit — the checks verify the same contract at
// its new location without weakening what is required.
function readAll(rels, root = repoRoot) {
  return rels.map((rel) => read(rel, root)).join("\n");
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
const controller = readAll([
  "dive/src/components/product/useProductShellController.ts",
  // S-068 split: the controller composes these hooks/views (imported and called
  // in useProductShellController.ts).
  "dive/src/components/product/usePlanChatRouting.ts",
  "dive/src/components/product/usePlanDraftLifecycle.ts",
  "dive/src/components/product/useShellMenus.ts",
  "dive/src/components/product/productShellControllerLogic.ts",
  "dive/src/components/product/ConversationSurfaces.tsx",
]);
const planStepLogic = read("dive/src/components/product/productShellPlanStepLogic.ts");
const planStepRuntime = read("dive/src/components/product/useProductPlanStepRuntime.ts");
const productRecovery = read("dive/src/components/product/useProductRecovery.ts");
const productLayout = read("dive/src/components/product/ProductShellLayout.tsx");
const productModalHost = read("dive/src/components/product/ProductModalHost.tsx");
const planRouteConfirmModal = read("dive/src/components/product/PlanRouteConfirmModal.tsx");
const planDashboardPanel = read("dive/src/components/product/PlanDashboardPanel.tsx");
const planAddStepPanel = read("dive/src/components/product/PlanAddStepPanel.tsx");
const chatSession = readAll([
  "dive/src/hooks/useChatSession.ts",
  // S-069 split: useChatSession composes the agent-event union and the pure
  // reducer/normalizers (imported in useChatSession.ts).
  "dive/src/hooks/agent-events.ts",
  "dive/src/hooks/chat-session-reducer.ts",
]);
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
const toolActivity = read("dive/src/components/chat/ToolActivity.tsx");
const permissionCard = read("dive/src/components/permission-card/PermissionCard.tsx");
const safeCard = read("dive/src/components/permission-card/SafeCard.tsx");
const warnCard = read("dive/src/components/permission-card/WarnCard.tsx");
const dangerCard = read("dive/src/components/permission-card/DangerCard.tsx");
const patchPreview = read("dive/src/components/permission-card/PatchPreviewPanel.tsx");
const planApproval = read("dive/src/components/product/PlanDraftApprovalScreen.tsx");
const planRecovery = read("dive/src/components/product/PlanDraftRecoveryScreen.tsx");
const socraticPanel = read("dive/src/components/product/SocraticInterviewPanel.tsx");
const roadmapRail = read("dive/src/components/product/RoadmapRail.tsx");
const planView = read("dive/src/components/plan/PlanView.tsx");
const planTimeline = read("dive/src/components/plan/PlanTimeline.tsx");
const planStepActions = read("dive/src/components/plan/PlanStepActions.tsx");
const stepDetail = readAll([
  "dive/src/components/product/StepDetailSlideIn.tsx",
  // S-067/S-068 split: the slide-in composes these section/evidence/supervisor
  // files (imported in StepDetailSlideIn.tsx).
  "dive/src/components/product/StepDetailSections.tsx",
  "dive/src/components/product/stepDetailEvidence.ts",
  "dive/src/components/product/stepDetailSupervisorRequests.ts",
]);
const slideInStore = read("dive/src/stores/slideIn.ts");
const slideInPanel = read("dive/src/components/slide-in/SlideInPanel.tsx");
const codeTab = read("dive/src/components/slide-in/CodeTab.tsx");
const previewTab = read("dive/src/components/slide-in/PreviewTab.tsx");
const recoveryPanel = read("dive/src/components/product/RecoveryPanel.tsx");
const recoverySlideIn = read("dive/src/components/product/RecoverySlideIn.tsx");
const releaseSmoke = read("dive/scripts/release-gate-smoke.mjs");
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
  "ipc::pending_tool_calls",
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
    "updateStepState",
  ]) &&
    includesAll(roadmapRail, [
      "<PlanView",
      "onOpenStep: onOpenPlanStep",
      "onOpenSession",
      "onCreatePlan",
    ]) &&
    includesAll(planView, ['data-testid="plan-view"', "<PlanTimeline", "actions.onOpenStep"]) &&
    includesAll(planTimeline, ['data-testid="plan-timeline"', "<PlanStep"]) &&
    includesAll(planStepActions, [
      'data-testid="plan-step-action"',
      'data-action="start"',
      'data-action="resume"',
      'data-action="open"',
    ]) &&
    includesAll(productLayout, ["handleOpenPlanStep", "usePlanActivity"]),
);
check(
  "opening a roadmap step seeds the build prompt with plan context",
  includesAll(planStepRuntime, [
    "buildPlanStepExecutionPrompt",
    "pendingPlanStepPrompt",
    "pendingPromptPlanStepBySession",
  ]) &&
    includesAll(planStepLogic, [
      "buildPlanStepExecutionPrompt",
      "Expected files:",
      "Acceptance criteria:",
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
      "pendingPlanRoute",
    ]) &&
    includesAll(productModalHost, ["PlanRouteConfirmModal", "modals.planRoute"]) &&
    includesAll(planRouteConfirmModal, [
      'data-testid="plan-route-confirm"',
      "onApprove",
      "onReject",
    ]) &&
    includesAll(planDashboardPanel, ["PlanAddStepPanel", "plan.appendStep"]) &&
    includesAll(planAddStepPanel, ["onAppendStep", "mutationReason", "linkedCriterionIds"]),
);

check(
  "interview-submit machinery is hidden from the chat transcript",
  includesAll(read("dive/src/components/chat/filterInterviewNoise.ts"), [
    "INTERVIEW_SUBMIT",
    "filterInterviewNoise",
    // Structural detection: the conversational-accept path emits the plan JSON
    // without the [INTERVIEW_SUBMIT] marker (2026-06-10 E2E run-2 FAIL).
    "looksLikePlanDraftJson",
    '"plan_input"',
  ]) && includesAll(messageList, ["filterInterviewNoise"]),
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
    includesAll(chatSession, ['"pending_tool_calls"', "pendingToolCallToMessage"]) &&
    includesAll(messageList, ["<ToolActivity", "onApproveToolCall", "onDenyToolCall"]) &&
    includesAll(toolActivity, ["<PermissionCard", "onApprove", "onDeny"]) &&
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
      "isLoopbackUrl",
    ]),
);

check(
  "verification is honest about AI self-report versus external/manual checks",
  includesAll(workmap, ['"card_verify"', "verifyLogFor", "verifyStateFor", "verifyErrorFor"]) &&
    includesAll(chatSession, ['"card_verify"', "VerifyLogPayload"]) &&
    includesAll(stepDetail, [
      "roadmap.step_detail.intent_match_true",
      'data-testid="step-detail-test-result"',
      'data-testid="step-detail-unverified-note"',
      "ApprovalJudgment",
    ]) &&
    includesAll(controller, ["handleVerify", "currentVerifyLog", "currentVerifyState"]),
);

check(
  "finished build step auto-surfaces the verify + judgment gate (F2)",
  includesAll(controller, [
    "autoSurfaceVerify",
    '"enter_instruct"',
    '"request_verify"',
    "roadmapModel.verifyStep",
    "setStepDetailOpen(true)",
  ]),
);

check(
  "interview on a project with an approved plan confirms replacement instead of dead-ending",
  includesAll(controller, [
    "has_approved_plan",
    "requestPlanReplaceConfirmation",
    "replaceApproved",
  ]) &&
    includesAll(read("dive/src-tauri/src/ipc/workspace_plan/plan_lifecycle.rs"), [
      "replace_approved",
      "|| replace_approved",
    ]) &&
    includesAll(read("dive/src/components/product/ProductModalHost.tsx"), [
      "PlanReplaceConfirmModal",
    ]),
);

check(
  "checkpoint/recovery flow can save, list, and restore checkpoints",
  includesAll(chatSession, [
    '"checkpoint_create"',
    '"checkpoint_list"',
    '"checkpoint_restore"',
    "CheckpointRowPayload",
  ]) &&
    includesAll(productRecovery, [
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
