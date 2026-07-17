import type { ChatMessage, ToolStep } from '../../types';
import { formatStreamStatus, getToolTarget } from './stream-status';

function findRunningStep(steps: ToolStep[] | undefined): ToolStep | undefined {
  return steps?.findLast(step => step.status === 'running');
}

export default function ExecutionStatusBar({ message, label: suppliedLabel, target: suppliedTarget }: {
  message?: ChatMessage;
  label?: string;
  target?: string;
}) {
  const phase = message?.streamingPhase;
  if (!phase && !suppliedLabel) return null;

  const running = findRunningStep(message?.toolSteps);
  const tool = message?.streamingTool ?? running?.tool;
  const target = phase === 'tool-exec' ? getToolTarget(running?.args) : undefined;
  const label = suppliedLabel ?? formatStreamStatus(
    phase!, message?.phaseElapsed, tool, message?.streamingArgumentChars,
  );
  const visibleTarget = suppliedTarget ?? target;

  return (
    <div className="chat__execution-status" role="status" aria-live="polite">
      <span className="chat__execution-status-dot" aria-hidden="true" />
      <span className="chat__execution-status-label">{label}</span>
      {visibleTarget && <span className="chat__execution-status-target" title={visibleTarget}>{visibleTarget}</span>}
    </div>
  );
}
