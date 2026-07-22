import type { Agent } from '../../types';

const SURFACE_LABELS = {
  conversation: '季风',
  convection: '对流',
  cyclone: '气旋',
  tradewind: '信风',
  tide: '潮汐',
} as const;

type RuntimeAgent = Pick<Agent, 'busy' | 'activeSurfaces'>;

export interface AgentRuntimeStatus {
  tone: 'idle' | 'busy' | 'offline';
  label: '空闲' | '工作中' | '离线';
  surfaces: string;
}

export function getAgentRuntimeStatus(agent: RuntimeAgent, offline: boolean): AgentRuntimeStatus {
  if (offline) return { tone: 'offline', label: '离线', surfaces: '' };
  if (!agent.busy) return { tone: 'idle', label: '空闲', surfaces: '' };

  const active = new Set(agent.activeSurfaces ?? []);
  const surfaces = Object.entries(SURFACE_LABELS)
    .filter(([surface]) => active.has(surface as keyof typeof SURFACE_LABELS))
    .map(([, label]) => label)
    .join('、');
  return { tone: 'busy', label: '工作中', surfaces };
}
