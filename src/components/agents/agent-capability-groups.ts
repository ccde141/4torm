import type { ToolDef } from '../../store/tools.js';

/** Persisted selection contracts; the server resolves each marker at invocation time. */
const ATOMIC_GROUPS = new Set(['tide', 'convection']);
const groupSwitch = (id: string) => `framework_capability_${id}`;

export type CapabilitySelectionState = 'off' | 'partial' | 'on';

export interface AgentCapabilityGroup {
  id: string;
  title: string;
  route: string;
  tools: ToolDef[];
}

export interface GroupedAgentTools {
  capabilities: AgentCapabilityGroup[];
  standalone: ToolDef[];
}

function trustedCapability(tool: ToolDef) {
  return tool.source === 'framework' ? tool.frameworkCapability : undefined;
}

export function groupAgentTools(tools: readonly ToolDef[]): GroupedAgentTools {
  const groups = new Map<string, AgentCapabilityGroup>();
  const standalone: ToolDef[] = [];
  for (const tool of tools) {
    const capability = trustedCapability(tool);
    if (!capability) {
      standalone.push(tool);
      continue;
    }
    const existing = groups.get(capability.id);
    if (existing) {
      existing.tools.push(tool);
      continue;
    }
    groups.set(capability.id, { ...capability, tools: [tool] });
  }
  return { capabilities: [...groups.values()], standalone };
}

export function getCapabilitySelectionState(
  group: AgentCapabilityGroup,
  selected: ReadonlySet<string>,
): CapabilitySelectionState {
  if (ATOMIC_GROUPS.has(group.id) && selected.has(groupSwitch(group.id))) return 'on';
  if (group.id === 'tide') {
    return group.tools.some(tool => selected.has(tool.name)) ? 'on' : 'off';
  }
  const count = group.tools.filter(tool => selected.has(tool.name)).length;
  if (count === 0) return 'off';
  return count === group.tools.length ? 'on' : 'partial';
}

export function toggleCapabilitySelection(
  group: AgentCapabilityGroup,
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  const state = getCapabilitySelectionState(group, selected);
  if (ATOMIC_GROUPS.has(group.id)) {
    for (const tool of group.tools) next.delete(tool.name);
    if (state === 'on') next.delete(groupSwitch(group.id));
    else next.add(groupSwitch(group.id));
    return next;
  }
  for (const tool of group.tools) {
    if (state === 'on') next.delete(tool.name);
    else next.add(tool.name);
  }
  return next;
}

export function normalizeCapabilitySelection(
  tools: readonly ToolDef[], selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  for (const group of groupAgentTools(tools).capabilities) {
    if (!ATOMIC_GROUPS.has(group.id)) continue;
    if (getCapabilitySelectionState(group, selected) !== 'on') continue;
    for (const tool of group.tools) next.delete(tool.name);
    next.add(groupSwitch(group.id));
  }
  return next;
}
