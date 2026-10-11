import { useEffect, useRef, useState } from 'react';
import {
  findOperationRecords, readOperationRecord,
  type CollaborationFeature, type OperationRecordSummary,
} from '../../api/collaboration';
import { useLocale } from '../../i18n/LocaleContext';
import { recordTitle, statusKey } from './agent-card-view';

interface Props { feature?: CollaborationFeature; operationId?: string; displayTitle?: string }

export default function AgentDetailRecords({ feature, operationId, displayTitle }: Props) {
  const { t, locale } = useLocale();
  const [items, setItems] = useState<OperationRecordSummary[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(!!feature && !!operationId);
  const [selected, setSelected] = useState<OperationRecordSummary>();
  const [fragmentCursor, setFragmentCursor] = useState<string>();
  const readToken = useRef(0);

  useEffect(() => {
    readToken.current += 1;
    setItems([]); setCursor(undefined); setPreview(''); setError('');
    setSelected(undefined); setFragmentCursor(undefined); setLoading(false);
    setInitialLoading(!!feature && !!operationId);
    if (!feature || !operationId) return;
    let current = true;
    findOperationRecords(feature, { operationId, limit: 5 })
      .then(page => { if (current) { setItems(page.items); setCursor(page.nextCursor);
        setInitialLoading(false); } })
      .catch(cause => { if (current) { setError(String(cause));
        setInitialLoading(false); } });
    return () => { current = false; };
  }, [feature, operationId]);

  async function more() {
    if (!feature || !operationId || !cursor || loading) return;
    setLoading(true); setError('');
    try {
      const page = await findOperationRecords(feature, { operationId, limit: 5, cursor });
      setItems(previous => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }

  async function openRecord(record: OperationRecordSummary) {
    if (!feature) return;
    const token = ++readToken.current;
    setSelected(record); setFragmentCursor(undefined);
    setPreview(t('dashboard.detail.reading')); setError('');
    try {
      const page = await readOperationRecord(feature, record.operationId, record.runId,
        { maxTextChars: 4000, maxTextLines: 80 });
      if (token === readToken.current) {
        setPreview(page.text); setFragmentCursor(page.nextCursor);
      }
    } catch (cause) { if (token === readToken.current) { setPreview(''); setError(String(cause)); } }
  }

  async function moreRecord() {
    if (!feature || !selected || !fragmentCursor || loading) return;
    const token = readToken.current;
    setLoading(true); setError('');
    try {
      const page = await readOperationRecord(feature, selected.operationId, selected.runId,
        { maxTextChars: 4000, maxTextLines: 80, cursor: fragmentCursor });
      if (token === readToken.current) {
        setPreview(previous => `${previous}\n${page.text}`);
        setFragmentCursor(page.nextCursor);
      }
    } catch (cause) { if (token === readToken.current) setError(String(cause)); }
    finally { if (token === readToken.current) setLoading(false); }
  }

  return <section className="agent-detail__records">
    <h3>{t('dashboard.detail.records')}</h3>
    {!operationId && <p>{t('dashboard.detail.noLinkedRecords')}</p>}
    {initialLoading && <p>{t('dashboard.detail.readingShort')}</p>}
    {operationId && !initialLoading && !items.length && !error
      && <p>{t('dashboard.detail.noReadableRecords')}</p>}
    {items.map(record => <button key={`${record.operationId}:${record.runId}`}
      type="button" onClick={() => void openRecord(record)} className="agent-detail__record">
      <strong title={record.title}>{displayTitle ?? recordTitle(record)
        ?? t('dashboard.detail.recordFallback')}</strong>
      <small>{t(statusKey(record.status))} · {new Date(record.timestamp).toLocaleString(locale)}</small>
    </button>)}
    {cursor && <button type="button" onClick={() => void more()} disabled={loading}
      className="agent-detail__more">{loading ? t('dashboard.detail.readingShort')
        : t('dashboard.detail.more')}</button>}
    {error && <p role="alert" className="agent-detail__error">{error}</p>}
    {preview && <pre className="agent-detail__preview">{preview}</pre>}
    {fragmentCursor && <button type="button" onClick={() => void moreRecord()}
      disabled={loading} className="agent-detail__more">{loading ? t('dashboard.detail.readingShort')
        : t('dashboard.detail.moreRecord')}</button>}
  </section>;
}
