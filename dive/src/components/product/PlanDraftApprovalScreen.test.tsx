// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "../../i18n";
import type { PlanGenerationResult, InterviewRow } from "../../features/planning";
import { useUiPreferencesStore } from "../../stores/ui-preferences";
import { PlanDraftApprovalScreen } from "./PlanDraftApprovalScreen";

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
  });

  afterEach(() => cleanup());

  it("shows goal, acceptance criteria, expected files, verification, dependencies, and parallel group", () => {
    renderScreen();

    expect(screen.getByText("목표와 확인 기준")).toBeTruthy();
    expect(screen.getAllByText("저장 성공 후 toast가 보인다").length).toBeGreaterThan(0);

    const steps = screen.getAllByTestId("plan-draft-step");
    expect(steps).toHaveLength(2);
    expect(within(steps[0]).getByText("검증 포함")).toBeTruthy();
    expect(within(steps[0]).getByText("src/settings/SettingsPage.tsx")).toBeTruthy();
    expect(within(steps[0]).getByText("pnpm test SettingsPage")).toBeTruthy();

    expect(within(steps[1]).getByText("설정 화면에서 저장을 누르고 toast를 확인한다")).toBeTruthy();
    expect(within(steps[1]).getByText("P2-1")).toBeTruthy();
    expect(within(steps[1]).getByText("ui-check")).toBeTruthy();
  });

  it("renders a contextual missing-verification card and seeds revision feedback", () => {
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
      provocation: { enabled: true, mode: "standard", projectId: 1, sessionId: 2 },
    });

    expect(screen.getByText("검증 단계가 빠졌습니다")).toBeTruthy();
    expect(screen.getByTestId("plan-step-verification-indicator").dataset.verification).toBe(
      "missing",
    );

    fireEvent.click(screen.getByText("검증 단계 추가"));
    expect(
      (screen.getByPlaceholderText("이 초안에서 바꿀 내용을 입력하세요...") as HTMLTextAreaElement)
        .value,
    ).toContain("검증 단계가 필요합니다");
  });

  it("seeds revision feedback when the missing-acceptance-criteria action is selected", () => {
    const missingCriteriaDraft = draft({
      plan: {
        ...draft().plan,
        acceptance_criteria: [],
      },
    });

    renderScreen({
      draft: missingCriteriaDraft,
      provocation: { enabled: true, mode: "standard", projectId: 1, sessionId: 2 },
    });

    expect(screen.getByText("완료 기준이 없습니다")).toBeTruthy();

    fireEvent.click(screen.getByText("완료 기준 추가"));
    expect(
      (screen.getByPlaceholderText("이 초안에서 바꿀 내용을 입력하세요...") as HTMLTextAreaElement)
        .value,
    ).toContain("완료 기준을 계획에 추가해 주세요");
  });
});
