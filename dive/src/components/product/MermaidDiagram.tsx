import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";

interface MermaidApi {
  initialize: (config: { startOnLoad: false; theme: "dark"; securityLevel: "strict" }) => void;
  render: (id: string, chart: string) => Promise<{ svg: string }> | { svg: string };
}

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });

function loadMermaid(): Promise<MermaidApi | null> {
  return Promise.resolve(mermaid as MermaidApi);
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

  useEffect(() => {
    let cancelled = false;
    void loadMermaid().then(async (mermaid) => {
      if (!mermaid) return;
      const rendered = await mermaid.render(`mermaid_${id}`, chart);
      if (!cancelled) setSvg(rendered.svg);
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

  return (
    <div
      ref={containerRef}
      className="min-h-48 overflow-auto rounded-md border bg-bg p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
      data-testid="plan-dag"
    />
  );
}
