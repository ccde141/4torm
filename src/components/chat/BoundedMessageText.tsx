import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { renderTextWithCode } from '../../engine/markdown';
import { useLocale } from '../../i18n/LocaleContext';
import { messagePageOffsets } from './message-page';

const MARKDOWN_LIMIT = 32_000;
const PAGE_CHARS = 16_384;

/** Large messages remain intact in session data, but mount only one raw-text page at a time. */
export default function BoundedMessageText({ text, id }: { text: string; id: string }) {
  const { t } = useLocale();
  const [page, setPage] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const navigation = useRef(false);
  const offsets = useMemo(() => messagePageOffsets(text, PAGE_CHARS), [text]);
  const current = Math.min(page, Math.max(0, offsets.length - 2));
  useLayoutEffect(() => {
    if (!navigation.current) return;
    navigation.current = false;
    root.current?.scrollIntoView({ block: 'start' });
  }, [current]);
  if (text.length <= MARKDOWN_LIMIT) return <>{renderTextWithCode(text, id)}</>;

  const lastPage = offsets.length - 2;
  const goTo = (next: number) => { navigation.current = true; setPage(next); };
  return <div ref={root} className="chat__long-text">
    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)',
      marginBottom: 'var(--space-2)' }}>
      {t('chat.page.longOriginal', { page: current + 1, total: lastPage + 1 })}
    </div>
    <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {text.slice(offsets[current], offsets[current + 1])}
    </div>
    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
      <button type="button" style={{ ...pageButtonStyle, opacity: current === 0 ? 0.45 : 1 }}
        disabled={current === 0} onClick={() => goTo(current - 1)}>
        {t('chat.page.previousPage')}
      </button>
      <button type="button" style={{ ...pageButtonStyle, opacity: current === lastPage ? 0.45 : 1 }}
        disabled={current === lastPage} onClick={() => goTo(current + 1)}>
        {t('chat.page.nextPage')}
      </button>
    </div>
  </div>;
}

const pageButtonStyle: CSSProperties = {
  border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
  padding: '4px 10px', color: 'var(--color-text-secondary)',
  background: 'var(--color-surface)', font: 'inherit', cursor: 'pointer',
};
