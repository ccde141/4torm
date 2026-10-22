import { useCallback, useState } from 'react';
import BoundedText from '../../../../engine/text-display/BoundedText';
import { readWorkflowRunArchive, type WorkflowRunArchive } from './records-client';
import { useRecordQuery } from './useRecordQuery';
import { recordWords } from './record-copy';
import { archiveDisplay } from './archive-conversation-view';
import ToolResultImages from '../../../../components/common/ToolResultImages';
import type { ToolMediaScope } from '../../../../engine/tool-media';

export function ArchiveBody({ workflowId, executionId, archive, english, refreshKey }: {
  workflowId: string; executionId: string; archive: WorkflowRunArchive; english: boolean; refreshKey: string;
}) {
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets.at(-1) ?? 0;
  const { kind, nodeId, round } = archive;
  const load = useCallback(() => readWorkflowRunArchive(workflowId, executionId, { kind, nodeId, round }, offset),
    [workflowId, executionId, kind, nodeId, round, offset]);
  const query = useRecordQuery(JSON.stringify([workflowId, executionId, kind, nodeId, round, offset]), load,
    offset === 0 ? refreshKey : '');
  const w = recordWords(english);
  return <div className="tw-record-archive-body">
    {query.loading && <p role="status">{w.loading}</p>}
    {query.error && <p role="alert" className="tw-record-error">{query.error}</p>}
    {query.data && <>
      <ArchiveText text={query.data.text} complete={offset === 0 && query.data.nextOffset === undefined}
        mediaScope={nodeId ? { feature: 'tradewind', workflowId, executionId, nodeId,
          kind: kind === 'meeting' ? 'meeting' : 'node', ...(round !== undefined ? { round: String(round) } : {}) } : undefined}
        kind={kind} presentation={query.data.presentation} english={english} />
      {(offset > 0 || query.data.nextOffset !== undefined) && <nav className="tw-record-pagination" aria-label={w.fragment}>
        <button disabled={offsets.length === 1} onClick={() => setOffsets(previous => previous.slice(0, -1))}>{w.before}</button>
        <span>{w.fragment} {offsets.length}</span>
        <button disabled={query.data.nextOffset === undefined} onClick={() => {
          const next = query.data?.nextOffset;
          if (next !== undefined) setOffsets(previous => [...previous, next]);
        }}>{w.after}</button>
      </nav>}
    </>}
  </div>;
}

function ArchiveText({ text, complete, english, kind, presentation, mediaScope }: {
  text: string; complete: boolean; english: boolean; kind: WorkflowRunArchive['kind']; presentation?: 'public-conversation';
  mediaScope?: ToolMediaScope;
}) {
  const display = archiveDisplay(text, complete, kind, presentation);
  if (display.kind === 'unavailable') return <p className="tw-record-empty">{english
    ? 'This record cannot be displayed right now. Refresh and try again.' : '记录内容暂时无法显示，请刷新后重试。'}</p>;
  if (display.kind === 'fragment') return <pre><BoundedText text={display.text} /></pre>;
  const items = display.items;
  if (!items.length) return <p className="tw-record-empty">{english ? 'No saved content.' : '没有已保存的正文。'}</p>;
  const roles: Record<string, string> = english ? { user: 'Input', assistant: 'Agent', tool: 'Tool' }
    : { user: '输入', assistant: 'Agent', tool: '工具' };
  return <div className="tw-record-messages">{items.map((item, index) => <article key={index}>
    <header><strong>{item.toolName ?? item.source ?? roles[item.role ?? ''] ?? item.role ?? `${english ? 'Record' : '记录'} ${index + 1}`}</strong>
      {item.scope && <span>{item.scope === 'chair' ? (english ? 'Assistant chat' : '会议助理私聊') : (english ? 'Meeting' : '会议')}</span>}
      {item.timestamp && <time>{item.timestamp}</time>}{item.envelopeId && <code>{item.envelopeId}</code>}</header>
    <pre><BoundedText text={item.content} /></pre>
    {mediaScope && !!item.toolImages?.length && <ToolResultImages images={item.toolImages}
      scope={mediaScope} />}
  </article>)}</div>;
}
