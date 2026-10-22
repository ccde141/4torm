export const CANVAS_NODE_ITEMS = [
  { type: 'entry', labelKey: 'tradewind.canvas.node.entry', icon: '▶', color: 'var(--color-accent)' },
  { type: 'agent', labelKey: 'tradewind.canvas.node.agent', icon: '⚡', color: 'var(--color-accent-secondary)' },
  { type: 'meeting', labelKey: 'tradewind.canvas.node.meeting', icon: '◎', color: '#a855f7' },
  { type: 'human-gate', labelKey: 'tradewind.canvas.node.gate', icon: '◇', color: '#eab308' },
  { type: 'note', labelKey: 'tradewind.canvas.node.note', icon: '📝', color: '#fbbf24' },
  { type: 'output', labelKey: 'tradewind.canvas.node.output', icon: '◼', color: 'var(--color-success)' },
] as const;

export function nodeItemsForMode(orchestration: 'strict' | 'handoff') {
  return CANVAS_NODE_ITEMS.filter(item => orchestration !== 'handoff' || item.type !== 'meeting');
}

export function contextMenuKind(target: {
  nodeId: string | null;
  edgeId: string | null;
}): 'node' | 'edge' | 'pane' {
  if (target.nodeId) return 'node';
  if (target.edgeId) return 'edge';
  return 'pane';
}
