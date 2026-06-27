import type { PreviewSessionState } from "./types";

export type PreviewModeHint = "static" | "server";

export function previewModeHint(
  kind: PreviewSessionState["kind"] | null | undefined,
): PreviewModeHint | null {
  if (kind === "static_file") return "static";
  if (kind === "local_url" || kind === "dev_server") return "server";
  return null;
}
