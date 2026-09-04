interface SelectionNode {
  id: string;
  type?: string;
}

export function reconcileSelectedSeatIds(current: string[], nodes: SelectionNode[]): string[] {
  const next = nodes
    .filter(node => node.type === 'seat')
    .map(node => node.id)
    .sort();
  const normalizedCurrent = [...current].sort();
  const unchanged = normalizedCurrent.length === next.length
    && normalizedCurrent.every((id, index) => id === next[index]);
  return unchanged ? current : next;
}
