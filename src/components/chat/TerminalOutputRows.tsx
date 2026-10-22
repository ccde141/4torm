import { useMemo, useState } from 'react';
import BoundedText from '../../engine/text-display/BoundedText';
import { useLocale } from '../../i18n/LocaleContext';
import { renderTerminalLines, type TerminalChunk } from './terminal-output';

const PAGE_LINES = 400;

/** The observation is a rolling log; mount one line page, not every received line. */
export default function TerminalOutputRows({ chunks }: { chunks: TerminalChunk[] }) {
  const { t } = useLocale();
  const lines = useMemo(() => renderTerminalLines(chunks), [chunks]);
  const [chosen, setChosen] = useState<number | null>(null);
  const last = Math.max(0, Math.ceil(lines.length / PAGE_LINES) - 1);
  const page = chosen === null ? last : Math.min(chosen, last);
  const shown = lines.slice(page * PAGE_LINES, (page + 1) * PAGE_LINES);
  return <>
    {last > 0 && <nav style={navigationStyle} aria-label={t('chat.tool.result')}>
      <button type="button" disabled={page === 0} onClick={() => setChosen(page - 1)}>{t('chat.page.previousPage')}</button>
      <span>{page + 1} / {last + 1}</span>
      <button type="button" disabled={page === last} onClick={() => setChosen(page + 1)}>{t('chat.page.nextPage')}</button>
      <button type="button" onClick={() => setChosen(null)}>{t('chat.execution.latestOutput')}</button>
    </nav>}
    {shown.length ? shown.map((line, index) => <div key={`${page}-${index}`}
      style={line.stream === 'stderr' ? { color: '#eeaaa1' } : undefined}>
      <BoundedText text={line.text || ' '} />
    </div>) : t('chat.execution.waitingOutput')}
  </>;
}

const navigationStyle: React.CSSProperties = {
  display: 'flex', gap: 'var(--space-2)', alignItems: 'center',
  marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)',
};
