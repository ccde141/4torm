import React from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    execStatus?: string;
    errorMessage?: string;
    [key: string]: unknown;
  };
  selected?: boolean;
}

export default function CustomNodeBase({ data, selected, color }: Props & { color?: string }) {
  const c = color || '#6366f1';
  const statusColor =
    data.execStatus === 'running' ? '#3b82f6' :
    data.execStatus === 'done' ? '#22c55e' :
    data.execStatus === 'error' ? '#ef4444' : c;

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--custom${data.execStatus === 'running' ? ' sandbox-node--running' : ''}${data.execStatus === 'error' ? ' sandbox-node--error' : ''}${selected ? ' selected' : ''}`}
        style={data.execStatus === 'running' || data.execStatus === 'error' ? {} : { borderColor: c }}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon">⚙</span>
          <span className="sandbox-node-label">{data.label || 'Custom'}</span>
          <div className="sandbox-node-status-dot" style={{ background: statusColor }} />
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {data.label || 'custom'}
          </div>
        </div>
        <Handle type="target" position={Position.Top} id="in" />
        <Handle type="source" position={Position.Bottom} id="out" />
      </div>
    </>
  );
}
