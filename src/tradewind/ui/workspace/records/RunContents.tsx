import { useCallback, useState } from 'react';
import { readWorkflowRun, type WorkflowRun, type WorkflowRunArchive } from './records-client';
import { useRecordQuery } from './useRecordQuery';
import { RunEvents } from './RunEvents';
import { ArchiveBody } from './ArchiveBody';

type Section = 'output' | 'node-context' | 'meeting' | 'handoff' | 'events';
interface Props { workflowId: string; executionId: string; english: boolean; revision: number; liveRefreshKey: string }

export function RunContents(props: Props) {
  const { workflowId, executionId, english, revision, liveRefreshKey } = props;
  const [section, setSection] = useState<Section>('output');
  const load = useCallback(() => readWorkflowRun(workflowId, executionId), [workflowId, executionId]);
  const query = useRecordQuery(`${workflowId}:${executionId}`, load, `${revision}:${liveRefreshKey}`);
  const sections: Array<[Section, string]> = [['output', english ? 'Results' : '交付结果'],
    ['node-context', english ? 'Node context' : '节点上下文'], ['meeting', english ? 'Meetings' : '会议记录'],
    ['handoff', english ? 'Envelopes' : '信封交接'], ['events', english ? 'All events' : '全部事件']];
  return <div className="tw-record-contents">
    <nav className="tw-record-sections" aria-label={english ? 'Run contents' : '本次运行内容'}>
      {sections.map(([id, label]) => <button key={id} type="button" aria-pressed={section === id}
        onClick={() => setSection(id)}>{label}</button>)}
    </nav>
    {query.error && <p role="alert" className="tw-record-error">{query.error}</p>}
    {query.loading && !query.data && <p role="status">{english ? 'Loading run…' : '正在读取本次运行…'}</p>}
    {section === 'events' || section === 'handoff' ? <RunEvents key={`${section}:${query.data?.graph.orchestration ?? ''}`} {...props}
      initialEventType={section === 'handoff' ? (query.data?.graph.orchestration === 'handoff' ? 'handoff-sent' : 'handoff') : undefined} />
      : query.data && <RunArchives key={`${section}:${revision}`} run={query.data} section={section}
        english={english} refreshKey={liveRefreshKey} />}
  </div>;
}

function RunArchives({ run, section, english, refreshKey }: {
  run: WorkflowRun; section: WorkflowRunArchive['kind']; english: boolean; refreshKey: string;
}) {
  const archives = (run.archives ?? []).filter(item => item.kind === section);
  const [selectedKey, setSelectedKey] = useState('');
  const selected = archives.find(item => archiveKey(item) === selectedKey) ?? archives[0];
  const node = run.graph.nodes.find(item => item.id === selected?.nodeId);
  const title = section === 'output' ? (english ? 'Final envelopes' : '最终交付信封')
    : section === 'node-context' ? (english ? 'Saved node context' : '节点保存的会话上下文')
      : (english ? 'Saved meeting' : '已保存的会议');
  return <section className="tw-record-archives" aria-label={title}>
    <h4>{title}</h4>
    {archives.length > 1 && <div className="tw-record-archive-list">{archives.map(item =>
      <button type="button" key={archiveKey(item)} aria-pressed={item === selected}
        onClick={() => setSelectedKey(archiveKey(item))}>
        {run.graph.nodes.find(node => node.id === item.nodeId)?.label ?? item.nodeId}
        {item.round !== undefined ? ` · ${english ? 'Round' : '轮次'} ${item.round}` : ''}
        {item.state === 'missing' ? ` · ${english ? 'Not saved' : '未保存'}` : ''}
      </button>)}</div>}
    {selected && <>
      {node && <header className="tw-record-archive-heading"><strong>{node.label}</strong><code>{node.id}</code></header>}
      {selected.state === 'available' ? <ArchiveBody key={archiveKey(selected)} workflowId={run.workflowId}
        executionId={run.executionId} archive={selected} english={english} refreshKey={refreshKey} />
        : <p className="tw-record-empty">{run.status === 'running'
          ? (english ? 'This record has not been saved yet.' : '这份记录尚未保存。')
          : (english ? 'This execution did not save this record.' : '本次执行没有保存这份记录。')}</p>}
    </>}
    {!selected && <p className="tw-record-empty">{english ? 'No records of this kind in this execution.' : '本次执行没有这类记录。'}</p>}
  </section>;
}

function archiveKey(item: WorkflowRunArchive) { return JSON.stringify([item.kind, item.nodeId, item.round]); }
