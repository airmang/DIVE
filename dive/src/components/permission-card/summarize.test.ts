import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import { summarizePatch } from "./summarize";

const t = (key: string, params?: Record<string, string | number>) => translate("en", key, params);

describe("summarizePatch", () => {
  it("describes added table rows from an HTML patch", () => {
    const rows = Array.from({ length: 7 }, (_, index) => `<tr><td>${index + 1}</td></tr>`).join(
      "\n",
    );
    const summary = summarizePatch({
      toolName: "write_file",
      diff: {
        path: "hours.html",
        before: "",
        after: `<table>\n${rows}\n</table>`,
      },
      args: { path: "hours.html" },
      t,
    });

    expect(summary?.headline).toContain("Creates a new HTML file");
    expect(summary?.details).toContain("Adds a <table> (7 rows).");
  });

  it("describes hover rules from a CSS edit", () => {
    const summary = summarizePatch({
      toolName: "edit_file",
      diff: {
        path: "src/app.css",
        before: ".button { color: black; }",
        after: ".button { color: black; }\n.button:hover { color: blue; }",
      },
      args: { path: "src/app.css", find: "", replace: ".button:hover { color: blue; }" },
      t,
    });

    expect(summary?.headline).toContain("Changes CSS");
    expect(summary?.details).toContain("Adds a :hover rule.");
  });

  it("calls out whole-file write_file replacements", () => {
    const summary = summarizePatch({
      toolName: "write_file",
      diff: {
        path: "src/App.tsx",
        before: "line 1\nline 2\nline 3",
        after: "new line",
      },
      args: { path: "src/App.tsx", content: "new line" },
      t,
    });

    expect(summary?.wholeFileReplacement).toBe(true);
    expect(summary?.headline).toContain("Replaces the entire component file");
    expect(summary?.headline).toContain("3 lines removed");
  });
});
