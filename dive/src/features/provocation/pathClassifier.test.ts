import { describe, expect, it } from "vitest";
import { classifyChangedFilePath, isHighRiskCategory } from "./pathClassifier";
import { guessChangedFileCategory } from "./adapters";

// Mirror of the live diff_ready high-risk decision (adapters `isHighRiskFile`
// and rules `highRiskFile` both compute `isHighRiskCategory(classify(path))`).
function isHighRiskPath(path: string): boolean {
  return isHighRiskCategory(classifyChangedFilePath(path));
}

describe("classifyChangedFilePath (S-064 E7 bounded classifier)", () => {
  it("does not misclassify substrings into high-risk categories", () => {
    // Each of these used to trip an unbounded substring alternation.
    expect(classifyChangedFilePath("src/components/AuthorCard.tsx")).toBe("ui");
    expect(classifyChangedFilePath("AuthorCard.tsx")).toBe("ui");
    expect(classifyChangedFilePath("packages/x.ts")).toBe("logic");
    expect(classifyChangedFilePath("docs/reconfigure.md")).toBe("unknown");
    expect(classifyChangedFilePath("src/myenv.ts")).toBe("logic");
    // None of the above should be treated as high-risk on the live path.
    for (const path of [
      "src/components/AuthorCard.tsx",
      "packages/x.ts",
      "docs/reconfigure.md",
      "src/myenv.ts",
    ]) {
      expect(isHighRiskPath(path)).toBe(false);
    }
  });

  it("still classifies genuine matches on segment boundaries", () => {
    expect(classifyChangedFilePath("src/auth/login.ts")).toBe("auth");
    expect(classifyChangedFilePath(".env")).toBe("config");
    expect(classifyChangedFilePath("config/.env.local")).toBe("config");
    expect(classifyChangedFilePath("tsconfig.json")).toBe("config");
    expect(classifyChangedFilePath("vite.config.ts")).toBe("config");
    expect(classifyChangedFilePath("package.json")).toBe("dependency");
    expect(classifyChangedFilePath("Cargo.lock")).toBe("dependency");
    expect(classifyChangedFilePath("Dockerfile")).toBe("ci");
    expect(classifyChangedFilePath(".github/workflows/ci.yml")).toBe("ci");
    expect(classifyChangedFilePath("certs/deploy.pem")).toBe("secret");
    expect(classifyChangedFilePath("keys/id_rsa")).toBe("secret");
    expect(classifyChangedFilePath("src/routes/home.ts")).toBe("routing");
    expect(classifyChangedFilePath("src/db/schema.ts")).toBe("db");
  });

  it("treats genuine high-risk categories as high-risk on the live path", () => {
    expect(isHighRiskPath("src/auth/login.ts")).toBe(true);
    expect(isHighRiskPath("package.json")).toBe(true);
    expect(isHighRiskPath(".env")).toBe(true);
    expect(isHighRiskPath("src/components/AuthorCard.tsx")).toBe(false);
    expect(isHighRiskCategory("ui")).toBe(false);
    expect(isHighRiskCategory("secret")).toBe(true);
  });

  it("is the exact classifier the live diff_ready path uses", () => {
    // guessChangedFileCategory (adapters/live path) delegates here — same result.
    expect(guessChangedFileCategory("src/components/AuthorCard.tsx")).toBe(
      classifyChangedFilePath("src/components/AuthorCard.tsx"),
    );
    expect(guessChangedFileCategory("src/auth/login.ts")).toBe("auth");
  });
});
