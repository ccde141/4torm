import { useMemo, useState } from 'react';
import BoundedText from '../../engine/text-display/BoundedText';
import type { ChatMessage } from '../../types';
import { formatTimestamp } from '../../utils/time';
import { computeDiffView, type DiffLine } from '../../utils/diff';
import { useLocale } from '../../i18n/LocaleContext';

/** 单次展示的最大 diff 行数，超出截断（write_file 写大文件时防止卡死）。 */
const MAX_LINES = 400;

type ToolCall = NonNullable<ChatMessage['toolCall']>;

/** 识别文件改动类工具，并把杂乱的参数别名归一成 { path, before, after }。 */
export function parseFileEdit(toolCall: ToolCall): { kind: 'edit' | 'write'; path: string; before: string; after: string } | null {
  const name = toolCall.toolName;
  const p = (toolCall.params || {}) as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? '' : String(v));
  const path = str(p.filePath || p.file_path || p.path);

  if (name === 'edit_file') {
    return { kind: 'edit', path, before: str(p.oldString || p.old_str || p.oldStr), after: str(p.newString || p.new_str || p.newStr) };
  }
  if (name === 'write_file') {
    // 覆盖写入时旧内容由侧通道（toolCall.diff.before）带来，可渲染真实 diff；新建文件无 before → 全新增
    return { kind: 'write', path, before: str(toolCall.diff?.before), after: str(p.content) };
  }
  return null;
}

function DiffRows({ lines, hiddenLabel }: { lines: DiffLine[]; hiddenLabel: (count: number) => string }) {
  const shown = lines.slice(0, MAX_LINES);
  const hidden = lines.length - shown.length;
  return (
    <div style={{ margin: 0, borderRadius: 'var(--radius-sm)', overflow: 'auto', maxHeight: '360px', border: '1px solid var(--border-color)', background: 'var(--color-bg)' }}>
      {shown.map((l, i) => {
        const bg = l.type === 'add' ? 'rgba(46,160,67,0.14)' : l.type === 'del' ? 'rgba(248,81,73,0.14)' : 'transparent';
        const edge = l.type === 'add' ? '#2ea043' : l.type === 'del' ? '#f85149' : 'transparent';
        const sign = l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ';
        return (
          <div key={i} style={{ display: 'flex', background: bg, borderLeft: `2px solid ${edge}`, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
            <span style={{ width: '1.2em', flexShrink: 0, textAlign: 'center', color: 'var(--color-text-tertiary)', userSelect: 'none' }}>{sign}</span>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 'var(--space-2)' }}>{l.text || ' '}</span>
          </div>
        );
      })}
      {hidden > 0 && (
        <div style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {hiddenLabel(hidden)}
        </div>
      )}
    </div>
  );
}

export default function FileDiffCard({ toolCall, edit, actions, timestamp }: {
  toolCall: ToolCall;
  edit: NonNullable<ReturnType<typeof parseFileEdit>>;
  actions?: React.ReactNode;
  timestamp?: string;
}) {
  // edit_file 默认展开（改动小、就是要看的）；write_file 默认折叠（可能很大）
  const [expanded, setExpanded] = useState(edit.kind === 'edit');
  const { t } = useLocale();
  // 关键：diff 计算要 memo，且对大文件退回廉价摘要——否则 O(m×n) LCS 会在每次渲染冻死整页
  const view = useMemo(() => computeDiffView(edit.before, edit.after), [edit.before, edit.after]);
  const { add, del } = view;
  const fileName = edit.path.split(/[\\/]/).pop() || edit.path;
  const dir = edit.path.slice(0, edit.path.length - fileName.length);
  const isError = toolCall.status === 'error';
  const isRunning = toolCall.status === 'pending' || toolCall.status === 'running';

  return (
    <div className="chat__message chat__message--assistant chat__message--tool">
      <div className="chat__avatar" style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>{edit.kind === 'edit' ? '✏️' : '📝'}</div>
      <div className={`chat__bubble${isRunning ? ' chat__tool-running' : ''}`} style={{ minWidth: '280px', maxWidth: '100%' }}>
        <button
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', userSelect: 'none', appearance: 'none', border: 'none', background: 'none', font: 'inherit', color: 'inherit', padding: 0, width: '100%', textAlign: 'left' }}
        >
          <span style={{ fontSize: '10px', transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-accent)' }}>
            {toolCall.toolName}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }} title={edit.path}>
            <span style={{ color: 'var(--color-text-tertiary)' }}>{dir}</span><span style={{ color: 'var(--color-text-secondary)' }}>{fileName}</span>
          </span>
          {add > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: '#2ea043' }}>+{add}</span>}
          {del > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: '#f85149' }}>−{del}</span>}
          <span style={{ fontSize: 'var(--text-xs)' }}>{isRunning ? t('chat.tool.runningShort') : isError ? '❌' : toolCall.result ? '✅' : ''}</span>
        </button>
        {expanded && (
          <div style={{ marginTop: 'var(--space-2)' }}>
            {view.tooLarge ? (
              <div style={{ padding: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)' }}>
                {t('chat.diff.tooLarge', { before: del, after: add })}
              </div>
            ) : (
              <DiffRows lines={view.lines} hiddenLabel={count => t('chat.diff.hiddenLines', { count })} />
            )}
            {toolCall.result && (
              <div style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: isError ? '#f85149' : 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                <BoundedText text={toolCall.result} />
              </div>
            )}
          </div>
        )}
        {actions && <div className="chat__bubble-actions" style={{ marginTop: 'var(--space-1)' }}>{actions}</div>}
        {timestamp && <div className="chat__timestamp" title={formatTimestamp(timestamp, true)}>{formatTimestamp(timestamp)}</div>}
      </div>
    </div>
  );
}
