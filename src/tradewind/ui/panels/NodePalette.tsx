/**
 * 节点拖拽面板 — 从这里拖出节点到画布
 */

import { CANVAS_NODE_ITEMS } from '../canvas/context-menu-model';

export function NodePalette() {
  const onDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData('application/tradewind-node', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="tw-palette">
      <div className="tw-palette__title">节点</div>
      <div className="tw-palette__items">
        {CANVAS_NODE_ITEMS.map((item) => (
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
