import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
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
  const { t } = useLocale();
  const failed = items.filter(item => item.status === 'error').length;
  const running = items.some(item => item.status === 'running' || item.status === 'pending');
  const [open, setOpen] = useState(failed > 0);
  const wasFailed = useRef(failed > 0);
  useEffect(() => {
    if (failed > 0 && !wasFailed.current) setOpen(true);
    wasFailed.current = failed > 0;
  }, [failed]);
  const state = failed ? t('cyclone.activity.failed', { count: failed })
    : running ? t('cyclone.activity.running') : t('cyclone.activity.completed');
  return (
    <details className="cyclone-tool-activity" open={open}
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cyclone-tool-activity__summary">
        <span className="cyclone-tool-activity__arrow">▶</span>
        <span>{t('chat.tool.operationCount', { count: items.length })}</span>
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
