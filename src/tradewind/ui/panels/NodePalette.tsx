/**
 * 节点拖拽面板 — 从这里拖出节点到画布
 */

import { CANVAS_NODE_ITEMS } from '../canvas/context-menu-model';
import { useLocale } from '../../../i18n/LocaleContext';

export function NodePalette() {
  const { t } = useLocale();
  const onDragStart = (event: React.DragEvent, type: string) => {
    event.dataTransfer.setData('application/tradewind-node', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="tw-palette">
      <div className="tw-palette__title">{t('tradewind.canvas.palette.nodes')}</div>
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
            <span className="tw-palette__label">{t(item.labelKey)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
