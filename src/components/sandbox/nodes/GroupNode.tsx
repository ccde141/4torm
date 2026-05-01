import { useRef, useState, useEffect } from 'react';
import { NodeResizer } from '@xyflow/react';

interface Props {
  data: { label: string };
  selected?: boolean;
}

export default function GroupNode({ data, selected }: Props) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(data.label || '组');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const handleDoubleClick = () => setEditing(true);
  const handleBlur = () => { setEditing(false); data.label = label; };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { setEditing(false); data.label = label; }
    if (e.key === 'Escape') { setEditing(false); setLabel(data.label); }
  };

  return (
    <>
      <NodeResizer
        minWidth={160}
        minHeight={100}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-accent)' }}
        handleStyle={{ background: 'var(--color-accent)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div className="sandbox-group-node" style={{ width: '100%', height: '100%' }}>
        <div className="sandbox-group-header">
          {editing ? (
            <input
              ref={inputRef}
              className="sandbox-group-label-input"
              value={label}
              onChange={e => setLabel(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-accent)',
                color: 'var(--color-text-primary)',
                fontSize: '12px',
                fontFamily: 'inherit',
                outline: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                width: '120px',
              }}
            />
          ) : (
            <span
              className="sandbox-group-label"
              onDoubleClick={handleDoubleClick}
              style={{
                fontSize: '12px',
                fontWeight: 'var(--font-semibold)',
                color: selected ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                cursor: 'text',
                userSelect: 'none',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                background: selected ? 'rgba(124, 58, 237, 0.2)' : 'rgba(124, 58, 237, 0.08)',
              }}
            >
              {label}
            </span>
          )}
        </div>
        <div style={{ flex: 1 }} />
      </div>
    </>
  );
}
