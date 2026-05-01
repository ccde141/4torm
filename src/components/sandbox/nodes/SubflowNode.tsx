import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    subflowName?: string;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function SubflowNode({ data, selected }: Props) {
  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--subflow${selected ? ' selected' : ''}`}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon">📦</span>
          <span className="sandbox-node-label">{data.label || '子流程'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {data.subflowName || '未选择工作流'}
          </div>
        </div>
        <Handle type="target" position={Position.Top} id="in" />
        <Handle type="source" position={Position.Bottom} id="out" />
      </div>
    </>
  );
}
