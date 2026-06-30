import { describe, expect, it } from "vitest";
import { classifyProjectCreateError } from "./error-classify";

describe("classifyProjectCreateError (P1-06)", () => {
  it("maps an unsafe/non-absolute project path", () => {
    expect(classifyProjectCreateError("unsafe project path: /Library/foo").kind).toBe(
      "unsafe_path",
    );
    expect(classifyProjectCreateError("Project path must be absolute").kind).toBe("unsafe_path");
  });

  it("maps a permission failure from dir creation", () => {
    expect(
      classifyProjectCreateError("create project dir: Permission denied (os error 13)").kind,
    ).toBe("permission");
    expect(classifyProjectCreateError(new Error("EACCES: permission denied")).kind).toBe(
      "permission",
    );
  });

  it("maps a canonicalize / missing-path failure", () => {
    expect(classifyProjectCreateError("canonicalize project parent: No such file").kind).toBe(
      "canonicalize",
    );
  });

  it("falls back to generic so the raw Rust string is never shown", () => {
    const classified = classifyProjectCreateError("some unexpected backend failure");
    expect(classified.kind).toBe("generic");
    expect(classified.bodyKey).toBe("error.project_create.generic.body");
  });

  it("always returns a localizable body key, never the raw message", () => {
    for (const input of ["unsafe project path: x", "Permission denied", "canonicalize: y", "?"]) {
      const classified = classifyProjectCreateError(input);
      expect(classified.bodyKey.startsWith("error.project_create.")).toBe(true);
      expect(classified.bodyKey.endsWith(".body")).toBe(true);
    }
  });
});
