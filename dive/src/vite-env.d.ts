/// <reference types="vite/client" />

declare module "mermaid" {
  const mermaid: {
    initialize: (config: { startOnLoad: false; theme: "dark"; securityLevel: "strict" }) => void;
    render: (id: string, chart: string) => Promise<{ svg: string }> | { svg: string };
  };
  export default mermaid;
}
