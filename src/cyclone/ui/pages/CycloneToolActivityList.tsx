import { Fragment, type ReactNode } from 'react';
import {
  partitionCycloneToolActivity,
  type CycloneToolActivityItem,
} from './cyclone-tool-activity';
import './cyclone-tool-activity.css';

function Group<T extends CycloneToolActivityItem>({ items, renderItem, offset }: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  offset: number;
}) {
  const failed = items.filter(item => item.status === 'error').length;
  const running = items.some(item => item.status === 'running' || item.status === 'pending');
  const state = failed ? `${failed} 项失败` : running ? '正在执行' : '已完成';
  return (
    <details className="cyclone-tool-activity" open={failed > 0}>
      <summary className="cyclone-tool-activity__summary">
        <span className="cyclone-tool-activity__arrow">▶</span>
        <span>{items.length} 项工具操作</span>
        <span className="cyclone-tool-activity__state">{state}</span>
        {running && <span className="thinking-card__tool-spinner" />}
      </summary>
      <div className="cyclone-tool-activity__body">
        {items.map((item, index) => renderItem(item, offset + index))}
      </div>
    </details>
  );
}

export default function CycloneToolActivityList<T extends CycloneToolActivityItem>({ items, renderItem }: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
}) {
  let offset = 0;
  return partitionCycloneToolActivity(items).map((part, partIndex) => {
    const start = offset;
    offset += part.items.length;
    if (part.kind === 'single') {
      return <Fragment key={partIndex}>{renderItem(part.items[0], start)}</Fragment>;
    }
    return <Group key={partIndex} items={part.items} renderItem={renderItem} offset={start} />;
  });
}
