import { describe, expect, it } from "vitest";
import {
  isSubstantiveObservation,
  splitAcceptanceCriteria,
  uniqueStrings,
} from "./stepDetailEvidence";

describe("uniqueStrings", () => {
  it("trims, drops empties, and dedupes", () => {
    expect(uniqueStrings(["  a ", "a", "", "  ", "b"])).toEqual(["a", "b"]);
  });

  it("returns an empty array for no usable items", () => {
    expect(uniqueStrings(["", "   "])).toEqual([]);
  });
});

describe("isSubstantiveObservation", () => {
  it("rejects short, empty, or non-string observations", () => {
    expect(isSubstantiveObservation(null)).toBe(false);
    expect(isSubstantiveObservation(undefined)).toBe(false);
    expect(isSubstantiveObservation("")).toBe(false);
    expect(isSubstantiveObservation("short")).toBe(false);
    // Whitespace does not count toward the threshold.
    expect(isSubstantiveObservation("   a    ")).toBe(false);
  });

  it("accepts an observation at or above the 8-character threshold", () => {
    expect(isSubstantiveObservation("12345678")).toBe(true);
    expect(isSubstantiveObservation("the list renders as expected")).toBe(true);
  });
});

describe("splitAcceptanceCriteria", () => {
  it("returns an empty array for blank text", () => {
    expect(splitAcceptanceCriteria("")).toEqual([]);
    expect(splitAcceptanceCriteria("   ")).toEqual([]);
  });

  it("keeps single-line text as one criterion", () => {
    expect(splitAcceptanceCriteria("The app renders a list")).toEqual(["The app renders a list"]);
  });

  it("splits on newlines, semicolons, and bullets", () => {
    expect(splitAcceptanceCriteria("first line\nsecond line")).toEqual([
      "first line",
      "second line",
    ]);
    expect(splitAcceptanceCriteria("first; second")).toEqual(["first", "second"]);
    expect(splitAcceptanceCriteria("first • second")).toEqual(["first", "second"]);
  });

  it("falls back to splitting on AC-number markers when there is no delimiter", () => {
    expect(splitAcceptanceCriteria("AC-1 shows list AC-2 shows detail")).toEqual([
      "AC-1 shows list",
      "AC-2 shows detail",
    ]);
  });

  it("dedupes repeated criteria", () => {
    expect(splitAcceptanceCriteria("same\nsame\nother")).toEqual(["same", "other"]);
  });
});
