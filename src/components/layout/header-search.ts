import { backendFetch } from '../../lib/backend-client';
import { getAgents } from '../../store/agent';
import { getAllSessions } from '../../store/chat';
import { listWorkflows } from '../../tradewind/ui/workflow-client';

export type SearchType = 'agent' | 'session' | 'cyclone' | 'tradewind' | 'tide' | 'convection';
export interface SearchResult {
  type: SearchType; id: string; label: string; sublabel: string;
  detail?: { key: 'header.searchWorkshopCounts' | 'header.searchNodeCount'; values: Record<string, number> };
}
export interface HeaderSearchSources {
  agents: readonly { id: string; name: string; role?: string; description?: string }[];
  sessions: readonly { id: string; title: string; agentName?: string }[];
  cyclones: unknown; workflows: unknown; tasks: unknown; discussions: unknown;
}

/** Search stores semantic data; translating at render time also updates an open dropdown. */
export function projectHeaderSearch(query: string, sources: HeaderSearchSources): SearchResult[] {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  const hit = (...fields: (string | undefined)[]) => fields.some(value => value?.toLowerCase().includes(term));
  return [
    ...sources.agents.filter(item => hit(item.name, item.role, item.description))
      .map(item => ({ type: 'agent' as const, id: item.id, label: item.name, sublabel: item.role ?? '' })),
    ...sources.sessions.filter(item => hit(item.title, item.agentName))
      .map(item => ({ type: 'session' as const, id: item.id, label: item.title, sublabel: item.agentName ?? '' })),
    ...rows(sources.cyclones).filter(item => text(item, 'id') && hit(text(item, 'title')))
      .map(item => ({ type: 'cyclone' as const, id: text(item, 'id'), label: text(item, 'title'), sublabel: '',
        detail: { key: 'header.searchWorkshopCounts' as const,
          values: { seats: count(item, 'seatCount'), rooms: count(item, 'roomCount') } } })),
    ...rows(sources.workflows).filter(item => text(item, 'workflowId') && hit(text(item, 'name')))
      .map(item => ({ type: 'tradewind' as const, id: text(item, 'workflowId'), label: text(item, 'name'), sublabel: '',
        detail: { key: 'header.searchNodeCount' as const, values: { count: count(item, 'nodeCount') } } })),
    ...rows(sources.tasks).filter(item => text(item, 'id') && hit(text(item, 'name'), text(item, 'prompt')))
      .map(item => ({ type: 'tide' as const, id: text(item, 'id'), label: text(item, 'name'), sublabel: text(item, 'schedule') })),
    ...rows(sources.discussions).filter(item => text(item, 'id') && hit(text(item, 'title'), text(item, 'topic')))
      .map(item => ({ type: 'convection' as const, id: text(item, 'id'), label: text(item, 'title'), sublabel: text(item, 'topic') })),
  ];
}

export async function readHeaderSearch(query: string, signal: AbortSignal): Promise<SearchResult[]> {
  const results = await Promise.allSettled([getAgents(), getAllSessions(),
    readJson('/api/cyclone/list', signal), listWorkflows(),
    readJson('/api/tide/tasks', signal), readJson('/api/convection/list', signal)]);
  if (results.every(result => result.status === 'rejected')) throw new Error('HEADER_SEARCH_UNAVAILABLE');
  return projectHeaderSearch(query, { agents: value(results[0]) ?? [], sessions: value(results[1]) ?? [],
    cyclones: value(results[2]), workflows: value(results[3]), tasks: value(results[4]), discussions: value(results[5]) });
}
async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await backendFetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function value<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined;
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> =>
    !!item && typeof item === 'object' && !Array.isArray(item)) : [];
}
function text(item: Record<string, unknown>, key: string): string {
  return typeof item[key] === 'string' ? item[key] : '';
}
function count(item: Record<string, unknown>, key: string): number {
  return typeof item[key] === 'number' && Number.isFinite(item[key]) && item[key] >= 0 ? item[key] : 0;
}
