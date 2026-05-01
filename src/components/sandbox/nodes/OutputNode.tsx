import { Handle, Position } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    mode?: string;
    filePath?: string;
    fileNameTemplate?: string;
    format?: string;
    execStatus?: string;
    errorMessage?: string;
  };
  selected?: boolean;
}

export default function OutputNode({ data, selected }: Props) {
  const fileName = (data.fileNameTemplate || '{flow}_output')
    .replace(/\{flow\}/g, '<工作流>')
    .replace(/\{timestamp\}/g, '<TS>');
  const fullPath = `${data.filePath || 'workflow_output'}/${fileName}.${data.format || 'json'}`;

  return (
    <>
      <NodeResizer
        minWidth={180}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div
        className={`sandbox-node sandbox-node--output${selected ? ' selected' : ''}`}
      >
        <div className="sandbox-node-header">
          <span className="sandbox-node-icon" style={{ color: 'var(--color-success)' }}>💾</span>
          <span className="sandbox-node-label">{data.label || '输出'}</span>
          {data.execStatus === 'done' && (
            <span className="sandbox-node-status-dot" style={{ background: 'var(--color-success)' }} />
          )}
        </div>
        <div className="sandbox-node-body">
          <div className="sandbox-node-preview" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            {data.mode === 'final' ? '📋 最终输出' : '📸 快照'} &middot; {data.format || 'json'}
          </div>
          <div style={{
            fontSize: '9px',
            color: 'var(--color-text-tertiary)',
            marginTop: '4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono)',
          }}>
            {fullPath}
          </div>
        </div>
        <Handle type="target" position={Position.Top} id="in" />
      </div>
    </>
  );
}
