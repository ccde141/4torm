import { useEffect, useState } from 'react';
import type { ToolCall } from '../../types';
import { phaseFromExecutionStatus, phasePresentation, type ExecutionPhase } from '../../tradewind/ui/hooks/execution-phase';

type Execution = NonNullable<ToolCall['workflowExecution']>;

function labelFor(phase: ExecutionPhase): string {
  if (phase === 'running') return '信风正在流转';
  return phasePresentation[phase].label;
}

export default function WorkflowExecutionCard({ execution, timestamp }: {
  execution: Execution;
  timestamp?: string;
}) {
  const [phase, setPhase] = useState<ExecutionPhase>('running');

  useEffect(() => {
    let disposed = false;
    const sync = async () => {
      try {
        const response = await fetch('/api/tradewind/status');
        if (!response.ok) return;
        const data = await response.json() as { running: boolean; executionId?: string; outcome?: 'done' | 'stopped' | 'error' };
        if (!disposed && data.executionId === execution.executionId) {
          setPhase(current => phaseFromExecutionStatus(data, current));
        }
      } catch {
        // 保留上一次真实状态，下一次轮询再对账。
      }
    };
    void sync();
    const id = setInterval(() => { void sync(); }, 2_000);
    return () => { disposed = true; clearInterval(id); };
  }, [execution.executionId]);

  return (
    <div className="chat__message chat__message--assistant chat__message--tool">
      <div className="chat__avatar" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>信</div>
      <div className="chat__bubble" style={{ minWidth: '240px' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>信风工作流</div>
        <div style={{ marginTop: '2px', fontWeight: 'var(--font-semibold)' }}>{execution.workflowName}</div>
        <div style={{ marginTop: 'var(--space-2)', color: phasePresentation[phase].tone === 'running' ? 'var(--color-accent)' : 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          {labelFor(phase)}
        </div>
        {timestamp && <div className="chat__timestamp">{timestamp}</div>}
      </div>
    </div>
  );
}
