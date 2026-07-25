import { Fragment, type ReactNode } from 'react';
import { partitionToolActivity, type ToolActivityLike } from './tool-activity-group';

export interface ToolActivityItem extends ToolActivityLike {
  status?: string;
  args?: Record<string, unknown>;
}

function targetOf(item: ToolActivityItem): string {
  const args = item.args || {};
  for (const key of ['filePath', 'path', 'command', 'query', 'url']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function Group<T extends ToolActivityItem>({ items, renderItem }: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const failed = items.filter(item => item.status === 'error').length;
  const running = items.findLast(item => item.status === 'running' || item.status === 'pending');
  const current = running || items.at(-1)!;
  const target = targetOf(current);
  const state = failed ? `${failed} 项失败` : running ? `正在执行 ${current.tool}` : '已完成';
  return (
    <details className="tool-activity-group" open={failed > 0}>
      <summary className="tool-activity-group__summary">
        <span className="tool-activity-group__arrow">▶</span>
        <span>{items.length} 项工具操作</span>
        <span className="tool-activity-group__state">{state}</span>
        {target && <span className="tool-activity-group__target" title={target}>{target}</span>}
        {running && <span className="thinking-card__tool-spinner" />}
      </summary>
      <div className="tool-activity-group__body">{items.map(renderItem)}</div>
    </details>
  );
}

export default function ToolActivityList<T extends ToolActivityItem>({ items, renderItem }: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
}) {
  let offset = 0;
  return partitionToolActivity(items).map((part, partIndex) => {
    const start = offset;
    offset += part.items.length;
    if (part.kind === 'single') return <Fragment key={partIndex}>{renderItem(part.items[0], start)}</Fragment>;
    return <Group key={partIndex} items={part.items} renderItem={(item, index) => renderItem(item, start + index)} />;
  });
}
