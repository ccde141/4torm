import { useMemo } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    rules?: Array<{ field: string; operator: string; value: string }>;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function ConditionNode({ data, selected }: Props) {
  const rules = data.rules || [];
  const ruleCount = rules.length;
  const totalHandles = ruleCount + 1;

  const handles = useMemo(() => {
    const result: Array<{ id: string; left: string; label: string }> = [];
    for (let i = 0; i < ruleCount; i++) {
      const pct = ((i + 1) / (totalHandles + 1)) * 100;
      result.push({ id: `output-${i}`, left: `${pct}%`, label: `规则 ${i + 1}` });
    }
    const defaultPct = (totalHandles / (totalHandles + 1)) * 100;
    result.push({ id: 'output-default', left: `${defaultPct}%`, label: '默认' });
    return result;
  }, [ruleCount, totalHandles]);

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--condition${selected ? ' selected' : ''}`}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon" style={{ color: 'var(--color-warning)' }}>◇</span>
          <span className="sandbox-node-label">{data.label || '条件分支'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {ruleCount > 0
              ? rules.map((r, i) => (
                  <div key={i}>{r.field} {r.operator} {r.value}</div>
                ))
              : '未配置条件'}
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
            title={h.label}
          />
        ))}
      </div>
    </>
  );
}
