import { useMemo, useState } from 'react';
import type { ChatMessage } from '../../../types';
import { computeDiffView, type DiffLine } from '../../../utils/diff';

const MAX_LINES = 400;

type ToolCall = NonNullable<ChatMessage['toolCall']>;

export function parseFileEdit(toolCall: ToolCall): { kind: 'edit' | 'write'; path: string; before: string; after: string } | null {
  const name = toolCall.toolName;
  const p = (toolCall.params || {}) as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? '' : String(v));
  const path = str(p.filePath || p.file_path || p.path);

  if (name === 'edit_file') {
    return {
      kind: 'edit',
      path,
      before: str(p.oldString || p.old_str || p.oldStr),
      after: str(p.newString || p.new_str || p.newStr),
    };
  }

  if (name === 'write_file') {
    return { kind: 'write', path, before: str(toolCall.diff?.before), after: str(p.content) };
  }

  return null;
}

function DiffRows({ lines }: { lines: DiffLine[] }) {
  const shown = lines.slice(0, MAX_LINES);
  const hidden = lines.length - shown.length;

  return (
    <div style={{ margin: 0, borderRadius: '6px', overflow: 'auto', maxHeight: '360px', border: '1px solid var(--border-color)', background: 'var(--color-bg)' }}>
      {shown.map((line, index) => {
        const bg = line.type === 'add' ? 'rgba(46,160,67,0.14)' : line.type === 'del' ? 'rgba(248,81,73,0.14)' : 'transparent';
        const edge = line.type === 'add' ? '#2ea043' : line.type === 'del' ? '#f85149' : 'transparent';
        const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';

        return (
          <div key={index} style={{ display: 'flex', background: bg, borderLeft: `2px solid ${edge}`, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
            <span style={{ width: '1.2em', flexShrink: 0, textAlign: 'center', color: 'var(--color-text-tertiary)', userSelect: 'none' }}>{sign}</span>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 'var(--space-2)' }}>{line.text || ' '}</span>
          </div>
        );
      })}
      {hidden > 0 && (
        <div style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          ... {hidden} lines hidden
        </div>
      )}
    </div>
  );
}

export default function FileDiffCard({ toolCall, edit }: {
  toolCall: ToolCall;
  edit: NonNullable<ReturnType<typeof parseFileEdit>>;
}) {
  const [expanded, setExpanded] = useState(edit.kind === 'edit');
  // memo + 大文件退回摘要：否则 O(m×n) LCS 每次渲染都跑，覆盖写入大文件会冻死画布
  const view = useMemo(() => computeDiffView(edit.before, edit.after), [edit.before, edit.after]);
  const { add, del } = view;
  const fileName = edit.path.split(/[\\/]/).pop() || edit.path;
  const dir = edit.path.slice(0, edit.path.length - fileName.length);
  const status = toolCall.status === 'error' ? 'error' : toolCall.result ? 'success' : 'pending';

  return (
    <div className="tw-chat-row tw-chat-row--assistant">
      <div className="tw-chat-avatar tw-chat-avatar--tool">{edit.kind === 'edit' ? 'E' : 'W'}</div>
      <div className={`tw-chat-bubble tw-tool-card--${status}`} style={{ padding: 0, overflow: 'hidden' }}>
        <button className="tw-tool-card__header" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <span className={`tw-tool-card__arrow${expanded ? ' tw-tool-card__arrow--open' : ''}`}>▶</span>
          <span className="tw-tool-card__name">{toolCall.toolName}</span>
          <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }} title={edit.path}>
            <span style={{ color: 'var(--color-text-tertiary)' }}>{dir}</span><span style={{ color: 'var(--color-text-secondary)' }}>{fileName}</span>
          </span>
          {add > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: '#2ea043' }}>+{add}</span>}
          {del > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: '#f85149' }}>-{del}</span>}
          {toolCall.status === 'pending' && <span className="tw-tool-card__spinner" />}
        </button>

        {expanded && (
          <div className="tw-tool-card__body">
            {view.tooLarge ? (
              <div style={{ padding: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--color-bg)' }}>
                文件较大，已省略逐行 diff（约 {del} 行 → {add} 行整体替换）
              </div>
            ) : (
              <DiffRows lines={view.lines} />
            )}
            {toolCall.result && (
              <div style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: toolCall.status === 'error' ? '#f85149' : 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                {toolCall.result}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
