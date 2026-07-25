import { memo, useState } from 'react';
import { renderTextWithCode } from '../../../engine/markdown';
import { diffStat, lineDiff, type DiffLine } from '../../../utils/diff';
import type { MeetingMessage, ToolStep } from './meeting-client';

interface Props {
  msg: MeetingMessage;
}

function getFileEdit(step: ToolStep): { path: string; before: string; after: string } | null {
  const args = step.args || {};
  const str = (value: unknown) => value == null ? '' : String(value);
  const path = str(args.filePath || args.file_path || args.path);
  if (step.tool === 'edit_file') {
    return {
      path,
      before: str(args.oldString || args.old_str || args.oldStr),
      after: str(args.newString || args.new_str || args.newStr),
    };
  }
  if (step.tool === 'write_file') {
    return { path, before: str(step.diff?.before), after: str(args.content) };
  }
  return null;
}

function DiffRows({ lines }: { lines: DiffLine[] }) {
  return (
    <div style={{ overflow: 'auto', maxHeight: 320, border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--color-bg)' }}>
      {lines.slice(0, 400).map((line, index) => {
        const background = line.type === 'add' ? 'rgba(46,160,67,0.14)'
          : line.type === 'del' ? 'rgba(248,81,73,0.14)' : 'transparent';
        const edge = line.type === 'add' ? '#2ea043' : line.type === 'del' ? '#f85149' : 'transparent';
        const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        return (
          <div key={index} style={{ display: 'flex', background, borderLeft: `2px solid ${edge}`, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
            <span style={{ width: '1.2em', flexShrink: 0, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>{sign}</span>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 'var(--space-2)' }}>{line.text || ' '}</span>
          </div>
        );
      })}
      {lines.length > 400 && (
        <div style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          ... {lines.length - 400} lines hidden
        </div>
      )}
    </div>
  );
}

const ToolBubble = memo(function ToolBubble({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const status = step.status || 'done';
  const icon = status === 'running' ? '...' : status === 'error' ? 'X' : 'OK';
  const edit = getFileEdit(step);
  const lines = edit ? lineDiff(edit.before, edit.after) : [];
  const stat = edit ? diffStat(lines) : { add: 0, del: 0 };

  return (
    <div className={`tw-meeting-tool tw-meeting-tool--${status}`}>
      <button className="tw-meeting-tool__header" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span className="tw-meeting-tool__arrow">{open ? '▼' : '▶'}</span>
        <span className={`tw-meeting-tool__icon tw-meeting-tool__icon--${status}`}>{icon}</span>
        <span className="tw-meeting-tool__name">{step.tool}</span>
        {edit?.path && <span className="tw-meeting-tool__path">{edit.path}</span>}
        {stat.add > 0 && <span style={{ color: '#2ea043', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>+{stat.add}</span>}
        {stat.del > 0 && <span style={{ color: '#f85149', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>-{stat.del}</span>}
        {status === 'running' && <span className="tw-meeting-tool__spinner" />}
      </button>
      {open && (
        <div className="tw-meeting-tool__detail">
          <div className="tw-meeting-tool__section">
            <span className="tw-meeting-tool__label">{edit ? 'Diff' : '参数'}</span>
            {edit ? <DiffRows lines={lines} /> : <pre>{JSON.stringify(step.args, null, 2)}</pre>}
          </div>
          {step.result !== undefined && (
            <div className="tw-meeting-tool__section">
              <span className="tw-meeting-tool__label">结果</span>
              <pre>{step.result || '(无输出)'}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export const MeetingMessageItem = memo(function MeetingMessageItem({ msg }: Props) {
  if (msg.speaker === '人类') {
    return (
      <div className="tw-meeting-msg tw-meeting-msg--user">
        <span className="tw-meeting-msg__content">
          {renderTextWithCode(msg.content, `mtg-u-${msg.timestamp}`)}
        </span>
      </div>
    );
  }
  if (msg.noReply) {
    return (
      <div className="tw-meeting-msg tw-meeting-msg--no-reply">
        <span className="tw-meeting-msg__speaker">{msg.speaker}</span>
        <span className="tw-meeting-msg__no-reply">未回复</span>
      </div>
    );
  }

  const content = msg.content.trim();
  const tools = msg.toolCalls || [];
  return (
    <div className="tw-meeting-msg">
      <span className="tw-meeting-msg__speaker">{msg.speaker}</span>
      {msg.reasoning && <ThinkBlock content={msg.reasoning} streaming={msg.streaming} />}
      {tools.map((step, index) => <ToolBubble key={index} step={step} />)}
      {content && (
        <span className="tw-meeting-msg__content">
          {renderTextWithCode(content, `mtg-a-${msg.timestamp}`)}
          {msg.streaming && <span className="tw-chat-cursor" />}
        </span>
      )}
      {!content && msg.streaming && tools.length === 0 && <span className="tw-meeting-msg__content">...</span>}
    </div>
  );
});

const ThinkBlock = memo(function ThinkBlock({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const [open, setOpen] = useState(streaming);
  return (
    <div className="tw-meeting-think">
      <button className="tw-meeting-think__trigger" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span className="tw-meeting-think__arrow">{open ? '▼' : '▶'}</span>
        <span className="tw-meeting-think__label">思考过程{streaming && '...'}</span>
      </button>
      {open && <div className="tw-meeting-think__body">{content}{streaming && '...'}</div>}
    </div>
  );
});
