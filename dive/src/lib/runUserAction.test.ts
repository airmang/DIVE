import { describe, expect, it, vi } from "vitest";
import { runUserAction } from "./runUserAction";

describe("runUserAction", () => {
  it("resolves ok with the value on success and never calls onError", async () => {
    const onError = vi.fn();
    const result = await runUserAction(async () => 42, onError);
    expect(result).toEqual({ ok: true, value: 42 });
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError and resolves { ok: false } instead of throwing when the action rejects", async () => {
    const onError = vi.fn();
    const error = new Error("boom");
    const result = await runUserAction(async () => {
      throw error;
    }, onError);
    expect(result).toEqual({ ok: false });
    expect(onError).toHaveBeenCalledWith(error);
  });
});
