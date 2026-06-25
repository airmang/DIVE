import { describe, expect, it } from "vitest";
import { VERIFICATION_STATUS_LABEL_KEY } from "./verificationStatus";
import { SUPPORTED_LOCALES, translate } from "../../i18n";

describe("verification status i18n labels (S-026)", () => {
  it("resolves every verification labelKey to a non-empty string in all locales (no raw-key leak)", () => {
    for (const key of Object.values(VERIFICATION_STATUS_LABEL_KEY)) {
      for (const locale of SUPPORTED_LOCALES) {
        const resolved = translate(locale, key);
        // translate() returns the raw key on a catalog miss — guard against that.
        expect(resolved, `${key} @ ${locale}`).not.toBe(key);
        expect(resolved.trim().length, `${key} @ ${locale}`).toBeGreaterThan(0);
      }
    }
  });
});
