// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type {
  AcceptanceCriterion,
  PlanGenerationResult,
  InterviewRow,
} from "../../features/planning";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { PlanDraftApprovalScreen } from "./PlanDraftApprovalScreen";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) => path,
}));

type PlanDraftStepWithMetadata = PlanGenerationResult["steps"][number] & {
  linked_criterion_ids: string[];
  rationale: string;
};

function draft(overrides: Partial<PlanGenerationResult> = {}): PlanGenerationResult {
  const base: PlanGenerationResult = {
    plan: {
      id: 7,
      project_id: 1,
      interview_id: 2,
      goal: "설정 화면 저장 흐름 개선",
      intent_summary: "저장 전후 상태를 사용자가 확인할 수 있게 한다.",
      scope: ["설정 화면 저장 버튼"],
      non_goals: ["인증 흐름 변경 없음"],
      constraints: ["기존 라우팅 유지"],
      acceptance_criteria: ["저장 성공 후 toast가 보인다"],
      status: "draft",
      created_at: 1,
      approved_at: null,
      updated_at: 1,
    },
    steps: [
      {
        id: 11,
        plan_id: 7,
        step_id: "P2-1",
        title: "저장 버튼 상태 정리",
        summary: "저장 중/완료 상태를 화면에 표시한다.",
        instruction_seed: "설정 화면 저장 버튼 상태를 정리한다.",
        expected_files: ["src/settings/SettingsPage.tsx"],
        acceptance_criteria: ["저장 중 버튼이 비활성화된다"],
        verification_kind: "command",
        verification_command: "pnpm test SettingsPage",
        verification_manual_check: null,
        dependencies: [],
        parallel_group: null,
        position: 1,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: 12,
        plan_id: 7,
        step_id: "P2-2",
        title: "토스트 확인",
        summary: "저장 성공 toast 표시를 확인한다.",
        instruction_seed: "toast가 표시되는지 확인한다.",
        expected_files: ["src/settings/SettingsPage.tsx", "src/toast.ts"],
        acceptance_criteria: ["저장 성공 후 toast가 보인다"],
        verification_kind: null,
        verification_command: null,
        verification_manual_check: "설정 화면에서 저장을 누르고 toast를 확인한다",
        dependencies: ["P2-1"],
        parallel_group: "ui-check",
        position: 2,
        created_at: 1,
        updated_at: 1,
      },
    ],
  };
  return { ...base, ...overrides };
}

function interview(): InterviewRow {
  return {
    id: 2,
    project_id: 1,
    goal: "설정 화면 저장 흐름 개선",
    questions: [],
    unresolved_questions: [],
    intent_summary: "저장 전후 상태를 사용자가 확인할 수 있게 한다.",
    status: "complete",
    created_at: 1,
    updated_at: 1,
  };
}

