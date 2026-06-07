export type PromptContext = "plan" | "build" | "verify";

export interface PromptTemplate {
  id: string;
  contexts: PromptContext[];
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "d-decompose",
    contexts: ["plan"],
  },
  {
    id: "d-overview",
    contexts: ["plan"],
  },
  {
    id: "i-focus-card",
    contexts: ["build"],
  },
  {
    id: "i-io-first",
    contexts: ["build"],
  },
  {
    id: "v-verify-how",
    contexts: ["verify"],
  },
  {
    id: "v-edge-cases",
    contexts: ["verify"],
  },
  {
    id: "e-integration-review",
    contexts: ["verify"],
  },
  {
    id: "e-refactor-chances",
    contexts: ["verify"],
  },
];

export function templatesForContext(context: PromptContext): PromptTemplate[] {
  return PROMPT_TEMPLATES.filter((t) => t.contexts.includes(context));
}
