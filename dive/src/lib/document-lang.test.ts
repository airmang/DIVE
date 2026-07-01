// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { applyDocumentLang, localeToLang } from "./document-lang";

describe("document lang sync (P1-33)", () => {
  it("maps each locale to a BCP-47 primary tag", () => {
    expect(localeToLang("ko")).toBe("ko");
    expect(localeToLang("en")).toBe("en");
  });

  it("updates <html lang> when the locale changes", () => {
    applyDocumentLang("en");
    expect(document.documentElement.lang).toBe("en");
    applyDocumentLang("ko");
    expect(document.documentElement.lang).toBe("ko");
  });
});
