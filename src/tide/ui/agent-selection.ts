interface IdentifiedAgent {
  id: string;
}

export function reconcileSelectedAgent<T extends IdentifiedAgent>(
  selected: T | null,
  agents: readonly T[],
): T | null {
  if (!selected) return null;
  return agents.find(agent => agent.id === selected.id) ?? null;
}
