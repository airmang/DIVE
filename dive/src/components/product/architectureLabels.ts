import { ARCHITECTURE_FORMS } from "../../features/planning";
import type { ArchitectureForm } from "../../features/planning";

// The `t` shape returned by useT(). i18n does not export a named Translator type,
// so we mirror its signature locally to keep these helpers UI-framework-free.
type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Human label for an architecture form. For the `other` form we prefer the
 * student's own free-text label when present, falling back to the generic
 * "기타 / Other" string so a half-decided draft still reads sensibly.
 */
export function architectureFormLabel(
  t: Translate,
  form: ArchitectureForm,
  formOtherLabel?: string | null,
): string {
  if (form === "other") {
    const custom = formOtherLabel?.trim();
    if (custom) return custom;
  }
  return t(`prd.architecture.form.${form}`);
}

export interface ArchitectureFormOption {
  form: ArchitectureForm;
  label: string;
}

/** The bounded picker options, in canonical order, already localized. */
export function architectureFormOptions(t: Translate): ArchitectureFormOption[] {
  return ARCHITECTURE_FORMS.map((form) => ({
    form,
    label: t(`prd.architecture.form.${form}`),
  }));
}
