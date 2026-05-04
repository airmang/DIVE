import { Plug } from "lucide-react";
import { Badge } from "../ui/badge";
import { parseMcpProvenance } from "./provenance";

export function McpProvenanceBadge({ name }: { name: string }) {
  const prov = parseMcpProvenance(name);
  if (!prov) return null;
  return (
    <Badge
      variant="info"
      className="gap-1"
      data-testid="mcp-provenance"
      data-mcp-server={prov.serverLabel}
      data-mcp-remote={prov.remoteName}
    >
      <Plug className="h-3 w-3" aria-hidden />
      MCP · {prov.serverLabel}
    </Badge>
  );
}
