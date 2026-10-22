import { useState } from 'react';
import { useLocale } from '../../../i18n/LocaleContext';
import type { WorkflowNode } from '../../types';
import type { WorkflowNodeStatus } from '../hooks/useWorkflowNodeStatus';
import BoundedText from '../../../engine/text-display/BoundedText';
import type { HandoffState } from '../../types/handoff';
import { nodeHandoffFact } from './node-handoff-fact';
import { runtimeNodeAction, type RuntimeNodeIdentity } from './runtime-node-presentation';

export function RuntimeNodeDetails({ node, status, live, onClose, handoff, workflowId, executionId }: RuntimeNodeIdentity & {
  node: WorkflowNode; status?: WorkflowNodeStatus; live: boolean; onClose: () => void;
  handoff?: HandoffState;
}) {
  const { locale } = useLocale();
  const zh = locale === 'zh-CN';
  const [tab, setTab] = useState<'activity' | 'settings'>('activity');
  const queue = handoff?.nodes.find(item => item.nodeId === node.id);
  const transfer = nodeHandoffFact(handoff?.lastHandoffs ?? [], node.id, queue?.activationId);
  const action = runtimeNodeAction(node, { workflowId, executionId }, live, status);
  const open = () => { if (action) window.dispatchEvent(new CustomEvent(action.eventName, { detail: action.detail })); };
  return <aside className="tw-runtime-details" aria-label={zh ? '节点详情' : 'Node details'}>
    <header><h3>{node.label}</h3><button type="button" onClick={onClose} aria-label={zh ? '关闭节点详情' : 'Close node details'}>×</button></header>
    <nav>{(['activity', 'settings'] as const).map(value => <button key={value} type="button"
      aria-pressed={value === tab} onClick={() => setTab(value)}>
      {value === 'activity' ? (zh ? '活动' : 'Activity') : (zh ? '设置' : 'Settings')}</button>)}</nav>
    <div className="tw-runtime-details__body">{tab === 'settings' ? <>
      <p>{zh ? '本次运行使用的节点配置' : 'Node configuration used in this run'}</p>
      <pre><BoundedText text={JSON.stringify(node.config, null, 2)} /></pre>
    </> : <>
      <dl><dt>{zh ? '状态' : 'Status'}</dt><dd>{status?.busy ? (zh ? '执行中' : 'Working')
        : status?.humanGate?.waiting ? (zh ? '等待审阅' : 'Awaiting review')
          : status?.envelopePending ? (zh ? '等待交接' : 'Holding envelope')
            : status?.terminalOutcome === 'completed' ? (zh ? '已完成' : 'Completed')
              : status?.terminalOutcome === 'stopped' ? (zh ? '已停止' : 'Stopped')
                : status?.terminalOutcome === 'error' ? (zh ? '执行失败' : 'Failed')
                  : live ? (zh ? '等待任务' : 'Waiting for work') : (zh ? '已归档' : 'Archived')}</dd>
        <dt>{zh ? '节点 ID' : 'Node ID'}</dt><dd>{node.id}</dd>
        {queue?.envelopeId && <><dt>{zh ? '当前信封' : 'Envelope'}</dt><dd title={queue.envelopeId}>{queue.envelopeId}</dd></>}
        {queue?.activationId && <><dt>{zh ? '激活 ID' : 'Activation'}</dt><dd>{queue.activationId}</dd></>}
        {transfer && <><dt>{zh ? '发件节点' : 'From'}</dt><dd>{transfer.source}</dd>
          <dt>{zh ? '发送时间' : 'Sent'}</dt><dd>{new Date(transfer.sentAt).toLocaleString(locale)}</dd>
          <dt>{zh ? '接收时间' : 'Received'}</dt><dd>{new Date(transfer.receivedAt).toLocaleString(locale)}</dd></>}
        {queue?.startedAt && <><dt>{zh ? '开始处理' : 'Started'}</dt><dd>{new Date(queue.startedAt).toLocaleString(locale)}</dd></>}
        {status?.humanGate && !queue && <><dt>{zh ? '进入审阅' : 'Review started'}</dt><dd>{new Date(status.humanGate.arrivedAt).toLocaleString(locale)}</dd></>}
      </dl>
      {queue && <><p>{zh ? '等待队列' : 'Queue'} · {queue.queuedEnvelopeIds.length}</p>
        {queue.queuedEnvelopeIds.map(id => <code key={id} className="tw-runtime-queued-id">{id}</code>)}</>}
      {status?.humanGate && <pre><BoundedText text={status.humanGate.envelopeContent} /></pre>}
    </>}
      {action && ['agent', 'meeting'].includes(node.type) && <button type="button" className="tw-runtime-details__open" onClick={open}>
        {zh ? '进入会话' : 'Open conversation'} ↗</button>}
      {action && node.type === 'human-gate' && <button type="button" className="tw-runtime-details__open" onClick={open}>
        {zh ? '打开审阅' : 'Open review'} ↗</button>}
    </div>
  </aside>;
}
