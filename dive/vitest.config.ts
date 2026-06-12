import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default to node; component tests that need the DOM opt in per file with a
    // `// @vitest-environment jsdom` docblock (jsdom is installed for that use).
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
