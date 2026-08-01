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
import ReasoningBlock from './ReasoningBlock';
import ToolCallMessage from './ToolCallMessage';
import DelegateCard from './DelegateCard';
import AskCard from './AskCard';
import AutomationDraftCard from './AutomationDraftCard';
import WorkflowExecutionCard from './WorkflowExecutionCard';
import { renderTextWithCode } from '../../engine/markdown';
import { formatTimestamp } from '../../utils/time';
import type { ChatMessage, ToolStep } from '../../types';
import { formatStreamStatus } from './stream-status';
import ToolActivityList from './ToolActivityGroup';
import { MessageImages } from './MessageImages';

/**
 * 渲染单个工具步骤：delegate 步 → DelegateCard（含子步骤/思考流/汇总），
 * 其余 → ToolCallMessage。两处渲染路径（流式中 / 落定后）共用，保证 sub-agent
 * 卡片按调用顺序 inline 落在工具列里，而非浮在整条消息之上。
 */
function renderToolStep(step: ToolStep, key: string, timestamp: string) {
  const d = step.delegate;
  if (d) {
    return (
      <DelegateCard
        key={`del-${key}`}
        toolCall={{
          toolName: 'delegate', params: { task: d.task },
          status: d.status, result: d.summary, steps: d.steps,
        } as NonNullable<ChatMessage['toolCall']> & { steps?: typeof d.steps }}
        content={d.content}
      />
    );
  }
  if ((step.tool === 'create_automation' || step.tool === 'update_automation') && step.pendingAutomation) {
    return <AutomationDraftCard key={`automation-${key}`} pending={step.pendingAutomation} timestamp={formatTimestamp(timestamp)} />;
  }
  if (step.tool === 'start_workflow' && step.workflowExecution) {
    return <WorkflowExecutionCard key={`workflow-${key}`} execution={step.workflowExecution} timestamp={formatTimestamp(timestamp)} />;
  }
  return (
    <ToolCallMessage
      key={`tool-${key}`}
      toolCall={{
        toolName: step.tool,
        params: step.args as Record<string, unknown>,
        result: step.result,
        status: step.status === 'done' ? 'success' : step.status === 'error' ? 'error' : 'pending',
        diff: step.diff,
        pendingAutomation: step.pendingAutomation,
      }}
    />
  );
}

function renderToolSteps(steps: ToolStep[], messageId: string, timestamp: string) {
  return <ToolActivityList items={steps} renderItem={(step, i) => renderToolStep(step, `${messageId}-${i}`, timestamp)} />;
}

export interface MessageItemProps {
  msg: ChatMessage;
  sessionId: string;
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
  msg, sessionId, isStreaming, isEditing, editContent, setEditContent,
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
    // 潮汐任务信息卡（create/update 成功时带 pendingAutomation；失败则退回普通工具卡）
    if ((msg.toolCall.toolName === 'create_automation' || msg.toolCall.toolName === 'update_automation') && msg.toolCall.pendingAutomation) {
      return <AutomationDraftCard pending={msg.toolCall.pendingAutomation} timestamp={formatTimestamp(msg.timestamp)} />;
    }
    if (msg.toolCall.toolName === 'start_workflow' && msg.toolCall.workflowExecution) {
      return <WorkflowExecutionCard execution={msg.toolCall.workflowExecution} timestamp={formatTimestamp(msg.timestamp)} />;
    }
    return msg.toolCall.toolName === 'delegate' ? (
      <DelegateCard
        toolCall={msg.toolCall}
        content={msg.content}
        timestamp={msg.timestamp}
        actions={
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" aria-label="删除消息" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
        }
      />
    ) : (
      <ToolCallMessage
        toolCall={msg.toolCall}
        timestamp={msg.timestamp}
        actions={
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" aria-label="删除消息" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
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
    // 流式正文直接展示；工具与思考由各自的结构化事件渲染。
    if (isStreaming) {
      const display = msg.content.trim();

      // 流式状态指示器
      const phase = msg.streamingPhase;
      const elapsed = msg.phaseElapsed;
      const steps = msg.toolSteps;
      const lastRunningTool = steps?.findLast(s => s.status === 'running')?.tool;

      let phaseLabel = msg.streamingStatus || '';
      if (!phaseLabel && phase) phaseLabel = formatStreamStatus(phase, elapsed, msg.streamingTool || lastRunningTool, msg.streamingArgumentChars);
      else if (!phaseLabel && !display && !steps?.length) phaseLabel = formatStreamStatus('llm-waiting');

      return (
        <>
          {/* 原生思考流（流式中默认展开） */}
          {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} isStreaming />}
          {/* 工具步骤独立渲染（delegate 步用 DelegateCard，按调用顺序 inline） */}
          {steps && renderToolSteps(steps, msg.id, msg.timestamp)}
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

    const answer = msg.content.trim();
    // 工具步骤只来自结构化事件。
    const toolSteps = msg.toolSteps ?? [];
    if (answer || toolSteps.length > 0) {
      return (
        <>
          {/* 原生思考流（落定后默认折叠） */}
          {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} isStreaming={false} />}
          {/* 工具步骤独立渲染（delegate 步用 DelegateCard，按调用顺序 inline） */}
          {renderToolSteps(toolSteps, msg.id, msg.timestamp)}
          <StructuredMessage
            tools={[]} answer={answer}
            msgId={msg.id}
            timestamp={msg.timestamp}
            actions={
              <>
                <button className="chat__msg-action-btn" title="编辑" aria-label="编辑消息" onClick={() => onStartEdit(msg)}>✏</button>
                <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" aria-label="删除消息" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
              </>
            }
          />
        </>
      );
    }
    return (
      <>
        {/* 原生思考流（落定后默认折叠） */}
        {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} isStreaming={false} />}
        <div className={`chat__message chat__message--assistant`}>
          <div className="chat__avatar">AI</div>
          <div className="chat__bubble">
            <div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div>
            {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
            <div className="chat__bubble-actions">
              <button className="chat__msg-action-btn" title="编辑" aria-label="编辑消息" onClick={() => onStartEdit(msg)}>✏</button>
              <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" aria-label="删除消息" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // user / system 文本气泡
  return (
    <div className={`chat__message chat__message--${msg.role}`}>
      <div className="chat__avatar">{msg.role === 'user' ? '你' : 'S'}</div>
      <div className="chat__bubble">
        {msg.role === 'user' && msg.images?.length && msg.agentId && (
          <MessageImages images={msg.images} agentId={msg.agentId} sessionId={sessionId} />
        )}
        {msg.content && <div className="md-bubble">{renderTextWithCode(msg.content, msg.id)}</div>}
        {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
        <div className="chat__bubble-actions">
          <button className="chat__msg-action-btn" title="编辑" aria-label="编辑消息" onClick={() => onStartEdit(msg)}>✏</button>
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title="删除" aria-label="删除消息" onClick={() => onDeleteMessage(msg.id)}>🗑</button>
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
