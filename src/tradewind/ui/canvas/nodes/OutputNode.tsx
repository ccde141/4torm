/**
 * Output 节点 — 工作流终点（绿色圆角小方块）
 */
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';

export function OutputNode({ data, selected }: NodeProps) {
  const memo = (data as any)?.memo ?? '';
  return (
    <div className={`tw-node tw-node--output ${selected ? 'tw-node--selected' : ''}`}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      <Handle type="target" position={Position.Left} className="tw-handle" />
      <div className="tw-node__icon">◼</div>
      <div className="tw-node__label">{(data as any)?.label ?? '出口'}</div>
      {memo && <div className="tw-node__memo">{memo}</div>}
    </div>
  );
}
