import type { ToolDef } from '../../store/tools.js';

export interface CatalogCapabilityGroup {
  id: string;
  title: string;
  route: string;
  tools: ToolDef[];
}

export interface GroupedCatalogTools {
  capabilities: CatalogCapabilityGroup[];
  standalone: ToolDef[];
}

/** Both catalog browsing and Agent selection use the server-owned capability identity. */
export function groupCatalogTools(tools: readonly ToolDef[]): GroupedCatalogTools {
  const groups = new Map<string, CatalogCapabilityGroup>();
  const standalone: ToolDef[] = [];
  for (const tool of tools) {
    const capability = tool.source === 'framework' ? tool.frameworkCapability : undefined;
    if (!capability) {
      standalone.push(tool);
      continue;
    }
    const existing = groups.get(capability.id);
    if (existing) existing.tools.push(tool);
    else groups.set(capability.id, { ...capability, tools: [tool] });
  }
  return { capabilities: [...groups.values()], standalone };
}

export function canEditCatalogTool(tool: Pick<ToolDef, 'source' | 'readonly'>): boolean {
  return tool.source === 'custom' && tool.readonly === false;
}
