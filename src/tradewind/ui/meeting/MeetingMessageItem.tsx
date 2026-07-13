/**
 * 信风会议室公共消息单元
 *
 * 复现对流的"工具气泡 + 结构化文本"渲染逻辑：
 * - 流式态：tool-call/tool-result 累计为 ToolStep[]，未闭合 <action 探测进度
 * - 结束态：rawContent 解析 think/answer 标签，工具卡可折叠展开
 *
 * 信风独立副本，CSS 命名空间 tw-meeting-tool-* 与对流 stmsg-tool-* 完全隔离。
 */
import { memo, useState } from 'react';
import type { MeetingMessage, ToolStep } from './meeting-client';
import { parseStructuredContent } from '../chat/parser';
import { renderTextWithCode } from '../../../engine/markdown';
import { lineDiff, diffStat, type DiffLine } from '../../../utils/diff';

interface Props {
  msg: MeetingMessage;
}

interface PendingActionInfo {
  tool: string;
  filePath?: string;
  bodyLen: number;
}

interface StreamView {
  think: string;
  thinkStreaming: boolean;
  note: string;
  noteStreaming: boolean;
  answer: string;
  answerStreaming: boolean;
  pending: PendingActionInfo | null;
}

/**
 * 流式态视图构建：
 * - think/note/answer 闭合优先，未闭合时取开标签后的内容流式显示
 * - thinkStreaming/noteStreaming 标志闭合状态（用于 UI 展开/折叠默认值）
 * - 未闭合 <action 探测进度
 * - 无 <answer> 时，剥离 think/action/note 后的剩余文本作为可见内容
 */
function buildStreamView(content: string): StreamView {
  const extractStreaming = (tags: string[]): { value: string; streaming: boolean } => {
    for (const tag of tags) {
      const closed = content.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      if (closed) return { value: closed[1].trim(), streaming: false };
    }
    for (const tag of tags) {
      const open = content.match(new RegExp(`<${tag}>([\\s\\S]*)`, 'i'));
      if (open) return { value: open[1].trim(), streaming: true };
    }
    return { value: '', streaming: false };
  };

  const t = extractStreaming(['think', 'thinking']);
  const n = extractStreaming(['note']);
  const a = extractStreaming(['answer']);

  // pending action 探测：先剥已闭合 action，再看是否有未闭合
  const stripped = content.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '');
  const unclosedIdx = stripped.lastIndexOf('<action');
  let pending: PendingActionInfo | null = null;
  if (unclosedIdx !== -1 && stripped.indexOf('</action>', unclosedIdx) === -1) {
    const fragment = content.slice(content.lastIndexOf('<action'));
    const toolMatch = /tool\s*=\s*["']([^"']+)["']/.exec(fragment);
    const pathMatch = /"filePath"\s*:\s*"([^"]*)"/.exec(fragment);
    const bodyStart = fragment.indexOf('>');
    const bodyLen = bodyStart !== -1 ? fragment.length - bodyStart - 1 : 0;
    pending = { tool: toolMatch?.[1] || '...', filePath: pathMatch?.[1], bodyLen };
  }

  // 如果没有 <answer> 标签，用剥离所有结构标签后的剩余文本作为可见内容
  let answerValue = a.value;
  let answerStreaming = a.streaming;
  if (!answerValue && !answerStreaming) {
    const remainder = content
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
      .replace(/<think(?:ing)?>[\s\S]*/i, '')  // 未闭合 think 也剥离
      .replace(/<note>[\s\S]*?<\/note>/gi, '')
      .replace(/<note>[\s\S]*/i, '')
      .replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '')
      .replace(/<action\s[\s\S]*/i, '')  // 未闭合 action 也剥离
      .trim();
    if (remainder) {
      answerValue = remainder;
      answerStreaming = true; // 视为仍在输出
    }
  }

  return {
    think: t.value,
    thinkStreaming: t.streaming,
    note: n.value,
    noteStreaming: n.streaming,
    answer: answerValue,
    answerStreaming,
    pending,
  };
}

