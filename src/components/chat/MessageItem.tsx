/**
 * 单条消息项（memo 化）
 *
 * 从 ChatPage 的消息 map 内联渲染抽出，配合自定义比较器：
 * 流式刷新时只有最后一条消息换新引用，历史消息引用不变 → 直接跳过重渲，
 * 不再每 80ms 把所有历史长消息重新 parse + markdown 渲染（卡顿根因）。
 *
 * 比较器故意忽略回调身份：回调在单次流式轮次内闭包稳定；
 * 切会话时整个 messages 数组替换，所有项 msg 引用变化自然全部重渲，无 stale 风险。
 */

import { memo } from 'react';
import StructuredMessage from './StructuredMessage';
import ToolCallMessage from './ToolCallMessage';
import DelegateCard from './DelegateCard';
import AskCard from './AskCard';
import { parseStructuredOutput } from '../../engine/parser';
import { renderTextWithCode } from '../../engine/markdown';
import { formatTimestamp } from '../../utils/time';
import type { ChatMessage } from '../../types';

export interface MessageItemProps {
  msg: ChatMessage;
  /** 是否为正在流式输出的最后一条（= streaming && msg === messages[last]） */
  isStreaming: boolean;
  isEditing: boolean;
  editContent: string;
  setEditContent: (s: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: (msg: ChatMessage) => void;
  onDeleteMessage: (id: string) => void;
  onAskReply: (msgId: string, answer: string) => void;
}

function MessageItemInner({
  msg, isStreaming, isEditing, editContent, setEditContent,
  onSaveEdit, onCancelEdit, onStartEdit, onDeleteMessage, onAskReply,
}: MessageItemProps) {
  if (isEditing) {
    return (
      <div className={`chat__message chat__message--${msg.role}`}>
        <div className="chat__avatar">{msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : 'S'}</div>
        <div className="chat__bubble chat__bubble--editing">
          <textarea className="chat__edit-textarea" value={editContent} onChange={e => setEditContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) onSaveEdit(); }}
            rows={3} autoFocus />
          <div className="chat__edit-actions">
            <button onClick={onSaveEdit}>保存</button>
            <button onClick={onCancelEdit}>取消</button>
          </div>
          {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
        </div>
      </div>
    );
  }

  if ((msg as any).type === 'compact-marker') {
    return (
      <div className="chat__compact-marker">
        <span className="chat__compact-marker-line" />
        <button
          className="chat__compact-marker-toggle"
          onClick={() => {
            const el = document.getElementById(`compact-detail-${msg.id}`);
            if (el) el.classList.toggle('chat__compact-detail--open');
          }}
        >
          以上已压缩 · 点击查看摘要
        </button>
        <span className="chat__compact-marker-line" />
        <div id={`compact-detail-${msg.id}`} className="chat__compact-detail">
          <div className="chat__compact-detail-content">{msg.content}</div>
        </div>
      </div>
    );
  }

  if (msg.toolCall) {
    return msg.toolCall.toolName === 'delegate' ? (
      <DelegateCard
        toolCall={msg.toolCall}
        content={msg.content}
        timestamp={msg.timestamp}
        actions={
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
        }
      />
    ) : (
      <ToolCallMessage
        toolCall={msg.toolCall}
        timestamp={msg.timestamp}
        actions={
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
        }
      />
    );
  }

  if (msg.ask) {
    return (
      <AskCard
        question={msg.ask.question}
        options={msg.ask.options}
        answered={msg.ask.answered}
        reply={msg.ask.reply}
        onReply={(answer) => onAskReply(msg.id, answer)}
      />
    );
  }

