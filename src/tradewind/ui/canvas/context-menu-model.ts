export const CANVAS_NODE_ITEMS = [
  { type: 'entry', label: '入口', icon: '▶', color: 'var(--color-accent)' },
  { type: 'agent', label: 'Agent', icon: '⚡', color: 'var(--color-accent-secondary)' },
  { type: 'meeting', label: '会议室', icon: '◎', color: '#a855f7' },
  { type: 'human-gate', label: '暂停点', icon: '◇', color: '#eab308' },
  { type: 'note', label: 'Note', icon: '📝', color: '#fbbf24' },
  { type: 'output', label: '出口', icon: '◼', color: 'var(--color-success)' },
] as const;

export function contextMenuKind(target: {
  nodeId: string | null;
  edgeId: string | null;
}): 'node' | 'edge' | 'pane' {
  if (target.nodeId) return 'node';
  if (target.edgeId) return 'edge';
  return 'pane';
}
