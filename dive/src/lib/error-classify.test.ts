import { describe, expect, it } from "vitest";
import { classifyProjectCreateError, matchSidecarModelNotFoundError } from "./error-classify";

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

// S-051 D3: run-time sidecar model-not-found detection.
describe("matchSidecarModelNotFoundError", () => {
  it("extracts the OpenRouter provider and slug-with-slash model", () => {
    const match = matchSidecarModelNotFoundError(
      "pi sidecar error: model not found: openrouter/anthropic/claude-sonnet-5",
    );
    expect(match).toEqual({ provider: "openrouter", model: "anthropic/claude-sonnet-5" });
  });

  it("extracts the native Anthropic provider and model", () => {
    const match = matchSidecarModelNotFoundError(
      "pi sidecar error: model not found: anthropic/claude-sonnet-5",
    );
    expect(match).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
  });

  it("accepts an Error instance carrying the message", () => {
    const match = matchSidecarModelNotFoundError(
      new Error("pi sidecar error: model not found: openai-codex/gpt-5.4"),
    );
    expect(match).toEqual({ provider: "openai-codex", model: "gpt-5.4" });
  });

  it("returns null for unrelated errors", () => {
    expect(matchSidecarModelNotFoundError("pi sidecar error: rate limit exceeded")).toBeNull();
    expect(matchSidecarModelNotFoundError("network timeout")).toBeNull();
  });
});
