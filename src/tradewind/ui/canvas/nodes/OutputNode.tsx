/**
 * Output 节点 — 工作流终点（绿色圆角小方块）
 */
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';
import type { ExecutionPhase } from '../../hooks/execution-phase';

export function OutputNode({ data, selected }: NodeProps) {
  const memo = (data as any)?.memo ?? '';
  const runtimePhase = ((data as any)?.runtimePhase ?? 'idle') as ExecutionPhase;
  const reached = runtimePhase === 'completed';
  const missed = runtimePhase === 'stopped' || runtimePhase === 'failed' || runtimePhase === 'interrupted';
  const status = reached ? '已到达出口'
    : missed ? '未到达出口'
      : runtimePhase === 'running' ? '等待信封全量交接' : '工作流终点';
  const cls = [
    'tw-node', 'tw-node--output',
    selected ? 'tw-node--selected' : '',
    reached ? 'tw-node--output-complete' : '',
    missed ? 'tw-node--output-missed' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      <Handle type="target" position={Position.Left} className="tw-handle" />
      <div className="tw-node__icon">◼</div>
      <div className="tw-node__label">{(data as any)?.label ?? '出口'}</div>
      <div className={`tw-node__state-line tw-node__state-line--${reached ? 'complete' : missed ? 'missed' : 'idle'}`}>
        <span className="tw-node__state-dot" />
        <span>{status}</span>
      </div>
      {memo && <div className="tw-node__memo">{memo}</div>}
    </div>
  );
}
