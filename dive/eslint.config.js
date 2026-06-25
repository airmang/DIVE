import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist", "src-tauri/target", "node_modules", "src-tauri/binaries", "pi-sidecar/build"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["*.config.{js,ts}", "vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: globals.vitest,
    },
  },
  // S-030 (i18n): forbid hardcoded Hangul string literals in the supervised-flow
  // UI so English-locale users never see Korean. Route every user-facing string
  // through i18n (t()/translate). Legitimately-Korean files are intentionally out
  // of scope: i18n catalogs, tests, dev-only rules.ts, the persisted-legacy labels
  // in verificationStatus.ts, the deferred logging.ts fallback labels, and the
  // Korean-text-processing logic (ambiguity/error-classify/filterInterviewNoise,
  // and adapters.ts intent-detection patterns — their Korean-keyword bias is
  // tracked under theme 8 / S-036, not S-030 display).
  {
    files: [
      "src/features/roadmap/**/*.{ts,tsx}",
      "src/features/provocation/useProvocationActionResolver.ts",
      "src/features/provocation/ProvocationCardHost.tsx",
      "src/components/product/**/*.{ts,tsx}",
      "src/components/workmap/**/*.{ts,tsx}",
      "src/components/plan/**/*.{ts,tsx}",
      "src/components/slide-in/**/*.{ts,tsx}",
      "src/components/chat/**/*.{ts,tsx}",
      "src/stores/project-session.ts",
    ],
    ignores: [
      "**/*.test.{ts,tsx}",
      // PlanAddStepPanel: 7 user-facing strings are localized; the remaining
      // Korean is the scope-expansion evidence-ref labels whose card display is
      // localized at the backend (localized_evidence_label). SocraticInterviewPanel:
      // vague-answer detection keywords (logic). productShellPlanStepLogic: Korean
      // agent-execution prompts (functional, not display chrome). The latter two
      // are tracked as follow-ups (detection bias → S-036; agent-prompt locale).
      "src/components/product/PlanAddStepPanel.tsx",
      "src/components/product/SocraticInterviewPanel.tsx",
      "src/components/product/productShellPlanStepLogic.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/[\\uAC00-\\uD7A3]/]",
          message:
            "Hangul string literal in supervised-flow UI — route through i18n (t()/translate). (S-030)",
        },
        {
          selector: "JSXText[value=/[\\uAC00-\\uD7A3]/]",
          message: "Hangul JSX text in supervised-flow UI — route through i18n. (S-030)",
        },
        {
          selector: "TemplateElement[value.cooked=/[\\uAC00-\\uD7A3]/]",
          message: "Hangul in template literal in supervised-flow UI — route through i18n. (S-030)",
        },
      ],
    },
  },
);
