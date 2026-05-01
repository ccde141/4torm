import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    mode?: string;
    variableName?: string;
    sourceField?: string;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function VariableNode({ data, selected }: Props) {
  const icon = data.mode === 'read' ? '📖' : '✏️';
  const action = data.mode === 'read' ? '读取' : '写入';

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--variable${selected ? ' selected' : ''}`}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon">{icon}</span>
          <span className="sandbox-node-label">{data.label || '变量'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {action} {data.variableName || '?'}
          </div>
        </div>
        <Handle type="target" position={Position.Top} id="in" />
        <Handle type="source" position={Position.Bottom} id="out" />
      </div>
    </>
  );
}
