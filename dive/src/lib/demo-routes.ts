export type DemoRoute =
  | "showcase"
  | "workmap-demo"
  | "chat-demo"
  | "permission-demo"
  | "slide-in-demo"
  | "scenario-a-demo"
  | "scenario-b-demo"
  | "tool-guard-demo"
  | "provisioning-demo"
  | "timeline-demo"
  | "toast-demo"
  | "polish-demo"
  | "export-demo"
  | "phase5-integration"
  | "mcp-demo";

export const DEMO_ALIASES: Record<string, DemoRoute> = {
  showcase: "showcase",
  workmap: "workmap-demo",
  "workmap-demo": "workmap-demo",
  chat: "chat-demo",
  "chat-demo": "chat-demo",
  permission: "permission-demo",
  "permission-demo": "permission-demo",
  "slide-in": "slide-in-demo",
  "slide-in-demo": "slide-in-demo",
  "scenario-a": "scenario-a-demo",
  "scenario-a-demo": "scenario-a-demo",
  "scenario-b": "scenario-b-demo",
  "scenario-b-demo": "scenario-b-demo",
  "tool-guard": "tool-guard-demo",
  "tool-guard-demo": "tool-guard-demo",
  provisioning: "provisioning-demo",
  "provisioning-demo": "provisioning-demo",
  timeline: "timeline-demo",
  "timeline-demo": "timeline-demo",
  toast: "toast-demo",
  "toast-demo": "toast-demo",
  polish: "polish-demo",
  "polish-demo": "polish-demo",
  export: "export-demo",
  "export-demo": "export-demo",
  phase5: "phase5-integration",
  "phase5-integration": "phase5-integration",
  mcp: "mcp-demo",
  "mcp-demo": "mcp-demo",
};

export function resolveDemoRouteValue(value: string | null): DemoRoute | null {
  return value ? (DEMO_ALIASES[value] ?? null) : null;
}

export function hasRecognizedDemoRoute(
  search = typeof window === "undefined" ? "" : window.location.search,
): boolean {
  const params = new URLSearchParams(search);
  return resolveDemoRouteValue(params.get("demo")) !== null;
}
