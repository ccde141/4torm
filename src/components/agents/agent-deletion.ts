import type { Agent } from '../../types';

interface DeletionEvents {
  onPendingChange(ids: Set<string>): void;
  onDeleted(id: string): void;
  onError(error: Error): void;
}

export function createAgentDeletionFlow(
  deleteAgent: (id: string) => Promise<void>, events: DeletionEvents,
) {
  const pending = new Set<string>();
  const deleted = new Set<string>();
  return {
    visibleAgents(agents: Agent[]): Agent[] {
      const present = new Set(agents.map(agent => agent.id));
      for (const id of deleted) if (!present.has(id)) deleted.delete(id);
      return agents.filter(agent => !deleted.has(agent.id));
    },
    async remove(id: string): Promise<void> {
      if (pending.has(id) || deleted.has(id)) return;
      pending.add(id);
      events.onPendingChange(new Set(pending));
      try {
        await deleteAgent(id);
        deleted.add(id);
        events.onDeleted(id);
      } catch (error) {
        events.onError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        pending.delete(id);
        events.onPendingChange(new Set(pending));
      }
    },
  };
}
