/**
 * 节点拖拽面板 — 从这里拖出节点到画布
 */

const NODE_ITEMS = [
  { type: 'entry', label: '入口', icon: '▶', color: 'var(--color-accent)' },
  { type: 'agent', label: 'Agent', icon: '⚡', color: 'var(--color-accent-secondary)' },
  { type: 'meeting', label: '会议室', icon: '◎', color: '#a855f7' },
  { type: 'human-gate', label: '暂停点', icon: '◇', color: '#eab308' },
  { type: 'note', label: 'Note', icon: '📝', color: '#fbbf24' },
  { type: 'output', label: '出口', icon: '◼', color: 'var(--color-success)' },
] as const;

export function NodePalette() {
  const onDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData('application/tradewind-node', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="tw-palette">
      <div className="tw-palette__title">节点</div>
      <div className="tw-palette__items">
        {NODE_ITEMS.map((item) => (
          <div
            key={item.type}
            className="tw-palette__item"
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
          >
            <span
              className="tw-palette__icon"
              style={{ color: item.color }}
            >
              {item.icon}
            </span>
            <span className="tw-palette__label">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
