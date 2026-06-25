// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalJudgment } from "./ApprovalJudgment";
import { useLocaleStore } from "../../i18n";

describe("ApprovalJudgment", () => {
  beforeEach(() => useLocaleStore.setState({ locale: "ko" }));
  afterEach(() => cleanup());

  it("labels the concern note textarea and submits the typed reason", () => {
    const onDecide = vi.fn();
    render(<ApprovalJudgment onDecide={onDecide} />);

    fireEvent.click(screen.getByRole("button", { name: "우려 있음" }));

    const note = screen.getByLabelText("우려 사유 (한 줄)");
    fireEvent.change(note, { target: { value: "테스트 결과를 아직 못 봄" } });
    fireEvent.click(screen.getByRole("button", { name: "그래도 승인" }));

    expect(onDecide).toHaveBeenCalledWith({
      outcome: "approved_with_concern",
      note: "테스트 결과를 아직 못 봄",
    });
  });
});