function renderScreen(overrides: Partial<Parameters<typeof PlanDraftApprovalScreen>[0]> = {}) {
  const props: Parameters<typeof PlanDraftApprovalScreen>[0] = {
    draft: draft(),
    interview: interview(),
    busy: false,
    onApprove: vi.fn(),
    onRequestRevision: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  render(<PlanDraftApprovalScreen {...props} />);
  return props;
}

describe("PlanDraftApprovalScreen intent and step review surface", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    useUiPreferencesStore.setState({ tutorialEnabled: false });
    invokeMock.mockReset();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  afterEach(() => cleanup());

  it("shows goal, acceptance criteria, expected files, verification, dependencies, and parallel group", () => {
    renderScreen();

    expect(screen.getByText("목표와 확인 기준")).toBeTruthy();
    expect(screen.getAllByText("저장 성공 후 toast가 보인다").length).toBeGreaterThan(0);

    const steps = screen.getAllByTestId("plan-draft-step");
    expect(steps).toHaveLength(2);
    expect(within(steps[0]).queryByTestId("plan-draft-step-details")).toBeNull();
    expect(within(steps[0]).getByText("검증 포함")).toBeTruthy();
    fireEvent.click(within(steps[0]).getByTestId("plan-draft-step-details-toggle"));
    expect(within(steps[0]).getByText("src/settings/SettingsPage.tsx")).toBeTruthy();
    expect(within(steps[0]).getByText("pnpm test SettingsPage")).toBeTruthy();
    fireEvent.click(within(steps[1]).getByTestId("plan-draft-step-details-toggle"));

    expect(within(steps[1]).getByText("설정 화면에서 저장을 누르고 toast를 확인한다")).toBeTruthy();
    expect(within(steps[1]).getByText("P2-1")).toBeTruthy();
    expect(within(steps[1]).getByText("ui-check")).toBeTruthy();
  });

  it("shows dependency map before review content and opens request changes on demand", () => {
    const props = renderScreen();

    const dependencyMap = screen.getByTestId("plan-draft-dependency-map");
    const reviewContent = screen.getByTestId("plan-draft-review-content");
    expect(
      dependencyMap.compareDocumentPosition(reviewContent) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByTestId("plan-draft-request-changes-panel")).toBeNull();

    fireEvent.click(screen.getByTestId("plan-draft-request-changes-toggle"));
    expect(screen.getByTestId("plan-draft-request-changes-panel")).toBeTruthy();

    fireEvent.change(screen.getByTestId("plan-draft-request-changes-input"), {
      target: { value: "Split the first step into a smaller setup step." },
    });
    fireEvent.click(screen.getByTestId("plan-draft-request-changes-submit"));

    expect(props.onRequestRevision).toHaveBeenCalledWith(
      "Split the first step into a smaller setup step.",
    );
    expect(screen.queryByTestId("plan-draft-request-changes-panel")).toBeNull();
  });

  it("keeps raw generated markdown collapsed until requested", () => {
    renderScreen();

    expect(screen.queryByTestId("plan-draft-raw-markdown")).toBeNull();
    fireEvent.click(screen.getByTestId("plan-draft-raw-toggle"));
    expect(screen.getByTestId("plan-draft-raw-markdown")).toBeTruthy();
  });

  it("opens a step-scoped revision request with step context", () => {
    const props = renderScreen();
    const steps = screen.getAllByTestId("plan-draft-step");

    fireEvent.click(within(steps[1]).getByTestId("plan-draft-step-revision"));
    const panel = screen.getByTestId("plan-draft-request-changes-panel");
    expect(panel.getAttribute("data-revision-target")).toBe("step");

    fireEvent.change(screen.getByTestId("plan-draft-request-changes-input"), {
      target: { value: "Merge this with the final check step." },
    });
    fireEvent.click(screen.getByTestId("plan-draft-request-changes-submit"));

    expect(props.onRequestRevision).toHaveBeenCalledTimes(1);
    const feedback = vi.mocked(props.onRequestRevision).mock.calls[0]?.[0] ?? "";
    expect(feedback).toContain("[STEP_REVISION]");
    expect(feedback).toContain("P2-2");
    expect(feedback).toContain("Review action: custom");
    expect(feedback).toContain("Merge this with the final check step.");
  });

  it("prefills a step-scoped revision from quick review actions", () => {
    const props = renderScreen();
    const steps = screen.getAllByTestId("plan-draft-step");

    fireEvent.click(within(steps[0]).getByTestId("plan-draft-step-quick-split"));
    const input = screen.getByTestId("plan-draft-request-changes-input") as HTMLTextAreaElement;
    expect(input.value.length).toBeGreaterThan(0);
    expect(screen.getByTestId("plan-draft-step-revision-context").textContent).toContain("P2-1");

    fireEvent.click(screen.getByTestId("plan-draft-request-changes-submit"));

    const feedback = vi.mocked(props.onRequestRevision).mock.calls[0]?.[0] ?? "";
    expect(feedback).toContain("[STEP_REVISION]");
    expect(feedback).toContain("Review action: split");
  });

  it("uses compact dependency map sizing for long step chains", () => {
    const base = draft().steps[0];
    const longChain = Array.from({ length: 7 }, (_, index) => ({
      ...base,
      id: 200 + index,
      step_id: `S-${index + 1}`,
      title: `Step ${index + 1}`,
      dependencies: index === 0 ? [] : [`S-${index}`],
      position: index + 1,
    }));

    renderScreen({ draft: draft({ steps: longChain }) });

    expect(screen.getByTestId("plan-draft-dependency-map").getAttribute("data-compact")).toBe(
      "true",
    );
  });

  it("shows linked criterion ids, criterion text, and step rationale for each generated step", () => {
    const criterion: AcceptanceCriterion = {
      criterionId: "AC-001",
      text: "저장 성공 후 toast가 보인다",
      source: "student_edit",
      status: "active",
      createdInVersion: 1,
      retiredInVersion: null,
    };
    const draftStep: PlanDraftStepWithMetadata = {
      ...draft().steps[0],
      acceptance_criteria: [criterion],
      linked_criterion_ids: ["AC-001"],
      rationale: "저장 완료 기준을 검증하려면 버튼 상태를 먼저 분리해야 한다.",
    };
    const linkedDraft = draft({
      plan: {
        ...draft().plan,
        acceptance_criteria: [criterion],
      },
      steps: [draftStep],
    });

    renderScreen({ draft: linkedDraft });

    const step = screen.getByTestId("plan-draft-step");
    expect(within(step).getByText("AC-001")).toBeTruthy();
    expect(within(step).getByText("저장 성공 후 toast가 보인다")).toBeTruthy();
    expect(
      within(step).getByText("저장 완료 기준을 검증하려면 버튼 상태를 먼저 분리해야 한다."),
    ).toBeTruthy();
  });

  it("keeps missing-verification rule cards quarantined from shipped plan approval", () => {
    const noVerificationDraft = draft({
      steps: [
        {
          ...draft().steps[0],
          verification_kind: null,
          verification_command: null,
          verification_manual_check: null,
        },
      ],
    });

    renderScreen({
      draft: noVerificationDraft,
      provocation: { enabled: true, mode: "work", projectId: 1, sessionId: 2 },
    });

    expect(screen.queryByText("검증 단계가 빠졌습니다")).toBeNull();
    expect(screen.queryByTestId("provocation-card")).toBeNull();
    expect(screen.getByTestId("plan-step-verification-indicator").dataset.verification).toBe(
      "missing",
    );
  });

  it("keeps missing-acceptance-criteria rule cards quarantined from shipped plan approval", () => {
    const missingCriteriaDraft = draft({
      plan: {
        ...draft().plan,
        acceptance_criteria: [],
      },
    });

    renderScreen({
      draft: missingCriteriaDraft,
      provocation: { enabled: true, mode: "work", projectId: 1, sessionId: 2 },
    });

    expect(screen.queryByText("완료 기준이 없습니다")).toBeNull();
    expect(screen.queryByTestId("provocation-card")).toBeNull();
  });

  it("keeps oversized-scope rule cards quarantined from shipped plan approval", () => {
    const base = draft();
    const manyStepDraft = draft({
      steps: Array.from({ length: 7 }, (_, index) => ({
        ...base.steps[0],
        id: 100 + index,
        step_id: `P2-${index + 1}`,
        title: `기능 ${index + 1}`,
        position: index + 1,
      })),
    });

    renderScreen({
      draft: manyStepDraft,
      provocation: { enabled: true, mode: "work", projectId: 1, sessionId: 2 },
    });

    expect(screen.queryByText("작업 범위가 너무 큽니다")).toBeNull();
    expect(screen.queryByTestId("provocation-card")).toBeNull();
  });

  it("invokes plan_drafted backend evaluation and renders one returned card", async () => {
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "provocation_agent_evaluate") {
        return Promise.resolve({
          status: "shown",
          evaluation_id: "eval-plan",
          card: {
            id: "card-plan",
            type: "plan_draft_review",
            stage: "instruct",
            severity: "caution",
            title: "검토 카드",
            prompt: "이 계획은 검증 없이 승인해도 완료 판단이 가능한가요?",
            message: "계획을 승인하기 전에 판단과 검증 근거가 충분한지 확인하세요.",
            evidence: [],
            actions: [
              { id: "add_verification_step", kind: "add_verification_step", label: "검증 추가" },
            ],
            primary_action_id: "add_verification_step",
            metadata: { supervisorEvaluationId: "eval-plan" },
            created_at: "2026-06-16T00:00:00.000Z",
          },
        });
      }
      return Promise.resolve(undefined);
    });

    renderScreen({
      draft: draft({
        steps: [
          {
            ...draft().steps[0],
            step_id: "s_001",
            verification_kind: null,
            verification_command: null,
            verification_manual_check: null,
          },
        ],
      }),
      provocation: { enabled: true, mode: "work", projectId: 1, sessionId: 2 },
    });

    expect(await screen.findByTestId("provocation-card")).toBeTruthy();
    const evaluationCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "provocation_agent_evaluate",
    );
    expect(evaluationCall?.[1]).toMatchObject({
      request: {
        event: "plan_drafted",
        sessionId: 2,
        projectId: 1,
        planId: 7,
        allowedActionIds: expect.arrayContaining(["add_verification_step"]),
      },
    });
    await waitFor(() => expect(screen.getAllByTestId("provocation-card")).toHaveLength(1));
    expect(screen.queryByText("검증 단계가 빠졌습니다")).toBeNull();
  });
});

