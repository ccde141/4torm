import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { messagePageOffsets, selectedTextPage, type TextPageSelection } from './text-pages';

export interface BoundedTextProps {
  text: string;
  id?: string;
  pageChars?: number;
  /** New pages follow the stream until the reader explicitly navigates elsewhere. */
  followTail?: boolean;
}

/** Phrasing elements make this usable inside existing pre/p message containers. */
export default function BoundedText({ text, id = '', pageChars = 16_384, followTail = false }: BoundedTextProps) {
  const { t, locale } = useLocale();
  const [selection, setSelection] = useState<TextPageSelection>({ id, page: null });
  const root = useRef<HTMLSpanElement>(null);
  const navigation = useRef(false);
  const offsets = useMemo(() => messagePageOffsets(text, Math.min(pageChars, 16_384)), [text, pageChars]);
  const lastPage = Math.max(0, offsets.length - 2);
  const current = selectedTextPage(selection, id, lastPage, followTail);
  useLayoutEffect(() => {
    if (!navigation.current) return;
    navigation.current = false;
    root.current?.scrollIntoView({ block: 'start' });
  }, [current]);
  if (lastPage === 0) return <span style={bodyStyle}>{text}</span>;
  const navigate = (page: number | null) => { navigation.current = true; setSelection({ id, page }); };
  return <span ref={root} data-text-page={current + 1}
    data-text-follow={followTail ? selection.id === id && selection.page !== null ? 'paused' : 'auto' : undefined}
    style={{ display: 'block' }}>
    <span style={labelStyle}>{t('chat.page.longOriginal', { page: current + 1, total: lastPage + 1 })}</span>
    <span style={bodyStyle}>{text.slice(offsets[current], offsets[current + 1])}</span>
    <span style={navigationStyle}>
      <button type="button" style={buttonStyle} disabled={current === 0} onClick={() => navigate(current - 1)}>
        {t('chat.page.previousPage')}
      </button>
      <button type="button" style={buttonStyle} disabled={current === lastPage} onClick={() => navigate(current + 1)}>
        {t('chat.page.nextPage')}
      </button>
      {followTail && selection.id === id && selection.page !== null &&
        <button type="button" style={buttonStyle} onClick={() => navigate(null)}>
          {locale === 'en-US' ? 'Latest content' : '最新内容'}
        </button>}
    </span>
  </span>;
}

const bodyStyle: CSSProperties = { display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const labelStyle: CSSProperties = { display: 'block', fontSize: 'var(--text-xs)',
  color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' };
const navigationStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)',
  marginTop: 'var(--space-3)', whiteSpace: 'normal' };
const buttonStyle: CSSProperties = { border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)',
  padding: '4px 10px', color: 'var(--color-text-secondary)', background: 'var(--color-surface)',
  font: 'inherit', cursor: 'pointer' };
