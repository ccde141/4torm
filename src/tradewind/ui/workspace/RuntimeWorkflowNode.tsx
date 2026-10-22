import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useLocale } from '../../../i18n/LocaleContext';
import type { WorkflowNode } from '../../types';
import type { HandoffState } from '../../types/handoff';
import type { ExecutionPhase } from '../hooks/execution-phase';
import type { WorkflowNodeStatus } from '../hooks/useWorkflowNodeStatus';
import { completionFeedbackRemaining, runtimeNodeAction, runtimeNodeClasses,
  type RuntimeNodeIdentity } from './runtime-node-presentation';

interface RuntimeNodeData extends RuntimeNodeIdentity {
  node: WorkflowNode;
  status?: WorkflowNodeStatus;
  queue?: HandoffState['nodes'][number];
  live: boolean;
  phase?: ExecutionPhase;
  participantCount?: number;
}

/** Runtime nodes use the run snapshot and scoped status, never the editable graph's globals. */
export function RuntimeWorkflowNode({ data, selected }: NodeProps) {
  const { node, status, queue, live, phase, participantCount, ...identity } = data as unknown as RuntimeNodeData;
  const { t, locale } = useLocale();
  const zh = locale === 'zh-CN';
  const showCompletion = useCompletionFeedback(status);
  const action = runtimeNodeAction(node, identity, live, status);
  const text = status?.busy ? (zh ? '正在执行' : 'Working')
    : status?.humanGate?.waiting ? t('tradewind.canvas.gate.waitingReview')
      : status?.envelopePending ? (zh ? '持有信封' : 'Holding envelope')
        : status?.terminalOutcome === 'completed' ? (zh ? '已完成' : 'Completed')
          : status?.terminalOutcome === 'stopped' ? (zh ? '已停止' : 'Stopped')
            : status?.terminalOutcome === 'error' ? (zh ? '执行失败' : 'Failed') : '';
  const open = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (action) window.dispatchEvent(new CustomEvent(action.eventName, { detail: action.detail }));
  };
  const agentId = node.config.agentId;
  const icons: Record<string, string> = { entry: '▶', agent: '⚡', meeting: '◎', note: '✎', 'human-gate': '◇', output: '■' };
  return <div className={runtimeNodeClasses(node.type, !!selected, status, showCompletion, phase)}>
    {node.type !== 'entry' && node.type !== 'note' && <Handle type="target" position={Position.Left} className="tw-handle" />}
    <div className="tw-node__icon">{icons[node.type] ?? '•'}</div>
    <div className="tw-node__label">{node.label}</div>
    {node.type === 'agent' && typeof agentId === 'string' && <div className="tw-node__sub" title={agentId}>{agentId.slice(0, 12)}</div>}
    {node.type === 'meeting' && Boolean(participantCount) && <div className="tw-node__sub">{t('tradewind.canvas.meeting.participants', { count: participantCount! })}</div>}
    {node.memo && <div className="tw-node__memo">{node.memo}</div>}
    {node.type === 'output' ? <OutputState phase={phase} /> : text && <div className="tw-node__sub">{text}</div>}
    {Boolean(queue?.queuedEnvelopeIds.length) && <div className="tw-node__sub">{zh ? '排队' : 'Queued'} {queue!.queuedEnvelopeIds.length}</div>}
    {action && <button type="button" className={`nodrag nopan ${node.type === 'human-gate' ? 'tw-node__gate-action' : 'tw-node__chat-btn tw-node__chat-btn--active'}`}
      onClick={open} title={node.type === 'human-gate' ? t('tradewind.canvas.gate.reviewHint') : t('tradewind.canvas.agent.openChat')}>
      {node.type === 'human-gate' ? t('tradewind.canvas.gate.review')
        : node.type === 'meeting' ? t('tradewind.canvas.meeting.open') : t('tradewind.canvas.agent.chat')}
    </button>}
    {node.type !== 'output' && <Handle type="source" position={Position.Right} className="tw-handle" />}
  </div>;
}

function useCompletionFeedback(status?: WorkflowNodeStatus): boolean {
  const [visible, setVisible] = useState(false);
  const outcome = status?.terminalOutcome;
  const completedAt = status?.completedAt;
  useEffect(() => {
    const remaining = completionFeedbackRemaining({ busy: false, envelopePending: false, terminalOutcome: outcome, completedAt }, Date.now());
    setVisible(remaining > 0);
    if (remaining <= 0) return;
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [outcome, completedAt]);
  return visible;
}

function OutputState({ phase }: { phase?: ExecutionPhase }) {
  const { t } = useLocale();
  const complete = phase === 'completed';
  const missed = phase === 'stopped' || phase === 'failed' || phase === 'interrupted';
  const text = complete ? t('tradewind.canvas.output.reached') : missed ? t('tradewind.canvas.output.missed')
    : phase === 'running' ? t('tradewind.canvas.output.waiting') : t('tradewind.canvas.output.endpoint');
  return <div className={`tw-node__state-line tw-node__state-line--${complete ? 'complete' : missed ? 'missed' : 'idle'}`}>
    <span className="tw-node__state-dot" /><span>{text}</span>
  </div>;
}
