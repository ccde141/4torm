import { useEffect, useState } from 'react';
import type { ToolCall } from '../../types';
import { phaseFromExecutionStatus, phasePresentation, type ExecutionPhase } from '../../tradewind/ui/hooks/execution-phase';
import { executionUpdateFromProbe } from '../../tradewind/ui/hooks/execution-sync';
import { useLocale } from '../../i18n/LocaleContext';
import { inspectOperation } from '../../api/collaboration';

type Execution = NonNullable<ToolCall['workflowExecution']>;

export default function WorkflowExecutionCard({ execution, timestamp }: {
  execution: Execution;
  timestamp?: string;
}) {
  const [phase, setPhase] = useState<ExecutionPhase>('running');
  const { t } = useLocale();
  const phaseLabel = {
    idle: t('chat.workflow.idle'), running: t('chat.workflow.running'),
    completed: t('chat.workflow.completed'), stopped: t('chat.workflow.stopped'),
    failed: t('chat.workflow.failed'), interrupted: t('chat.workflow.interrupted'),
  }[phase];

  useEffect(() => {
    if (phase !== 'running') return;
    let disposed = false;
    const sync = async () => {
      try {
        const fact = await inspectOperation(
          'tradewind', execution.workflowId, execution.executionId,
        );
        if (!disposed) {
          const update = executionUpdateFromProbe(fact);
          setPhase(current => update.terminalPhase
            ?? phaseFromExecutionStatus(update, current));
        }
      } catch {
        // 保留上一次真实状态，下一次轮询再对账。
      }
    };
    void sync();
    const id = setInterval(() => { void sync(); }, 2_000);
    return () => { disposed = true; clearInterval(id); };
  }, [execution.executionId, execution.workflowId, phase]);

  return (
    <div className="chat__message chat__message--assistant chat__message--tool">
      <div className="chat__avatar" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{t('chat.workflow.avatar')}</div>
      <div className="chat__bubble" style={{ minWidth: '240px' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{t('chat.workflow.title')}</div>
        <div style={{ marginTop: '2px', fontWeight: 'var(--font-semibold)' }}>{execution.workflowName}</div>
        <div style={{ marginTop: 'var(--space-2)', color: phasePresentation[phase].tone === 'running' ? 'var(--color-accent)' : 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          {phaseLabel}
        </div>
        {timestamp && <div className="chat__timestamp">{timestamp}</div>}
      </div>
    </div>
  );
}
