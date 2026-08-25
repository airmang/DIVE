import { ARCHITECTURE_FORMS } from "../../features/planning";
import type { ArchitectureForm } from "../../features/planning";

// The `t` shape returned by useT(). i18n does not export a named Translator type,
// so we mirror its signature locally to keep these helpers UI-framework-free.
type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Where a form label is shown. The picker (toggle buttons, proposal cards)
 * keeps the instructional "Other (describe it)" copy; read contexts (the saved
 * read view, comma-joined summaries) must not echo an instruction, so an
 * unlabeled `other` reads as plain "기타 / Other" there (S-072 review follow-up).
 */
export type ArchitectureLabelContext = "picker" | "read";

/**
 * Human label for an architecture form. For the `other` form we prefer the
 * student's own free-text label when present; without one, the picker copy or
 * — in a read context — the plain "기타 / Other" string.
 */
export function architectureFormLabel(
  t: Translate,
  form: ArchitectureForm,
  formOtherLabel?: string | null,
  context: ArchitectureLabelContext = "picker",
): string {
  if (form === "other") {
    const custom = formOtherLabel?.trim();
    if (custom) return custom;
    if (context === "read") return t("prd.architecture.form_other_plain");
  }
  return t(`prd.architecture.form.${form}`);
}

/**
 * S-072 (014 theme 1): every chosen form, comma-joined, in the student's pick
 * order — a read context. `other` shows the student's own label when present,
 * plain "Other" otherwise. Empty string when no form is chosen (callers decide
 * the "not decided yet" fallback).
 */
export function architectureFormsLabel(
  t: Translate,
  forms: ArchitectureForm[],
  formOtherLabel?: string | null,
): string {
  return forms.map((form) => architectureFormLabel(t, form, formOtherLabel, "read")).join(", ");
}

/** One-line plain-language definition of a form (`prd.architecture.form_help.*`). */
export function architectureFormHelp(t: Translate, form: ArchitectureForm): string {
  return t(`prd.architecture.form_help.${form}`);
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
