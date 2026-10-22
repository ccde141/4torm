import { useCallback, useState, type FormEvent } from 'react';
import { readWorkflowRunEvents, type WorkflowRunEvent } from './records-client';
import { useRecordQuery } from './useRecordQuery';
import { EVENT_TYPES, eventLabel, recordWords, previewLabel } from './record-copy';
import { RecordEventBody } from './RecordEventBody';

interface Props { workflowId: string; executionId: string; english: boolean; revision: number; liveRefreshKey: string; initialEventType?: string }
interface Filters { eventType?: string; since?: string; until?: string }

export function RunEvents({ workflowId, executionId, english, revision, liveRefreshKey, initialEventType }: Props) {
  const [filters, setFilters] = useState<Filters>(initialEventType ? { eventType: initialEventType } : {});
  const [filterError, setFilterError] = useState('');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors.at(-1);
  const w = recordWords(english);
  const load = useCallback(() => readWorkflowRunEvents({ workflowId, executionId, ...filters,
    ...(cursor ? { cursor } : {}) }), [workflowId, executionId, filters, cursor]);
  const key = JSON.stringify([workflowId, executionId, filters, cursor]);
  const live = cursors.length === 1 && !filters.since && !filters.until;
  const query = useRecordQuery(key, load, `${revision}:${live ? liveRefreshKey : ''}`);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const since = iso(data.get('since'));
    const until = iso(data.get('until'));
    if (since && until && Date.parse(since) > Date.parse(until)) { setFilterError(w.invalidTime); return; }
    setFilterError('');
    setCursors([undefined]);
    const eventType = String(data.get('eventType') ?? '').trim();
    setFilters({ ...(eventType ? { eventType } : {}), ...(since ? { since } : {}), ...(until ? { until } : {}) });
  }
  return <section className="tw-record-events" aria-label={w.events}>
    <h4>{w.events}</h4>
    <form className="tw-record-filters" onSubmit={apply}>
      <label>{w.eventType}<input name="eventType" defaultValue={initialEventType} list={`tw-record-types-${executionId}`} placeholder={w.all} /></label>
      <datalist id={`tw-record-types-${executionId}`}>{EVENT_TYPES.map(type =>
        <option key={type} value={type}>{eventLabel(type, english)}</option>)}</datalist>
      <label>{w.since}<input name="since" type="datetime-local" step="1" /></label>
      <label>{w.until}<input name="until" type="datetime-local" step="1" /></label>
      <button type="submit">{w.filter}</button>
    </form>
    {filterError && <p className="tw-record-error" role="alert">{filterError}</p>}
    {query.loading && <p role="status" className="tw-record-empty">{w.loading}</p>}
    {query.error && <p role="alert" className="tw-record-error">{query.error}</p>}
    {query.data && <>
      {query.data.items.length === 0 && <p className="tw-record-empty">{w.noEvents}</p>}
      <div className="tw-record-event-list">{query.data.items.map(event => <EventRow
        key={`${executionId}:${event.eventOffset}`} workflowId={workflowId} executionId={executionId}
        event={event} english={english} />)}</div>
      {!query.data.scannedToEnd && <p className="tw-record-caption">
        {query.data.nextCursor ? w.moreScan : w.partial}</p>}
      <nav className="tw-record-pagination" aria-label={w.events}>
        <button disabled={cursors.length === 1 || query.loading}
          onClick={() => setCursors(previous => previous.slice(0, -1))}>{w.before}</button>
        <span>{cursors.length}</span>
        <button disabled={!query.data.nextCursor || query.loading} onClick={() => {
          if (query.data?.nextCursor) setCursors(previous => [...previous, query.data?.nextCursor]);
        }}>{w.after}</button>
      </nav>
    </>}
  </section>;
}

function EventRow({ workflowId, executionId, event, english }: Omit<Props, 'revision' | 'liveRefreshKey'> & { event: WorkflowRunEvent }) {
  const [expanded, setExpanded] = useState(false);
  const w = recordWords(english);
  const preview = previewLabel(event.preview, event);
  return <article className="tw-record-event">
    <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleString(english ? 'en-US' : 'zh-CN')}</time>
    <div><strong>{eventLabel(event.eventTypeId, english)}</strong>
      <span className="tw-record-event-node">{event.nodeId || '—'}</span>
      {preview && <p>{preview}</p>}
      {event.hasPayload && <details onToggle={event => setExpanded(event.currentTarget.open)}>
        <summary>{w.payload}</summary>
        {expanded && <RecordEventBody workflowId={workflowId} executionId={executionId}
          eventOffset={event.eventOffset} english={english} />}
      </details>}
    </div>
  </article>;
}

function iso(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '');
  return text ? new Date(text).toISOString() : undefined;
}
