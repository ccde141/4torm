import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '../../../../i18n/LocaleContext';
import { listWorkflowRuns, readWorkflowRun, type WorkflowRun, type WorkflowRunSummary } from './records-client';
import { useRecordQuery, useVisibleRecordRefresh } from './useRecordQuery';
import { recordWords, statusLabel } from './record-copy';
import { RunContents } from './RunContents';
import './records.css';

interface Props { workflowId: string; refreshKey?: string; initialExecutionId?: string | null; onOpenRun?: (run: WorkflowRun) => void }

export function RecordsPanel(props: Props) {
  return <RecordsWorkspace key={props.workflowId} {...props} />;
}

function RecordsWorkspace({ workflowId, refreshKey = '', initialExecutionId, onOpenRun }: Props) {
  const { locale } = useLocale();
  const english = locale === 'en-US';
  const w = recordWords(english);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [revision, setRevision] = useState(0);
  const [liveRevision, setLiveRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialExecutionId ?? null);
  const cursor = cursors.at(-1);
  const load = useCallback(() => listWorkflowRuns(workflowId, cursor), [workflowId, cursor]);
  const liveRefreshKey = `${refreshKey}:${liveRevision}`;
  const query = useRecordQuery(`${workflowId}:${cursor ?? ''}`, load, `${revision}:${liveRefreshKey}`);
  const detachedId = selectedId && query.data && !query.data.items.some(item => item.executionId === selectedId)
    ? selectedId : null;
  const loadDetached = useCallback(() => detachedId ? readWorkflowRun(workflowId, detachedId) : Promise.resolve(null),
    [workflowId, detachedId]);
  const detached = useRecordQuery(`${workflowId}:${detachedId ?? ''}`, loadDetached);
  const selected = query.data?.items.find(item => item.executionId === selectedId)
    ?? detached.data ?? (!detachedId ? query.data?.items[0] : undefined);
  useVisibleRecordRefresh(!cursor && selected?.status === 'running', query.loading, setLiveRevision);
  return <section className="tw-records" aria-label={w.title}>
    <header className="tw-records-heading"><div><h3>{w.title}</h3><p>{w.fact}</p></div>
      <button onClick={() => { setCursors([undefined]); setRevision(value => value + 1); }}>{w.refresh}</button>
    </header>
    {query.loading && <p role="status" className="tw-record-empty">{w.loading}</p>}
    {query.error && <p role="alert" className="tw-record-error">{query.error}</p>}
    {query.data?.items.length === 0 && <p className="tw-record-empty">{w.noRuns}</p>}
    {query.data && query.data.items.length > 0 && <div className="tw-records-content">
      <aside className="tw-record-run-list" aria-label={w.run}>
        {query.data.items.map(run => <RunButton key={run.executionId} run={run} english={english}
          selected={run.executionId === selected?.executionId} onSelect={() => setSelectedId(run.executionId)} />)}
        <nav className="tw-record-pagination" aria-label={w.title}>
          <button disabled={cursors.length === 1} onClick={() => { setSelectedId(null); setCursors(value => value.slice(0, -1)); }}>{w.before}</button>
          <span>{cursors.length}</span>
          <button disabled={!query.data.nextCursor} onClick={() => {
            if (query.data?.nextCursor) { setSelectedId(null); setCursors(value => [...value, query.data?.nextCursor]); }
          }}>{w.after}</button>
        </nav>
      </aside>
      {selected ? <div className="tw-record-run-detail"><RunHeading key={`heading:${selected.executionId}`}
        run={selected} english={english} onOpenRun={onOpenRun} />
        <RunContents key={`contents:${selected.executionId}`} workflowId={workflowId}
          executionId={selected.executionId} english={english} revision={revision} liveRefreshKey={liveRefreshKey} /></div>
        : <p className={detached.error ? 'tw-record-error' : 'tw-record-empty'} role={detached.error ? 'alert' : 'status'}>
          {detached.error || (detachedId && detached.loading ? w.loading : w.choose)}</p>}
    </div>}
  </section>;
}

function RunButton({ run, english, selected, onSelect }: {
  run: WorkflowRunSummary; english: boolean; selected: boolean; onSelect(): void;
}) {
  return <button className={`tw-record-run${selected ? ' selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
    <span className={`tw-record-status ${run.status}`}>{statusLabel(run.status, english)}</span>
    <time dateTime={run.startTime}>{new Date(run.startTime).toLocaleString(english ? 'en-US' : 'zh-CN')}</time>
    <small>{run.executionId}</small>
  </button>;
}

function RunHeading({ run, english, onOpenRun }: {
  run: WorkflowRunSummary; english: boolean; onOpenRun?: Props['onOpenRun'];
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const w = recordWords(english);
  async function open() {
    if (!onOpenRun || opening) return;
    setOpening(true);
    setError('');
    try {
      const result = await readWorkflowRun(run.workflowId, run.executionId);
      if (mounted.current) onOpenRun(result);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error));
    } finally { if (mounted.current) setOpening(false); }
  }
  return <header className="tw-record-run-heading"><div>
    <span className={`tw-record-status ${run.status}`}>{statusLabel(run.status, english)}</span>
    <h4>{run.executionId}</h4>
    <p>{w.started} · <time dateTime={run.startTime}>{new Date(run.startTime).toLocaleString(english ? 'en-US' : 'zh-CN')}</time></p>
    {run.endTime && <p>{w.ended} · <time dateTime={run.endTime}>{new Date(run.endTime).toLocaleString(english ? 'en-US' : 'zh-CN')}</time></p>}
    {run.errorMessage && <p className="tw-record-error" role="alert">{run.errorMessage}</p>}
    {error && <p className="tw-record-error" role="alert">{error}</p>}
  </div>{onOpenRun && <button disabled={opening} onClick={() => void open()}>{opening ? w.opening : w.open}</button>}</header>;
}

export default RecordsPanel;
