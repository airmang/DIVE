import { useEffect, useId, useState } from "react";
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
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const id = useId().replace(/:/g, "_");
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

  return (
    <div
      className="min-h-48 overflow-auto rounded-md border bg-bg p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
      data-testid="plan-dag"
    />
  );
}
