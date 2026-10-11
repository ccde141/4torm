import { frameworkError } from '../shared/framework-error.js';
import type { AgentActivitySnapshot } from '../shared/agent-activity.js';
import type { CollaborationContext } from './contracts.js';

export interface AgentPresencePort {
  read(): Map<string, AgentActivitySnapshot> | Promise<Map<string, AgentActivitySnapshot>>;
}

export interface AgentPresenceSnapshot {
  schemaVersion: 1;
  observedAt: string;
  completeness: 'complete';
  agents: Record<string, AgentActivitySnapshot>;
}

export async function readAgentPresence(
  port: AgentPresencePort | undefined, context: CollaborationContext,
): Promise<AgentPresenceSnapshot> {
  if (!context.permissions.has('observe')) throw presenceError(
    'AGENT_PRESENCE_DENIED', 'permission', '当前调用方无权观察 Agent 活动状态');
  if (!port) throw presenceError(
    'AGENT_PRESENCE_UNAVAILABLE', 'internal', 'Agent 活动状态源未安装');
  let entries: Map<string, AgentActivitySnapshot>;
  try { entries = await port.read(); }
  catch (cause) { throw presenceError(
    'AGENT_PRESENCE_READ_FAILED', 'internal', 'Agent 活动状态读取失败', cause); }
  if (!(entries instanceof Map) || [...entries].some(([id, activity]) =>
    typeof id !== 'string' || !id.trim() || !validActivity(activity))) throw presenceError(
    'AGENT_PRESENCE_INVALID', 'internal', 'Agent 活动状态不符合协议');
  return {
    schemaVersion: 1, observedAt: new Date().toISOString(), completeness: 'complete',
    agents: Object.fromEntries([...entries].map(([id, activity]) => [id, {
      busy: activity.busy, surfaces: [...activity.surfaces],
    }])),
  };
}

function validActivity(value: AgentActivitySnapshot): boolean {
  const surfaces = ['conversation', 'convection', 'cyclone', 'tradewind', 'tide'];
  return value && typeof value.busy === 'boolean' && Array.isArray(value.surfaces)
    && value.surfaces.every(surface => surfaces.includes(surface))
    && value.busy === (value.surfaces.length > 0);
}

function presenceError(
  code: string, kind: 'permission' | 'internal', message: string, cause?: unknown,
) {
  return frameworkError({ code, kind, message,
    source: 'collaboration.presence', retryable: false },
  cause === undefined ? undefined : { cause });
}
