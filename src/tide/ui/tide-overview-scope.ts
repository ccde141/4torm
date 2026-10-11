export interface ScopedTideOverview<TTask, TProbe> {
  agentId: string | null;
  tasks: TTask[];
  probes: TProbe[];
}

export function visibleTideOverview<TTask, TProbe>(
  snapshot: ScopedTideOverview<TTask, TProbe>, agentId: string | null,
): Pick<ScopedTideOverview<TTask, TProbe>, 'tasks' | 'probes'> {
  return snapshot.agentId === agentId
    ? { tasks: snapshot.tasks, probes: snapshot.probes }
    : { tasks: [], probes: [] };
}
