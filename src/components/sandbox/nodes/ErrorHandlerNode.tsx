import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function ErrorHandlerNode({ data, selected }: Props) {
  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--errorhandler${selected ? ' selected' : ''}`}>
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon" style={{ color: 'var(--color-error)' }}>⚠</span>
          <span className="sandbox-node-label">{data.label || '错误处理'}</span>
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            引擎自动路由错误
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} id="out" />
      </div>
    </>
  );
}
