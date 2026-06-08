/**
 * 节点拖拽面板 — 从这里拖出节点到画布
 *
 * 注意：human-gate 节点已封存（封存原因见 TODO-human-gate-restart.md），
 * 暂不在 UI 中暴露。后端 executor + validator 仍保留，待重新启封时直接放开此选项。
 */

const NODE_ITEMS = [
  { type: 'entry', label: '入口', icon: '▶', color: 'var(--color-accent)' },
  { type: 'agent', label: 'Agent', icon: '⚡', color: 'var(--color-accent-secondary)' },
  { type: 'meeting', label: '会议室', icon: '◎', color: '#a855f7' },
  // { type: 'human-gate', label: '人类审查', icon: '◇', color: '#eab308' }, // 封存
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
