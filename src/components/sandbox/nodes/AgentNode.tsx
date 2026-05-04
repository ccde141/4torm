import { Handle, Position, NodeResizer } from '@xyflow/react';

interface Props {
  data: {
    label: string;
    agentName?: string;
    agentRole?: string;
    execStatus?: string;
    errorMessage?: string;
    inputPorts?: Array<{ id: string; label: string }>;
  };
  selected?: boolean;
}

export default function AgentNode({ data, selected }: Props) {
  const ports = data.inputPorts?.length ? data.inputPorts : [{ id: 'in-0', label: '输入' }];

  const statusColors: Record<string, string> = {
    idle: '#6b7280',
    running: '#3b82f6',
    done: '#22c55e',
    error: '#ef4444',
  };
  const statusColor = statusColors[data.execStatus || 'idle'] || statusColors.idle;

  const output: Array<{ id: string; top: string; label: string }> = [];
  for (let i = 0; i < ports.length; i++) {
    const pct = ports.length === 1 ? 50 : ((i + 1) / (ports.length + 1)) * 100;
    output.push({ id: ports[i].id, top: `${pct}%`, label: ports[i].label });
  }
  const handles = output;

  return (
    <>
      <NodeResizer
        minWidth={160}
        minHeight={60}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className={`sandbox-node sandbox-node--agent${data.execStatus === 'running' ? ' sandbox-node--running' : ''}${data.execStatus === 'error' ? ' sandbox-node--error' : ''}${selected ? ' selected' : ''}`}>
        <div className="sandbox-node-header" style={{ borderLeft: `3px solid ${statusColor}` }}>
          <div className="sandbox-agent-avatar">
            {(data.agentName || 'A')[0]}
          </div>
          <div className="sandbox-node-info">
            <span className="sandbox-node-label">{data.label || data.agentName || 'Agent'}</span>
            <span className="sandbox-node-sub" style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
              {data.agentName ? `↳ ${data.agentName}` : data.agentRole || 'AI 节点'}
            </span>
          </div>
          <div className="sandbox-node-status-dot" style={{ background: statusColor }} />
        </div>
        {handles.length > 1 && handles.map(h => (
          <div
            key={`label-${h.id}`}
            style={{
              position: 'absolute',
              top: h.top,
              left: 12,
              transform: 'translateY(-50%)',
              fontSize: 9,
              color: 'var(--color-text-tertiary)',
              pointerEvents: 'none',
              maxWidth: 60,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {h.label}
          </div>
        ))}
        {handles.map(h => (
          <Handle
            key={h.id}
            type="target"
            position={Position.Left}
            id={h.id}
            style={{ top: h.top }}
            title={h.label}
          />
        ))}
        <Handle type="source" position={Position.Right} id="out" />
      </div>
    </>
  );
}