describe("PlanDraftApprovalScreen discard confirmation (R8/D-37)", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    useUiPreferencesStore.setState({ tutorialEnabled: false });
  });

  afterEach(() => cleanup());

  it("does not discard immediately — opens a confirmation dialog first", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByTestId("plan-draft-discard"));
    expect(props.onDiscard).not.toHaveBeenCalled();
    expect(screen.getByTestId("plan-draft-discard-confirm")).toBeTruthy();
  });

  it("discards only after the user confirms", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByTestId("plan-draft-discard"));
    fireEvent.click(screen.getByTestId("plan-draft-discard-confirm-button"));
    expect(props.onDiscard).toHaveBeenCalledTimes(1);
  });

  it("cancels without discarding", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByTestId("plan-draft-discard"));
    fireEvent.click(screen.getByTestId("plan-draft-discard-cancel"));
    expect(props.onDiscard).not.toHaveBeenCalled();
  });
});

describe("PlanDraftApprovalScreen plan-critique gate (tutorial mode)", () => {
  beforeEach(() => {
    useLocaleStore.setState({ locale: "ko" });
    useUiPreferencesStore.setState({ tutorialEnabled: true });
    invokeMock.mockReset();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  afterEach(() => cleanup());

  const approveButton = () => screen.getByRole("button", { name: "승인" }) as HTMLButtonElement;

  it("blocks approval until a one-line critique is recorded on the 'none' path (P1-14)", () => {
    renderScreen();
    // Unset critique → blocked, no rubber-stamp.
    expect(approveButton().disabled).toBe(true);

    // "있음 — 변경 요청" keeps it blocked and shows no note field.
    fireEvent.click(screen.getByTestId("plan-critique-found"));
    expect(approveButton().disabled).toBe(true);
    expect(screen.queryByTestId("plan-critique-none-note")).toBeNull();

    // "없음 — 승인 가능" reveals the note field but stays blocked until authored.
    fireEvent.click(screen.getByTestId("plan-critique-none"));
    const note = screen.getByTestId("plan-critique-none-note") as HTMLInputElement;
    expect(approveButton().disabled).toBe(true);

    fireEvent.change(note, { target: { value: "ok" } });
    expect(approveButton().disabled).toBe(true); // under the 4-char minimum

    fireEvent.change(note, { target: { value: "단계가 충분함" } });
    expect(approveButton().disabled).toBe(false);
  });

  it("passes the trimmed critique resolution to onApprove (P1-15)", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByTestId("plan-critique-none"));
    fireEvent.change(screen.getByTestId("plan-critique-none-note"), {
      target: { value: "  단계가 충분함  " },
    });
    fireEvent.click(approveButton());
    expect(props.onApprove).toHaveBeenCalledWith({
      response: "none",
      note: "단계가 충분함",
    });
  });
});
