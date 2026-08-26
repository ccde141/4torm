import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';

type Activity = {
  tool?: string;
  status?: string;
};

export default function TwToolActivityGroup<T extends Activity>({ items, renderItem }: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const { t } = useLocale();
  const running = items.some(item => item.status === 'running' || item.status === 'pending');
  const failed = items.some(item => item.status === 'error');
  const [open, setOpen] = useState(running);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (running && !wasRunning.current) setOpen(true);
    wasRunning.current = running;
  }, [running]);
  if (items.length < 2) return <>{items.map(renderItem)}</>;
  const state = running ? t('tradewind.chat.tools.running')
    : failed ? t('tradewind.chat.tools.partialFailure') : t('tradewind.chat.tools.completed');

  return (
    <details className="tw-tool-activity" open={open}
      onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="tw-tool-activity__summary">
        <span className="tw-tool-activity__arrow">›</span>
        <span>{t('tradewind.chat.tools.activity', { count: items.length })}</span>
        <span className="tw-tool-activity__state">{state}</span>
      </summary>
      <div className="tw-tool-activity__body">{items.map(renderItem)}</div>
    </details>
  );
}
