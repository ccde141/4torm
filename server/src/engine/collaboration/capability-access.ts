import { frameworkCapabilityToolName } from '../../shared/framework-capability.js';
import type { AgentCapabilityConfig } from './agent-gateway.js';
import type { CollaborationRouter } from './router.js';

const TIDE = frameworkCapabilityToolName('tide');
const GROUP_FEATURES = ['tide', 'convection', 'cyclone'] as const;

/** Older selected configs stored individual Tide actions; any one meant the Tide card was enabled. */
export function tideEnabled(agent: AgentCapabilityConfig, router: CollaborationRouter): boolean {
  if (agent.toolMode === 'all' || agent.tools.includes(TIDE)) return true;
  const selected = new Set(agent.tools);
  return router.listAgentTools().some(binding => binding.feature === 'tide'
    && selected.has(binding.definition.name));
}

function groupEnabled(agent: AgentCapabilityConfig, router: CollaborationRouter,
  feature: string): boolean {
  if (!GROUP_FEATURES.some(id => id === feature)) return false;
  return feature === 'tide' ? tideEnabled(agent, router)
    : agent.toolMode === 'all' || agent.tools.includes(frameworkCapabilityToolName(feature));
}

export function allowsAgentAction(
  agent: AgentCapabilityConfig, router: CollaborationRouter,
  feature: string, tool: string,
): boolean {
  return agent.toolMode === 'all' || agent.tools.includes(tool)
    || groupEnabled(agent, router, feature);
}

export function allowsCoordinationTool(
  agent: AgentCapabilityConfig, router: CollaborationRouter,
  tool: string, input?: unknown,
): boolean {
  if (agent.toolMode === 'all' || agent.tools.includes(tool)) return true;
  return input === undefined
    ? GROUP_FEATURES.some(feature => groupEnabled(agent, router, feature))
    : groupEnabled(agent, router, featureOf(input));
}

function featureOf(input: unknown): string {
  const feature = input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>).feature : undefined;
  return typeof feature === 'string' ? feature : '';
}
