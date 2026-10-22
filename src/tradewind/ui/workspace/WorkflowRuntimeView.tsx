import { useState } from 'react';
import { WorkflowRuntimeCanvas } from './WorkflowRuntimeCanvas';
import { RuntimeNodeDetails } from './RuntimeNodeDetails';
import { useLocale } from '../../../i18n/LocaleContext';
import type { WorkflowRun } from './records/records-client';
import type { WorkflowNodeStatus } from '../hooks/useWorkflowNodeStatus';
import type { HandoffState } from '../../types/handoff';
import { statusLabel } from './records/record-copy';
import type { ExecutionPhase } from '../hooks/execution-phase';
import type { WorkflowViewportMemory } from '../canvas/WorkflowInitialViewport';

export function WorkflowRuntimeView({ run, loading, error, nodes, live, phase, viewports, onRecords, onLatest, handoff }: {
  run?: WorkflowRun; loading: boolean; error?: string; nodes: Record<string, WorkflowNodeStatus>;
  live: boolean; onRecords: () => void; onLatest?: () => void;
  handoff?: HandoffState;
  phase?: ExecutionPhase; viewports?: WorkflowViewportMemory;
}) {
  const { locale } = useLocale();
  const zh = locale === 'zh-CN';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [envelopeSelection, setEnvelopeSelection] = useState<{ executionId: string; value: string } | null>(null);
  const envelopeId = envelopeSelection?.executionId === run?.executionId ? envelopeSelection?.value : null;
  const selected = run?.graph.nodes.find(node => node.id === selectedId);
  if (!run) return <div className="tw-workspace-empty" role={error ? 'alert' : 'status'}>
    <p>{error ?? (loading ? (zh ? '正在读取本次运行…' : 'Loading run…') : (zh ? '还没有选中的运行' : 'No run selected'))}</p>
    {!loading && <button type="button" onClick={onRecords}>{zh ? '查看运行记录' : 'Browse run records'}</button>}
  </div>;
  return <div className="tw-runtime-view">
    <div className="tw-runtime-view__caption"><span>{zh ? '本次运行图' : 'Run graph'}</span>
      <span>{statusLabel(run.status, !zh)}</span>
      <code>{run.executionId}</code>
      <time dateTime={run.startTime}>{new Date(run.startTime).toLocaleString(locale)}</time>
      {onLatest && <button type="button" onClick={onLatest}>{zh ? '回到最新运行' : 'Latest run'}</button>}
      <button type="button" onClick={onRecords}>{zh ? '本工作流运行记录' : 'Workflow run records'} ↗</button>
    </div>
    {error && <div className="tw-page__error" role="alert">{error}</div>}
    {handoff && <div className="tw-runtime-envelope-bar" aria-label={zh ? '信封' : 'Envelopes'}>
      {handoff.envelopes?.map((item, index) => <button key={item.envelopeId} type="button" title={item.envelopeId}
        aria-pressed={item.envelopeId === envelopeId} onClick={() => setEnvelopeSelection({ executionId: run.executionId, value: item.envelopeId })}>
        E{index + 1} · {run.graph.nodes.find(node => node.id === item.entryNodeId)?.label ?? item.entryNodeId}
        {item.completed ? ' ✓' : ''}</button>)}
      <span>{zh ? '已交付' : 'Delivered'} {handoff.completedRoots}/{handoff.totalRoots}</span>
    </div>}
    <div className="tw-runtime-view__surface"><WorkflowRuntimeCanvas run={run} nodes={nodes} live={live}
      phase={phase ?? runPhase(run.status)} viewports={viewports}
      selectedId={selectedId} onSelect={setSelectedId} handoff={handoff} envelopeId={envelopeId} />
      {selected && <RuntimeNodeDetails key={`${run.executionId}:${selected.id}`} node={selected}
        workflowId={run.workflowId} executionId={run.executionId}
        status={nodes[selected.id]} live={live} handoff={handoff} onClose={() => setSelectedId(null)} />}
    </div>
    {handoff && <div className="tw-runtime-recent" aria-label={zh ? '最近交接' : 'Recent handoffs'}>
      {handoff.lastHandoffs.filter(item => !envelopeId || item.envelopeId === envelopeId).slice(-3).map(item => <div key={item.handoffId}>
        <time title={item.sentAt}>{new Date(item.sentAt).toLocaleTimeString(locale)}</time>
        <span>{run.graph.nodes.find(node => node.id === item.source)?.label ?? item.source} → {run.graph.nodes.find(node => node.id === item.target)?.label ?? item.target}</span>
      </div>)}<button type="button" onClick={onRecords}>{zh ? '完整记录' : 'Full records'} ↗</button>
    </div>}
    {!live && run.status !== 'running' && <div className="tw-runtime-recent" role="status">
      <span>{statusLabel(run.status, !zh)}</span>
      <button type="button" onClick={onRecords}>{zh ? '查看本次结果与信封记录' : 'View results and envelope records'} ↗</button>
    </div>}
  </div>;
}

function runPhase(status: WorkflowRun['status']): ExecutionPhase {
  return { running: 'running', completed: 'completed', failed: 'failed',
    aborted: 'stopped', crashed: 'interrupted' }[status] as ExecutionPhase;
}
