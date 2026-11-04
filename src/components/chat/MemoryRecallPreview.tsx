import { useLocale } from '../../i18n/LocaleContext';
import { useId, useState, type ReactNode } from 'react';
import { memoryRecallLabel, type MemoryReference } from './memory-references';

export function HumanMemoryGroup({ sources, children, messageId }: { sources?: readonly MemoryReference[]; children: ReactNode; messageId: string }) {
  return <div className="monsoon-recall-turn"><MemoryRecallPreview sources={sources} messageId={messageId} />{children}</div>;
}

export default function MemoryRecallPreview({ sources, messageId }: { sources?: readonly MemoryReference[]; messageId: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const label = t(memoryRecallLabel(messageId));
  if (!sources?.length) return null;
  return <aside className="monsoon-recall" aria-label={label}>
      <button className="monsoon-recall__toggle" type="button" aria-expanded={open} aria-controls={contentId}
        onClick={() => setOpen(value => !value)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M12 5a3 3 0 0 0-5-2 4 4 0 0 0-4 6 4 4 0 0 0 0 6 4 4 0 0 0 4 6 3 3 0 0 0 5-2V5Zm0 0a3 3 0 0 1 5-2 4 4 0 0 1 4 6 4 4 0 0 1 0 6 4 4 0 0 1-4 6 3 3 0 0 1-5-2M7 9H4m3 6H4m13-6h3m-3 6h3" />
        </svg>
        <span className="monsoon-recall__label">{label}</span>
        <span className="monsoon-recall__titles">{sources.map(source => source.title).join(' · ')}</span>
        <span className="monsoon-recall__count">{sources.length}</span>
        <svg className="monsoon-recall__chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      <div className="monsoon-recall__reveal" data-open={open} aria-hidden={!open} inert={!open}>
      <div className="monsoon-recall__clip">
      <div className="monsoon-recall__sources" id={contentId} role="region" aria-label={label}>
        {sources.map(source => <article key={`${source.id}:${source.revision}`}>
          <header><strong>{source.title}</strong><span>{source.level} · {t(source.level === 'L2' ? 'recall.selectedSource' : 'recall.indexedSource')}</span></header>
          <p>{source.text}</p>
          <footer><span>{t(source.kind === 'work' ? 'recall.workSource' : 'recall.memorySource')}</span>
            {source.scope && <span>{source.scope}</span>}{source.date && <time>{source.date}</time>}
            {source.sequence && <span>{t('recall.recordNumber', { number: source.sequence })}</span>}</footer>
        </article>)}
      </div>
      </div></div>
  </aside>;
}
