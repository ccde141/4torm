import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { isFrameworkTool, partitionToolActivity, type ToolActivityLike } from './tool-activity-group';
import { useLocale } from '../../i18n/LocaleContext';
import { toolActivitySummary } from './tool-activity-summary';
import { worklogRunStart, worklogWindow } from './worklog-window';
import WorklogPager from './WorklogPager';

export interface ToolActivityItem extends ToolActivityLike {
  status?: string;
  args?: Record<string, unknown>;
}

const MAX_AUTO_OPEN_FAILED_ITEMS = 20;

function targetOf(item: ToolActivityItem): string {
  return toolActivitySummary(item.tool, item.args);
}

function Group<T extends ToolActivityItem>({ items, renderItem, stopped }: {
  stopped?: boolean;
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const { t, locale } = useLocale();
  const failed = items.filter(item => item.status === 'error').length;
  const autoOpenFailure = failed > 0 && items.length <= MAX_AUTO_OPEN_FAILED_ITEMS;
  const [open, setOpen] = useState(autoOpenFailure);
  useEffect(() => { if (autoOpenFailure) setOpen(true); }, [autoOpenFailure, failed]);
  const running = items.findLast(item => item.status === 'running' || item.status === 'pending');
  const current = running || items.at(-1)!;
  const target = targetOf(current);
  const state = stopped && running ? (locale === 'en-US' ? 'Stopped · result not received' : '已停止 · 尚未收到结果') : failed
    ? t('chat.tool.failedCount', { count: failed })
    : running ? t('chat.tool.running', { tool: current.tool }) : t('chat.tool.completed');
  return (
    <details className="tool-activity-group" open={open}
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="tool-activity-group__summary">
        <span className="tool-activity-group__arrow">▶</span>
        <span>{t('chat.tool.operationCount', { count: items.length })}</span>
        <span className="tool-activity-group__state">{state}</span>
        {target && <span className="tool-activity-group__target" title={target}>{target}</span>}
        {running && !stopped && <span className="thinking-card__tool-spinner" />}
      </summary>
      {open && <div className="tool-activity-group__body">{items.map(renderItem)}</div>}
    </details>
  );
}

export default function ToolActivityList<T extends ToolActivityItem>({ items, renderItem, stopped, offset = 0, source = items }: {
  stopped?: boolean;
  items: T[];
  /** Full tool source and absolute offset when the caller already selected a display window. */
  source?: readonly T[];
  offset?: number;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const [selectedEnd, select] = useState<number | null>(null);
  const page = worklogWindow(items, selectedEnd);
  let consumed = 0;
  return <><WorklogPager page={page} select={select} />{partitionToolActivity(page.items).map(part => {
    const start = page.start + consumed;
    consumed += part.items.length;
    const absoluteStart = offset + start;
    const ordinary = !isFrameworkTool(part.items[0].tool);
    const anchor = worklogRunStart(source, absoluteStart, item => !isFrameworkTool(item.tool));
    const next = source[absoluteStart + part.items.length];
    const continues = ordinary && (anchor < absoluteStart || (next && !isFrameworkTool(next.tool)));
    if (part.kind === 'single' && !continues) return <Fragment key={`tool-${absoluteStart}`}>{renderItem(part.items[0], start)}</Fragment>;
    return <Group key={`group-${anchor}`} items={part.items} stopped={stopped} renderItem={(item, index) => renderItem(item, start + index)} />;
  })}</>;
}
