/**
 * Entry 节点 — 工作流入口（蓝色圆角小方块）
 */
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';

export function EntryNode({ data, selected }: NodeProps) {
  const memo = (data as any)?.memo ?? '';
  return (
    <div className={`tw-node tw-node--entry ${selected ? 'tw-node--selected' : ''}`}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      <div className="tw-node__icon">▶</div>
      <div className="tw-node__label">{(data as any)?.label ?? '入口'}</div>
      {memo && <div className="tw-node__memo">{memo}</div>}
      <Handle type="source" position={Position.Right} className="tw-handle" />
    </div>
  );
}
