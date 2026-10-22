import { useCallback, useState } from 'react';
import BoundedText from '../../../../engine/text-display/BoundedText';
import { readWorkflowRunEvent } from './records-client';
import { useRecordQuery } from './useRecordQuery';
import { recordWords } from './record-copy';

interface Props { workflowId: string; executionId: string; eventOffset: number; english: boolean }

export function RecordEventBody({ workflowId, executionId, eventOffset, english }: Props) {
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets.at(-1) ?? 0;
  const load = useCallback(() => readWorkflowRunEvent(workflowId, executionId, eventOffset, offset),
    [workflowId, executionId, eventOffset, offset]);
  const query = useRecordQuery(`${workflowId}:${executionId}:${eventOffset}:${offset}`, load);
  const w = recordWords(english);
  return <div className="tw-record-event-body">
    {query.loading && <p role="status">{w.loading}</p>}
    {query.error && <p role="alert" className="tw-record-error">{query.error}</p>}
    {query.data && <>
      <pre><BoundedText id={`${executionId}:${eventOffset}:${offset}`} text={query.data.text || w.noPayload} /></pre>
      {(offset > 0 || query.data.nextOffset !== undefined) && <nav className="tw-record-pagination" aria-label={w.fragment}>
        <button disabled={offsets.length === 1} onClick={() => setOffsets(previous => previous.slice(0, -1))}>{w.before}</button>
        <span>{offsets.length}</span>
        <button disabled={query.data.nextOffset === undefined} onClick={() => {
          const next = query.data?.nextOffset;
          if (next !== undefined) setOffsets(previous => [...previous, next]);
        }}>{w.after}</button>
      </nav>}
    </>}
  </div>;
}
