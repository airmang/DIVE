import { useEffect, useId, useRef, useState } from "react";

interface MermaidApi {
  initialize: (config: { startOnLoad: false; theme: "dark"; securityLevel: "strict" }) => void;
  render: (id: string, chart: string) => Promise<{ svg: string }> | { svg: string };
}

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidInitialized = false;

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => module.default as MermaidApi);
  }
  const mermaid = await mermaidPromise;
  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
    mermaidInitialized = true;
  }
  return mermaid;
}

interface MermaidDiagramProps {
  chart: string;
  onNodeClick?: (id: string) => void;
  nodeIdResolver?: (rawId: string) => string | null | undefined;
}

function defaultNodeIdResolver(rawId: string): string {
  return rawId.replace(/^flowchart-/, "").replace(/-\d+$/, "");
}

export function MermaidDiagram({ chart, onNodeClick, nodeIdResolver }: MermaidDiagramProps) {
  const id = useId().replace(/:/g, "_");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSvg("");
    void loadMermaid()
      .then(async (mermaid) => {
        const rendered = await mermaid.render(`mermaid_${id}`, chart);
        if (!cancelled) setSvg(rendered.svg);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  useEffect(() => {
    if (!onNodeClick || !svg || !containerRef.current) return;
    const nodes = Array.from(
      containerRef.current.querySelectorAll<SVGGElement>('g.node[id^="flowchart-"]'),
    );
    const cleanups = nodes.flatMap((node) => {
      const stepId = (nodeIdResolver ?? defaultNodeIdResolver)(node.id);
      if (!stepId) return [];
      node.dataset.stepId = stepId;
      const listener = () => {
        const currentStepId = node.dataset.stepId;
        if (currentStepId) onNodeClick(currentStepId);
      };
      node.style.cursor = "pointer";
      node.addEventListener("click", listener);
      return [
        () => {
          node.removeEventListener("click", listener);
          node.style.cursor = "";
          delete node.dataset.stepId;
        },
      ];
    });
    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [nodeIdResolver, onNodeClick, svg]);

  if (loading) {
    return (
      <div
        className="flex min-h-48 items-center justify-center rounded-md border bg-bg p-3 text-xs text-fg-muted"
        data-testid="mermaid-loading"
      >
        Loading diagram...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-48 rounded-md border border-warn/40 bg-warn/10 p-3 text-xs text-fg"
        data-testid="mermaid-error"
      >
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="min-h-48 overflow-auto rounded-md border bg-bg p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
      data-testid="plan-dag"
    />
  );
}
