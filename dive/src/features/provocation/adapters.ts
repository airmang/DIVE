import type {
  ChangedFileCategory,
  ProvocationChangedFile,
  ProvocationContext,
  ProvocationPlanStep,
} from "./types";

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizePlanStep(input: {
  id?: number | string;
  step_id?: string;
  title?: string | null;
  summary?: string | null;
  instruction_seed?: string | null;
  verification_kind?: string | null;
  verification_command?: string | null;
  verification_manual_check?: string | null;
}): ProvocationPlanStep {
  const verificationText = [
    input.verification_kind,
    input.verification_command,
    input.verification_manual_check,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    id: String(input.id ?? input.step_id ?? input.title ?? "step"),
    text: [input.step_id, input.title, input.summary, input.instruction_seed, verificationText]
      .filter(Boolean)
      .join(" "),
    kind: input.verification_kind ?? undefined,
  };
}

export function guessChangedFileCategory(path: string): ChangedFileCategory {
  const lower = path.toLowerCase();
  if (/(^|\/)package\.json$|(^|\/)(pnpm-lock|package-lock|yarn)\.lock$/.test(lower)) {
    return "dependency";
  }
  if (/(^|\/)\.env|config|tsconfig|vite|webpack|tailwind|eslint/.test(lower)) {
    return "config";
  }
  if (/(auth|oauth|permission|policy|security)/.test(lower)) return "auth";
  if (/(schema|migration|migrations|db|database)/.test(lower)) return "db";
  if (/(route|router|page)/.test(lower)) return "routing";
  if (/(\.test\.|\.spec\.)/.test(lower)) return "test";
  if (/\.(css|scss|tsx|jsx)$/.test(lower)) return "ui";
  if (/\.(ts|js|rs)$/.test(lower)) return "logic";
  return "unknown";
}

export function normalizeChangedFile(input: {
  path: string;
  changeType?: ProvocationChangedFile["changeType"];
  category?: ChangedFileCategory;
}): ProvocationChangedFile {
  return {
    path: input.path,
    changeType: input.changeType,
    category: input.category ?? guessChangedFileCategory(input.path),
  };
}

export function createProvocationContext(
  input: Partial<ProvocationContext> & Pick<ProvocationContext, "mode" | "stage">,
): ProvocationContext {
  return {
    ...input,
    acceptanceCriteria: input.acceptanceCriteria?.filter((item) => item.trim().length > 0),
    planSteps: input.planSteps?.filter((item) => item.text.trim().length > 0),
    changedFiles: input.changedFiles?.filter((item) => item.path.trim().length > 0),
  };
}
