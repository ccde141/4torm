import { useId, useState, type ReactNode } from 'react';
import BoundedText from '../../engine/text-display/BoundedText';
import { useLocale } from '../../i18n/LocaleContext';
import { compactionHistoryContent } from './compaction-history';

/** Saved history shares one quiet divider; its potentially long body mounts only on request. */
export function CompactionHistory({ content, children, handoff = false }: {
  content: string; children?: ReactNode; handoff?: boolean;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="compaction-history">
    <div className="compaction-history__divider">
      <span className="compaction-history__line" aria-hidden="true" />
      <button type="button" className="compaction-history__toggle" aria-expanded={open}
        aria-controls={id} onClick={() => setOpen(value => !value)}>{handoff
          ? (locale === 'en-US' ? 'Context compacted · View handoff' : '上下文已压缩 · 查看交接')
          : t('compaction.history')}</button>
      <span className="compaction-history__line" aria-hidden="true" />
    </div>
    {open && <div id={id} className="compaction-history__body">
      <BoundedText text={compactionHistoryContent(content)} />
      {children}
    </div>}
  </div>;
}
