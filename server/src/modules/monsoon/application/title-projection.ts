export interface MonsoonTitleSource {
  titles(agentId: string): Promise<ReadonlyMap<string, string>>;
}

export async function loadSessionTitles(
  items: readonly { agentId?: string }[], source?: MonsoonTitleSource,
): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
  const result = new Map<string, ReadonlyMap<string, string>>();
  if (!source) return result;
  const agentIds = new Set(items.map(item => item.agentId).filter(
    (value): value is string => typeof value === 'string'));
  for (const agentId of agentIds) result.set(agentId, await source.titles(agentId));
  return result;
}

export function sessionTitle(
  agentId: string | undefined, sessionId: string, fallback: string,
  titles: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string {
  return (agentId && titles.get(agentId)?.get(sessionId)) || fallback;
}
