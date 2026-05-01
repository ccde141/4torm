import { useRef, useState, useEffect } from 'react';
import { NodeResizer } from '@xyflow/react';

interface Props {
  data: { label: string; content: string };
  selected?: boolean;
}

export default function NoteNode({ data, selected }: Props) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(data.label || '备注');
  const [content, setContent] = useState(data.content || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  const handleDoubleClick = () => setEditing(true);
  const handleBlur = () => { setEditing(false); data.label = label; data.content = content; };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setEditing(false); setLabel(data.label); setContent(data.content); }
  };

  return (
    <>
      <NodeResizer
        minWidth={140}
        minHeight={60}
        isVisible={selected}
        lineStyle={{ borderColor: 'var(--color-warning)' }}
        handleStyle={{ background: 'var(--color-warning)', border: '2px solid var(--color-bg)', width: 8, height: 8 }}
      />
      <div
        className={`sandbox-note-node${selected ? ' selected' : ''}`}
        style={{
          border: '1px solid rgba(251, 191, 36, 0.3)',
          borderRadius: 'var(--radius-sm)',
          background: 'rgba(251, 191, 36, 0.08)',
          minWidth: '140px',
          minHeight: '60px',
          padding: 'var(--space-3)',
          width: '100%',
          height: '100%',
        }}
      >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="sandbox-note-textarea"
          value={content}
          onChange={e => setContent(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="输入内容..."
          style={{
            width: '100%',
            minHeight: '60px',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-primary)',
            fontSize: '11px',
            fontFamily: 'inherit',
            lineHeight: '1.5',
              resize: 'none',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <div onDoubleClick={handleDoubleClick} style={{ cursor: 'text' }}>
          <div
            className="sandbox-note-label"
            style={{
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--font-semibold)',
              color: 'var(--color-warning)',
              marginBottom: 'var(--space-1)',
            }}
          >
            {label}
          </div>
          <div
            className="sandbox-note-content"
            style={{
              fontSize: '11px',
              color: 'var(--color-text-secondary)',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {content || '双击编辑...'}
          </div>
        </div>
      )}
    </div>
    </>
  );
}
