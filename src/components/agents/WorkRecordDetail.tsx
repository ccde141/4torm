import { useEffect, useState } from 'react';
import { readWorkRecord, type WorkRecord, type WorkRecordFragment } from '../../api/work-records';
import { renderTextWithCode } from '../../engine/markdown';
import { useLocale } from '../../i18n/LocaleContext';
import type { MessageKey } from '../../i18n/locale';
import { workRecordError } from './work-record-view';

export default function WorkRecordDetail({ agentId, record, onOpenSession }: {
  agentId: string; record: WorkRecord; onOpenSession?: (sessionId: string) => void;
}) {
  const { t } = useLocale();
  const [selection, setSelection] = useState<{ view: 'record' | 'source'; offsets: number[] }>({ view: 'record', offsets: [0] });
  const [retry, setRetry] = useState(0);
  const [fragment, setFragment] = useState<WorkRecordFragment>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MessageKey>();
  const offset = selection.offsets.at(-1)!;
  useEffect(() => {
    const request = new AbortController();
    setLoading(true); setError(undefined); setFragment(undefined);
    readWorkRecord(agentId, record, { view: selection.view, offset }, request.signal)
      .then(result => { if (!request.signal.aborted) setFragment(result); })
      .catch(cause => { if (!request.signal.aborted) setError(workRecordError(cause)); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [agentId, record, selection.view, offset, retry]);
  return <div className="work-record-detail">
    <div className="work-record-detail__tools">
      <div role="group" aria-label={t('workRecords.views')}>
        {(['record', 'source'] as const).map(view => <button key={view} type="button"
          aria-pressed={selection.view === view} onClick={() => setSelection({ view, offsets: [0] })}>
          {t(view === 'record' ? 'workRecords.handoff' : 'workRecords.source')}</button>)}
      </div>
      {record.sessionId && onOpenSession && <button type="button" onClick={() => onOpenSession(record.sessionId!)}>
        <span aria-hidden="true">↗ </span>{t('workRecords.openSession')}</button>}
    </div>
    <div className="work-record-detail__content" aria-busy={loading}>
      {loading && <p role="status">{t('workRecords.loading')}</p>}
      {error && <p role="alert" className="agent-detail__error">{t(error)}
        {error === 'workRecords.error' && <button type="button" onClick={() => setRetry(value => value + 1)}>{t('workRecords.retry')}</button>}</p>}
      {fragment && <div className="work-record-detail__text">{renderTextWithCode(fragment.content, `${record.id}:${selection.view}:${offset}`)}</div>}
    </div>
    {(selection.offsets.length > 1 || fragment?.hasMore) && <div className="work-record-detail__pages">
      <button type="button" disabled={loading || selection.offsets.length === 1}
        onClick={() => setSelection(previous => ({ ...previous, offsets: previous.offsets.slice(0, -1) }))}>{t('workRecords.previous')}</button>
      <span>{t('workRecords.page', { number: selection.offsets.length })}</span>
      <button type="button" disabled={loading || !fragment?.hasMore}
        onClick={() => fragment && setSelection(previous => ({ ...previous,
          offsets: [...previous.offsets, fragment.offset + fragment.content.length] }))}>{t('workRecords.next')}</button>
    </div>}
  </div>;
}
