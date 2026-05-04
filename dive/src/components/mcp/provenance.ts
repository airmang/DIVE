const MCP_PREFIX = "mcp__";

export interface McpProvenance {
  serverLabel: string;
  remoteName: string;
}

export function parseMcpProvenance(name: string): McpProvenance | null {
  if (!name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep < 0) return null;
  return { serverLabel: rest.slice(0, sep), remoteName: rest.slice(sep + 2) };
}
