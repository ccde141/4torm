import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    prompt?: string;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function HumanGateNode({ data, selected }: Props) {
  const colors: Record<string, string> = {
    idle: '#fbbf24',
    running: '#fbbf24',
    done: '#22c55e',
    error: '#ef4444',
  };
  const borderColor = colors[data.execStatus || 'idle'] || colors.idle;

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--humangate${selected ? ' selected' : ''}`}
        style={{ borderColor }}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon">👤</span>
          <span className="sandbox-node-label">{data.label || '人工介入'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {data.prompt ? data.prompt.slice(0, 40) + '...' : '等待用户操作'}
          </div>
        </div>
        <Handle type="target" position={Position.Top} id="in" />
        <Handle type="source" position={Position.Bottom} id="out" />
      </div>
    </>
  );
}
