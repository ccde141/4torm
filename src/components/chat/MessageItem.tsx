/** 历史消息按引用跳过流式重渲；切会话时消息引用会更新。 */

import { memo } from 'react';
import StructuredMessage from './StructuredMessage';
import ReasoningBlock from './ReasoningBlock';
import TurnProcess from './TurnProcess';
import LivePhase from './LivePhase';
import ToolCallMessage from './ToolCallMessage';
import DelegateCard from './DelegateCard';
import AskCard from './AskCard';
import AutomationDraftCard from './AutomationDraftCard';
import WorkflowExecutionCard from './WorkflowExecutionCard';
import BoundedMessageText from './BoundedMessageText';
import { formatTimestamp } from '../../utils/time';
import type { ChatMessage, ToolStep } from '../../types';
import { formatStreamStatus } from './stream-status';
import ToolActivityList from './ToolActivityGroup';
import { MessageImages } from './MessageImages';
import AgentAvatar from '../agents/AgentAvatar';
import type { Agent } from '../../types';
import { useLocale } from '../../i18n/LocaleContext';
import type { AskStatus } from '../../engine/chat/ask-status';
import { CompactionNotice } from '../common/CompactionNotice';

/** 流式与落定后的工具步骤共用渲染，保持原有顺序。 */
function renderToolStep(step: ToolStep, key: string, timestamp: string, stopped?: boolean) {
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
      interrupted={stopped && (step.status === 'running' || step.status === 'pending')}
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

function renderToolSteps(steps: ToolStep[], messageId: string, timestamp: string, stopped?: boolean) {
  return <ToolActivityList items={steps} stopped={stopped} renderItem={(step, i) => renderToolStep(step, `${messageId}-${i}`, timestamp, stopped)} />;
}

export interface MessageItemProps {
  msg: ChatMessage;
  agent: Agent | null;
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
  askStatus?: AskStatus;
  askStatusDetail?: string;
  onAskCheck?: () => void;
}

function MessageItemInner({
  msg, agent, sessionId, isStreaming, isEditing, editContent, setEditContent,
  onSaveEdit, onCancelEdit, onStartEdit, onDeleteMessage, onAskReply,
  askStatus, askStatusDetail, onAskCheck,
}: MessageItemProps) {
  const { locale, t } = useLocale();
  if (isEditing) {
    return (
      <div className={`chat__message chat__message--${msg.role}`}>
        {msg.role === 'assistant'
          ? <AgentAvatar agent={agent} className="chat__avatar" fallback="AI" />
          : <div className="chat__avatar">{msg.role === 'user' ? t('chat.you') : 'S'}</div>}
        <div className="chat__bubble chat__bubble--editing">
          <textarea className="chat__edit-textarea" value={editContent} onChange={e => setEditContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') onCancelEdit(); if (e.key === 'Enter' && e.ctrlKey) onSaveEdit(); }}
            rows={3} autoFocus />
          <div className="chat__edit-actions">
            <button onClick={onSaveEdit}>{t('common.save')}</button>
            <button onClick={onCancelEdit}>{t('common.cancel')}</button>
          </div>
          {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
        </div>
      </div>
    );
  }

  if ((msg as any).type === 'compact-marker') {
    return (
      <div className="chat__compact-marker">
        <CompactionNotice message={msg.compactionNotice ?? ''} />
        <span className="chat__compact-marker-line" />
        <button
          className="chat__compact-marker-toggle"
          onClick={() => {
            const el = document.getElementById(`compact-detail-${msg.id}`);
            if (el) el.classList.toggle('chat__compact-detail--open');
          }}
        >
          {t('chat.compacted')}
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
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={() => onDeleteMessage(msg.id)}>🗑</button>
        }
      />
    ) : (
      <ToolCallMessage
        toolCall={msg.toolCall}
        timestamp={msg.timestamp}
        actions={
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={() => onDeleteMessage(msg.id)}>🗑</button>
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
        status={askStatus}
        statusDetail={askStatusDetail}
        onCheck={onAskCheck}
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
      if (!phaseLabel && phase) phaseLabel = formatStreamStatus(phase, elapsed, msg.streamingTool || lastRunningTool, msg.streamingArgumentChars, locale);
      else if (!phaseLabel && !display && !steps?.length) phaseLabel = formatStreamStatus('llm-waiting', 0, undefined, undefined, locale);

      return (
        <>
          <CompactionNotice message={msg.compactionNotice ?? ''} />
          {/* 原生思考流（流式中默认展开） */}
          <TurnProcess kind="reasoning" present={!!msg.reasoningContent} followLatest>
          {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} breaks={msg.reasoningBreaks} isStreaming />}
          </TurnProcess>
          <TurnProcess kind="tools" present={!!steps?.length}>
          {/* 工具步骤独立渲染（delegate 步用 DelegateCard，按调用顺序 inline） */}
          {steps && renderToolSteps(steps, msg.id, msg.timestamp)}
          </TurnProcess>
          {/* 流式文本气泡 */}
          <div className="chat__message chat__message--assistant">
            <AgentAvatar agent={agent} className="chat__avatar" fallback="AI" />
            <div className="chat__bubble">
              {phaseLabel && <LivePhase phase={phase ?? 'llm-waiting'} elapsed={elapsed}
                tool={msg.streamingTool || lastRunningTool} argumentChars={msg.streamingArgumentChars} notice={msg.streamingStatus} />}
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
          <CompactionNotice message={msg.compactionNotice ?? ''} />
          {/* 原生思考流（落定后默认折叠） */}
          <TurnProcess kind="reasoning" present={!!msg.reasoningContent}>
          {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} breaks={msg.reasoningBreaks} isStreaming={false} />}
          </TurnProcess>
          <TurnProcess kind="tools" present={!!toolSteps.length} stopped={msg.streamStopped}>
          {/* 工具步骤独立渲染（delegate 步用 DelegateCard，按调用顺序 inline） */}
          {renderToolSteps(toolSteps, msg.id, msg.timestamp, msg.streamStopped)}
          </TurnProcess>
          <StructuredMessage
            tools={[]} agent={agent} answer={answer} bounded
            msgId={msg.id}
            timestamp={msg.timestamp}
            actions={
              <>
                <button className="chat__msg-action-btn" title={t('common.edit')} aria-label={t('chat.editMessage')} onClick={() => onStartEdit(msg)}>✏</button>
                <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={() => onDeleteMessage(msg.id)}>🗑</button>
              </>
            }
          />
        </>
      );
    }
    return (
      <>
        <CompactionNotice message={msg.compactionNotice ?? ''} />
        {/* 原生思考流（落定后默认折叠） */}
        <TurnProcess kind="reasoning" present={!!msg.reasoningContent} stopped={msg.streamStopped}>
        {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} breaks={msg.reasoningBreaks} isStreaming={false} />}
        </TurnProcess>
        <div className={`chat__message chat__message--assistant`}>
          <AgentAvatar agent={agent} className="chat__avatar" fallback="AI" />
          <div className="chat__bubble">
            <div className="md-bubble"><BoundedMessageText text={msg.content} id={msg.id} /></div>
            {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
            <div className="chat__bubble-actions">
              <button className="chat__msg-action-btn" title={t('common.edit')} aria-label={t('chat.editMessage')} onClick={() => onStartEdit(msg)}>✏</button>
              <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={() => onDeleteMessage(msg.id)}>🗑</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // user / system 文本气泡
  return (
    <div className={`chat__message chat__message--${msg.role}`}>
      <div className="chat__avatar">{msg.role === 'user' ? t('chat.you') : 'S'}</div>
      <div className="chat__bubble">
        <CompactionNotice message={msg.compactionNotice ?? ''} />
        {msg.role === 'user' && msg.images?.length && msg.agentId && (
          <MessageImages images={msg.images} agentId={msg.agentId} sessionId={sessionId} />
        )}
        {msg.content && <div className="md-bubble"><BoundedMessageText text={msg.content} id={msg.id} /></div>}
        {msg.timestamp && <div className="chat__timestamp" title={formatTimestamp(msg.timestamp, true)}>{formatTimestamp(msg.timestamp)}</div>}
        <div className="chat__bubble-actions">
          <button className="chat__msg-action-btn" title={t('common.edit')} aria-label={t('chat.editMessage')} onClick={() => onStartEdit(msg)}>✏</button>
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={() => onDeleteMessage(msg.id)}>🗑</button>
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
  if (prev.askStatus !== next.askStatus || prev.askStatusDetail !== next.askStatusDetail) return false;
  if (prev.agent?.id !== next.agent?.id || prev.agent?.name !== next.agent?.name) return false;
  if (prev.agent?.avatar?.version !== next.agent?.avatar?.version) return false;
  if (next.isEditing && prev.editContent !== next.editContent) return false;
  return true;
}

const MessageItem = memo(MessageItemInner, areEqual);
export default MessageItem;
