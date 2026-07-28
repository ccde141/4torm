export type ExecutionPhase = 'idle' | 'running' | 'completed' | 'stopped' | 'failed' | 'interrupted';
export type ExecutionOutcome = 'done' | 'stopped' | 'error';

export interface ExecutionStatusSnapshot {
  running: boolean;
  outcome?: ExecutionOutcome | null;
}

export function phaseFromExecutionStatus(
  status: ExecutionStatusSnapshot,
  current: ExecutionPhase,
): ExecutionPhase {
  if (status.running) return 'running';
  if (status.outcome === 'done') return 'completed';
  if (status.outcome === 'stopped') return 'stopped';
  if (status.outcome === 'error') return 'failed';
  return current === 'running' ? 'interrupted' : current;
}

export const phasePresentation: Record<ExecutionPhase, { label: string; tone: string }> = {
  idle: { label: '就绪', tone: 'idle' },
  running: { label: '执行中 · 尚未到达出口', tone: 'running' },
  completed: { label: '已到达出口 · 工作流完成', tone: 'completed' },
  stopped: { label: '已停止 · 未到达出口', tone: 'stopped' },
  failed: { label: '执行失败 · 未到达出口', tone: 'failed' },
  interrupted: { label: '状态中断 · 未确认到达出口', tone: 'interrupted' },
};
