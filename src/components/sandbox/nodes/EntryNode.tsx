import { Handle, Position } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    inputContent?: string;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function EntryNode({ data, selected }: Props) {
  const colors: Record<string, string> = {
    idle: '#6b7280',
    running: '#3b82f6',
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
      <div className={`sandbox-node sandbox-node--entry${data.execStatus === 'running' ? ' sandbox-node--running' : ''}${data.execStatus === 'error' ? ' sandbox-node--error' : ''}${selected ? ' selected' : ''}`}
        style={data.execStatus === 'running' || data.execStatus === 'error' ? undefined : { borderColor }}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon">⬇</span>
          <span className="sandbox-node-label">{data.label || '入口'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ color: 'var(--color-text-tertiary)', fontSize: '11px' }}>
            {data.inputContent ? data.inputContent.slice(0, 60) + (data.inputContent.length > 60 ? '...' : '') : '输入指令...'}
          </div>
          {data.execStatus && (
            <div className="sandbox-node-status" style={{ color: borderColor }}>
              {data.execStatus === 'running' ? '执行中...' : data.execStatus === 'done' ? '完成' : data.execStatus === 'error' ? '错误' : '就绪'}
            </div>
          )}
        </div>
        <Handle type="source" position={Position.Bottom} id="out" />
      </div>
    </>
  );
}
