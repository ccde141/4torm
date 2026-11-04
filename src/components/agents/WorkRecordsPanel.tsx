import { Fragment, useId, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useWorkRecords } from './useWorkRecords';
import { workRecordDay, workRecordTime } from './work-record-view';
import WorkRecordDetail from './WorkRecordDetail';
import './work-records.css';

export default function WorkRecordsPanel({ agentId, onOpenSession }: {
  agentId: string; onOpenSession?: (sessionId: string) => void;
}) {
  const { t, locale } = useLocale();
  const records = useWorkRecords(agentId);
  const [query, setQuery] = useState('');
  const [date, setDate] = useState('');
  const [selected, select] = useState<string>();
  const id = useId();
  const refresh = () => { select(undefined); records.reload(); };
  return <div className="work-records">
    <header className="work-records__heading"><div><h3>{t('workRecords.title')}</h3><p>{t('workRecords.subtitle')}</p></div>
      <span>{t('workRecords.total', { count: records.page.total })}</span>
      <button type="button" onClick={refresh} disabled={records.loading}>{t('workRecords.refresh')}</button></header>
    <form className="work-records__filters" onSubmit={event => {
      event.preventDefault(); select(undefined); records.search(query, date);
    }}>
      <input type="search" aria-label={t('workRecords.search')} placeholder={t('workRecords.search')}
        value={query} onChange={event => setQuery(event.target.value)} maxLength={200} />
      <input type="date" aria-label={t('workRecords.date')} value={date} onChange={event => setDate(event.target.value)} />
      <button type="submit">{t('workRecords.apply')}</button>
    </form>
    {!records.page.items.length && !records.loading && !records.error && <div className="work-records__empty">
      <strong>{t(records.filters.query || records.filters.date ? 'workRecords.noMatches' : 'workRecords.empty')}</strong>
      {!records.filters.query && !records.filters.date && <p>{t('workRecords.emptyHint')}</p>}
    </div>}
    <ol className="work-records__timeline">{records.page.items.map((record, index) => {
      const open = selected === record.id;
      const label = `${id}-${index}`;
      return <Fragment key={record.id}>
        {(index === 0 || record.date !== records.page.items[index - 1].date) && <li className="work-records__day">{workRecordDay(record, locale)}</li>}
        <li className={`work-record${open ? ' is-open' : ''}`}>
          <button className="work-record__summary" type="button" aria-expanded={open} aria-controls={open ? label : undefined}
            onClick={() => select(open ? undefined : record.id)}>
            <span className="work-record__meta"><time dateTime={record.timestamp}>{workRecordTime(record, locale)}</time>
              {record.sequence && <span>{t('workRecords.sequence', { number: record.sequence })}</span>}</span>
            <span className="work-record__title">{record.sessionTitle || record.title}</span>
            {!open && <span className="work-record__excerpt">{record.summary}</span>}
            {record.scope && <span className="work-record__scope">{record.scope}</span>}
            <svg className="work-record__chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
          {open && <div id={label}><WorkRecordDetail key={`${record.id}:${record.revision}`} agentId={agentId}
            record={record} onOpenSession={onOpenSession} /></div>}
        </li>
      </Fragment>;
    })}</ol>
    {records.loading && <p role="status" className="work-records__status">{t('workRecords.loading')}</p>}
    {records.error && <p role="alert" className="agent-detail__error">{t(records.error)}
      <button type="button" onClick={refresh}>{t('workRecords.retry')}</button></p>}
    {records.page.nextCursor && <button type="button" className="work-records__more" disabled={records.loading}
      onClick={() => void records.more()}>{t('workRecords.more')}</button>}
  </div>;
}