function formatBytes(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`;
}

function getFileEdit(step: ToolStep): { path: string; before: string; after: string } | null {
  const args = step.args || {};
  const str = (v: unknown) => (v == null ? '' : String(v));
  const path = str(args.filePath || args.file_path || args.path);

  if (step.tool === 'edit_file') {
    return { path, before: str(args.oldString || args.old_str || args.oldStr), after: str(args.newString || args.new_str || args.newStr) };
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
        const bg = line.type === 'add' ? 'rgba(46,160,67,0.14)' : line.type === 'del' ? 'rgba(248,81,73,0.14)' : 'transparent';
        const edge = line.type === 'add' ? '#2ea043' : line.type === 'del' ? '#f85149' : 'transparent';
        const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        return (
          <div key={index} style={{ display: 'flex', background: bg, borderLeft: `2px solid ${edge}`, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
            <span style={{ width: '1.2em', flexShrink: 0, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>{sign}</span>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingRight: 'var(--space-2)' }}>{line.text || ' '}</span>
          </div>
        );
      })}
      {lines.length > 400 && <div style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>... {lines.length - 400} lines hidden</div>}
    </div>
  );
}

const ToolBubble = memo(function ToolBubble({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const status = step.status || 'done';
  const icon = status === 'running' ? '⏳' : status === 'error' ? '❌' : '✅';
  const edit = getFileEdit(step);
  const lines = edit ? lineDiff(edit.before, edit.after) : [];
  const stat = edit ? diffStat(lines) : { add: 0, del: 0 };
  return (
    <div className={`tw-meeting-tool tw-meeting-tool--${status}`}>
      <button className="tw-meeting-tool__header" onClick={() => setOpen(o => !o)} aria-expanded={open}>
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
          {edit ? (
            <div className="tw-meeting-tool__section">
              <span className="tw-meeting-tool__label">Diff</span>
              <DiffRows lines={lines} />
            </div>
          ) : (
            <div className="tw-meeting-tool__section">
              <span className="tw-meeting-tool__label">参数</span>
              <pre>{JSON.stringify(step.args, null, 2)}</pre>
            </div>
          )}
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

const PendingBubble = memo(function PendingBubble({ info }: { info: PendingActionInfo }) {
  return (
    <div className="tw-meeting-tool tw-meeting-tool--running">
      <div className="tw-meeting-tool__header tw-meeting-tool__header--static">
        <span className="tw-meeting-tool__icon tw-meeting-tool__icon--running">⏳</span>
        <span className="tw-meeting-tool__name">{info.tool}</span>
        {info.filePath && <span className="tw-meeting-tool__path">{info.filePath}</span>}
        <span className="tw-meeting-tool__spinner" />
      </div>
      {info.bodyLen > 100 && (
        <div className="tw-meeting-tool__pending-size">{formatBytes(info.bodyLen)} 写入中...</div>
      )}
    </div>
  );
});

export const MeetingMessageItem = memo(function MeetingMessageItem({ msg }: Props) {
  const isHuman = msg.speaker === '人类';
  if (isHuman) {
    return (
      <div className="tw-meeting-msg tw-meeting-msg--user">
        <span className="tw-meeting-msg__content">{renderTextWithCode(msg.content, `mtg-u-${msg.timestamp}`)}</span>
      </div>
    );
  }

  // 流式态：标签闭合即定型（think 折叠 / note 块 / answer 主体）；未闭合标签静默
  if (msg.streaming) {
    const view = buildStreamView(msg.content);
    const tools = msg.toolCalls || [];
    // 兜底：content 中有已闭合 action 但 toolCalls 事件尚未到达时，解析显示
    let closedActionFallback: Array<{ tool: string }> = [];
    if (tools.length === 0) {
      const closedRe = /<action\s+[^>]*?\btool\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/action>/gi;
      let cm: RegExpExecArray | null;
      while ((cm = closedRe.exec(msg.content)) !== null) {
        closedActionFallback.push({ tool: cm[1].trim() });
      }
    }
    const empty = !view.think && !view.note && !view.answer && tools.length === 0 && closedActionFallback.length === 0 && !view.pending;
    return (
      <div className="tw-meeting-msg">
        <span className="tw-meeting-msg__speaker">{msg.speaker}</span>
        {view.think && <ThinkBlock content={view.think} streaming={view.thinkStreaming} />}
        {tools.length > 0
          ? tools.map((t, i) => <ToolBubble key={i} step={t} />)
          : closedActionFallback.map((t, i) => (
              <div key={i} className="tw-meeting-tool tw-meeting-tool--running">
                <div className="tw-meeting-tool__header tw-meeting-tool__header--static">
                  <span className="tw-meeting-tool__icon tw-meeting-tool__icon--running">⏳</span>
                  <span className="tw-meeting-tool__name">{t.tool}</span>
                  <span className="tw-meeting-tool__spinner" />
                </div>
              </div>
            ))
        }
        {view.pending && <PendingBubble info={view.pending} />}
        {view.answer && <span className="tw-meeting-msg__content">{renderTextWithCode(view.answer, `mtg-s-${msg.timestamp}`)}{ view.answerStreaming && '▍'}</span>}
        {view.note && (
          <div className="tw-meeting-note">
            <div className="tw-meeting-note__header">💡 提醒</div>
            <div className="tw-meeting-note__body">{view.note}</div>
          </div>
        )}
        {empty && <span className="tw-meeting-msg__content">▍</span>}
      </div>
    );
  }
  // 无回复：显式灰字呈现，与正常发言区分
  if (msg.noReply) {
    return (
      <div className="tw-meeting-msg tw-meeting-msg--no-reply">
        <span className="tw-meeting-msg__speaker">{msg.speaker}</span>
        <span className="tw-meeting-msg__no-reply">未回复</span>
      </div>
    );
  }

  // 结束态：解析 think/answer/note 分块渲染（think 折叠，note 单独区块）
  const source = msg.rawContent || msg.content;
  const parsed = parseStructuredContent(source);
  const tools = msg.toolCalls || [];
  const answerText = parsed.answer || msg.content;
  return (
    <div className="tw-meeting-msg">
      <span className="tw-meeting-msg__speaker">{msg.speaker}</span>
      {parsed.think && <ThinkBlock content={parsed.think} />}
      {tools.map((t, i) => <ToolBubble key={i} step={t} />)}
      {answerText && <span className="tw-meeting-msg__content">{renderTextWithCode(answerText, `mtg-a-${msg.timestamp}`)}</span>}
      {parsed.note && (
        <div className="tw-meeting-note">
          <div className="tw-meeting-note__header">💡 提醒</div>
          <div className="tw-meeting-note__body">{parsed.note}</div>
        </div>
      )}
    </div>
  );
});

const ThinkBlock = memo(function ThinkBlock({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const [open, setOpen] = useState(streaming);
  return (
    <div className="tw-meeting-think">
      <button className="tw-meeting-think__trigger" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="tw-meeting-think__arrow">{open ? '▼' : '▶'}</span>
        <span className="tw-meeting-think__label">思考过程{streaming && '...'}</span>
      </button>
      {open && <div className="tw-meeting-think__body">{content}{streaming && '▍'}</div>}
    </div>
  );
});
