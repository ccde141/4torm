/**
 * Note 节点 — 便签纸样式（暖黄色）
 */
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react';

export function NoteNode({ data, selected }: NodeProps) {
  const config = (data as any)?.config ?? {};
  const preview = (config.content ?? '').slice(0, 40);
  const memo = (data as any)?.memo ?? '';
  return (
    <div className={`tw-node tw-node--note ${selected ? 'tw-node--selected' : ''}`}>
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      <div className="tw-node__icon">📝</div>
      <div className="tw-node__label">{(data as any)?.label ?? 'Note'}</div>
      {preview && <div className="tw-node__sub">{preview}…</div>}
      {memo && <div className="tw-node__memo">{memo}</div>}
      <Handle type="source" position={Position.Right} className="tw-handle" />
    </div>
  );
}
