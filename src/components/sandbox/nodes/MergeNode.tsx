import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    strategy?: string;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function MergeNode({ data, selected }: Props) {
  const strategyLabels: Record<string, string> = {
    concat: '顺序拼接',
    structured: '结构化',
    'agent-summary': 'Agent 摘要',
  };

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--merge${selected ? ' selected' : ''}`}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon" style={{ color: 'var(--color-accent)' }}>⊕</span>
          <span className="sandbox-node-label">{data.label || '合并'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {strategyLabels[data.strategy || 'concat'] || '顺序拼接'}
          </div>
        </div>
        <Handle type="target" position={Position.Top} id="in-0" style={{ left: '30%' }} />
        <Handle type="target" position={Position.Top} id="in-1" style={{ left: '70%' }} />
        <Handle type="source" position={Position.Bottom} id="out" />
      </div>
    </>
  );
}
