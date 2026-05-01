import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    loopType?: string;
    count?: number;
    conditionField?: string;
    conditionOperator?: string;
    conditionValue?: string;
    maxIterations?: number;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function LoopNode({ data, selected }: Props) {
  const info = `条件: ${data.conditionField || '?'} ${data.conditionOperator || 'neq'} ${data.conditionValue || 'done'} | 上限 ${data.maxIterations || 10}`;

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--loop${selected ? ' selected' : ''}`}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon" style={{ color: 'var(--color-info)' }}>↻</span>
          <span className="sandbox-node-label">{data.label || '条件循环'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {info}
          </div>
        </div>
        <Handle type="target" position={Position.Top} id="in" />
        <Handle type="source" position={Position.Bottom} id="loop-body" style={{ left: '35%' }} title="循环体" />
        <Handle type="source" position={Position.Bottom} id="loop-exit" style={{ left: '65%' }} title="退出" />
      </div>
    </>
  );
}
