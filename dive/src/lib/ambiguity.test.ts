import { describe, expect, it } from "vitest";
import { detectAmbiguity } from "./ambiguity";

describe("detectAmbiguity", () => {
  it("detects vague English input when locale is en", () => {
    expect(detectAmbiguity("just make it nice", "en").length).toBeGreaterThanOrEqual(1);
  });

  it("does not flag a clear English sentence", () => {
    expect(
      detectAmbiguity("Build a login form with email validation and an error state.", "en"),
    ).toHaveLength(0);
  });

  it("keeps Korean detection available under ko", () => {
    expect(detectAmbiguity("고쳐줘", "ko")).toEqual([
      expect.objectContaining({
        kind: "missing_target",
        match: "고쳐줘",
      }),
    ]);
  });
});
