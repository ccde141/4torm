import { useMemo } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    branchCount?: number;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function ForkNode({ data, selected }: Props) {
  const branchCount = Math.min(data.branchCount || 2, 10);

  const handles = useMemo(() => {
    const result: Array<{ id: string; left: string }> = [];
    for (let i = 0; i < branchCount; i++) {
      const pct = ((i + 1) / (branchCount + 1)) * 100;
      result.push({ id: `fork-${i}`, left: `${pct}%` });
    }
    return result;
  }, [branchCount]);

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--fork${selected ? ' selected' : ''}`}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon" style={{ color: 'var(--color-info)' }}>⑂</span>
          <span className="sandbox-node-label">{data.label || '分叉'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {branchCount} 路分叉
          </div>
        </div>
        <Handle type="target" position={Position.Top} id="in" />
        {handles.map(h => (
          <Handle
            key={h.id}
            type="source"
            position={Position.Bottom}
            id={h.id}
            style={{ left: h.left }}
            title={h.id}
          />
        ))}
      </div>
    </>
  );
}
