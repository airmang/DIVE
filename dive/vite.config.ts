import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          // Locale JSON (src/i18n/{ko,en}.json) is statically imported by every
          // route, so it stays in the eagerly-loaded module graph either way —
          // this only relocates it out of index-*.js into its own chunk file
          // (same mechanism as the vendor-* splits below: a real ES `import`
          // between chunks, resolved before index.js's top level runs, so
          // resources.ko/en are populated exactly as synchronously as before).
          if (/\/src\/i18n\/(ko|en)\.json$/.test(normalized)) return "locale-data";
          const marker = "node_modules/";
          const lastIdx = normalized.lastIndexOf(marker);
          if (lastIdx === -1) return undefined;
          // Resolve through pnpm's `.pnpm/<pkg>@<version>_<peers>/node_modules/<pkg>`
          // store layout to the real package name — matching on the raw id
          // substring is unsafe because the pnpm hash segment (and peer-dep
          // suffixes like `_react@18.3.1`) can contain unrelated package names
          // as substrings (e.g. "lucide-react" and "@radix-ui/react-dialog"
          // both contain "react", so a naive `id.includes("react")` check
          // swallows them into vendor-react before their own branch runs).
          const rest = normalized.slice(lastIdx + marker.length);
          const pkg = rest.match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[1] ?? "";
          if (pkg === "lucide-react") return "vendor-icons";
          if (pkg === "react" || pkg === "react-dom" || pkg === "scheduler") return "vendor-react";
          if (pkg.startsWith("@radix-ui/")) return "vendor-radix";
          if (pkg.startsWith("@tauri-apps/")) return "vendor-tauri";
          return "vendor";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