  if (msg.role === 'assistant') {
    // 流式中的最后一条消息：识别 <answer> 段（含未闭合）+ 剥离 think/action 标签
    if (isStreaming) {
      const raw = msg.content;
      // 优先级 1: 已闭合 <answer>...</answer>
      const closed = /<answer>([\s\S]*?)<\/answer>/i.exec(raw);
      // 优先级 2: 未闭合 <answer>... 取到末尾
      const open = !closed ? /<answer>([\s\S]*)$/i.exec(raw) : null;

      let display: string;
      if (closed) {
        display = closed[1].trim();
      } else if (open) {
        display = open[1].trim();
      } else {
        // 优先级 3: 剥离已知标签，显示标签外裸文本
        let stripped = raw;
        stripped = stripped.replace(/<think>[\s\S]*?<\/think>/gi, '');
        stripped = stripped.replace(/<action\s[^>]*>[\s\S]*?<\/action>/gi, '');
        const unclosed = stripped.lastIndexOf('<action');
        if (unclosed !== -1 && stripped.indexOf('</action>', unclosed) === -1) {
          stripped = stripped.slice(0, unclosed);
        }
        stripped = stripped.replace(/<think>[\s\S]*$/i, '');
        display = stripped.replace(/<\/?(?:think|answer|note|action[^>]*)>/gi, '').trim();
      }

      // 流式状态指示器
      const phase = msg.streamingPhase;
      const elapsed = msg.phaseElapsed;
      const steps = msg.toolSteps;
      const lastRunningTool = steps?.findLast(s => s.status === 'running')?.tool;

      let phaseLabel = '';
      if (phase === 'llm-waiting') phaseLabel = `等待模型响应${elapsed ? ` ${elapsed}s` : ''}...`;
      else if (phase === 'tool-exec' && lastRunningTool) phaseLabel = `正在调用 ${lastRunningTool}...`;
      else if (!display && !steps?.length) phaseLabel = '等待模型响应...';

      return (
        <>
          {/* 工具步骤独立渲染 */}
          {steps && steps.map((step, i) => (
            <ToolCallMessage
              key={`tool-${msg.id}-${i}`}
              toolCall={{ toolName: step.tool, params: step.args as Record<string, unknown>, result: step.result, status: step.status === 'done' ? 'success' : step.status === 'error' ? 'error' : 'pending' }}
            />
          ))}
          {/* 流式文本气泡 */}
          <div className="chat__message chat__message--assistant">
            <div className="chat__avatar">AI</div>
            <div className="chat__bubble">
              {phaseLabel && <div className="chat__streaming-phase">{phaseLabel}</div>}
              {display && <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{display}▍</div>}
              {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
            </div>
          </div>
        </>
      );
    }

    const parsed = parseStructuredOutput(msg.content, []);
    const hasStructure = parsed.think || parsed.actions.length > 0 || parsed.note || parsed.answer;
    // 优先使用 msg.toolSteps（原生模式下 rawContent 不含 <action>，toolSteps 是源数据）
    const toolSteps = msg.toolSteps && msg.toolSteps.length > 0
      ? msg.toolSteps
      : parsed.actions.map(a => ({
          tool: a.tool, args: a.args,
          result: undefined as string | undefined,
          status: 'done' as const,
        }));
    if (hasStructure || (msg.toolSteps && msg.toolSteps.length > 0)) {
      return (
        <>
          {/* 工具步骤独立渲染 */}
          {toolSteps.map((step, i) => (
            <ToolCallMessage
              key={`tool-${msg.id}-${i}`}
              toolCall={{ toolName: step.tool, params: step.args as Record<string, unknown>, result: step.result, status: step.status === 'done' ? 'success' : step.status === 'error' ? 'error' : 'pending' }}
            />
          ))}
          <StructuredMessage
            think={parsed.think}
            tools={[]} answer={parsed.answer || msg.content.replace(/<[^>]+>/g, '').trim()} note={parsed.note}
            msgId={msg.id}
            timestamp={msg.timestamp}
            answerSource={parsed.answerSource}
            actions={
              <>
                <button className="chat__msg-action-btn" title="编辑" onClick={() => onStartEdit(msg)}>✏</button>
                <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
              </>
            }
          />
        </>
      );
    }
    return (
      <div className={`chat__message chat__message--assistant`}>
        <div className="chat__avatar">AI</div>
        <div className="chat__bubble">
          <div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div>
          {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
          <div className="chat__bubble-actions">
            <button className="chat__msg-action-btn" title="编辑" onClick={() => onStartEdit(msg)}>✏</button>
            <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
          </div>
        </div>
      </div>
    );
  }

  // user / system 文本气泡
  return (
    <div className={`chat__message chat__message--${msg.role}`}>
      <div className="chat__avatar">{msg.role === 'user' ? '你' : msg.role === 'assistant' ? 'AI' : 'S'}</div>
      <div className="chat__bubble">
        <div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div>
        {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
        <div className="chat__bubble-actions">
          <button className="chat__msg-action-btn" title="编辑" onClick={() => onStartEdit(msg)}>✏</button>
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 自定义比较器：只在影响该条渲染的数据变化时重渲。
 * 回调身份故意不比较（见文件头说明）。
 */
function areEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (prev.msg !== next.msg) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (next.isEditing && prev.editContent !== next.editContent) return false;
  return true;
}

const MessageItem = memo(MessageItemInner, areEqual);
export default MessageItem;
