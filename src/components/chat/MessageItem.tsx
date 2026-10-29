/** 历史消息按引用跳过流式重渲；切会话时消息引用会更新。 */

import { memo, type ReactNode } from 'react';
import BoundedText from '../../engine/text-display/BoundedText';
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
import { CompactionHistory } from '../common/CompactionHistory';
import type { ToolMediaScope } from '../../engine/tool-media';
import MonsoonActivitySequence from './MonsoonActivitySequence';

/** 流式与落定后的工具步骤共用渲染，保持原有顺序。 */
function renderToolStep(step: ToolStep, key: string, timestamp: string, stopped?: boolean, mediaScope?: ToolMediaScope) {
  const d = step.delegate;
  if (d) {
    return (
      <DelegateCard
        mediaScope={mediaScope}
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
    return <AutomationDraftCard key={`automation-${key}`} pending={step.pendingAutomation} timestamp={formatTimestamp(timestamp)}
      toolRecord={{ params: step.args, result: step.result }} />;
  }
  if (step.tool === 'start_workflow' && step.workflowExecution) {
    return <WorkflowExecutionCard key={`workflow-${key}`} execution={step.workflowExecution} timestamp={formatTimestamp(timestamp)}
      toolRecord={{ params: step.args, result: step.result }} />;
  }
  return (
    <ToolCallMessage
      mediaScope={mediaScope}
      interrupted={stopped && (step.status === 'running' || step.status === 'pending')}
      key={`tool-${key}`}
      toolCall={{
        toolName: step.tool,
        params: step.args as Record<string, unknown>,
        result: step.result,
        toolImages: step.toolImages,
        status: step.status === 'done' ? 'success' : step.status === 'error' ? 'error' : 'pending',
        diff: step.diff,
        pendingAutomation: step.pendingAutomation,
      }}
    />
  );
}

function renderToolSteps(steps: ToolStep[], messageId: string, timestamp: string, stopped?: boolean, mediaScope?: ToolMediaScope) {
  return <ToolActivityList items={steps} stopped={stopped} renderItem={(step, i) => renderToolStep(step, `${messageId}-${i}`, timestamp, stopped, mediaScope)} />;
}

export interface MessageItemProps {
  userNotice?: ReactNode;
  compactionMarkers?: ChatMessage[];
  inlineCompaction?: boolean;
  msg: ChatMessage;
  agent: Agent | null;
  sessionId: string;
  /** 是否为正在流式输出的最后一条（= streaming && msg === messages[last]） */
  isStreaming: boolean;
  compacting?: boolean;
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
  msg, agent, sessionId, isStreaming, compacting, isEditing, editContent, setEditContent,
  onSaveEdit, onCancelEdit, onStartEdit, onDeleteMessage, onAskReply,
  askStatus, askStatusDetail, onAskCheck, userNotice, compactionMarkers, inlineCompaction,
}: MessageItemProps) {
  const { locale, t } = useLocale();
  const mediaScope: ToolMediaScope | undefined = agent?.id
    ? { feature: 'monsoon', agentId: agent.id, sessionId } : undefined;
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

  if (msg.type === 'compact-marker') {
    if (inlineCompaction) return null;
    return (
      <>
        <CompactionNotice message={msg.compactionNotice ?? ''} />
        <CompactionHistory content={msg.content} handoff />
      </>
    );
  }

  if (msg.toolCall) {
    // 潮汐任务信息卡（create/update 成功时带 pendingAutomation；失败则退回普通工具卡）
    if ((msg.toolCall.toolName === 'create_automation' || msg.toolCall.toolName === 'update_automation') && msg.toolCall.pendingAutomation) {
      return <AutomationDraftCard pending={msg.toolCall.pendingAutomation} timestamp={formatTimestamp(msg.timestamp)} toolRecord={msg.toolCall} />;
    }
    if (msg.toolCall.toolName === 'start_workflow' && msg.toolCall.workflowExecution) {
      return <WorkflowExecutionCard execution={msg.toolCall.workflowExecution} timestamp={formatTimestamp(msg.timestamp)} toolRecord={msg.toolCall} />;
    }
    return msg.toolCall.toolName === 'delegate' ? (
      <DelegateCard
        mediaScope={mediaScope}
        toolCall={msg.toolCall}
        content={msg.content}
        timestamp={msg.timestamp}
        actions={
          <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={() => onDeleteMessage(msg.id)}>🗑</button>
        }
      />
    ) : (
      <ToolCallMessage
        mediaScope={mediaScope}
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
    if (msg.activitySequence?.length) {
      const lastTool = msg.toolSteps?.findLast(step => step.status === 'running')?.tool;
      return <>
        <CompactionNotice message={msg.compactionNotice ?? ''} />
        <MonsoonActivitySequence message={msg} agent={agent} streaming={isStreaming} compactionMarkers={compactionMarkers}
          renderReasoning={(start, end, active) => msg.reasoningContent && end > start && <ReasoningBlock
            reasoning={msg.reasoningContent.slice(start, end)}
            breaks={msg.reasoningBreaks?.filter(offset => offset > start && offset < end).map(offset => offset - start)}
            isStreaming={active} preview />}
          phase={isStreaming && !compacting && <LivePhase phase={msg.streamingPhase ?? 'llm-waiting'}
            elapsed={msg.phaseElapsed} tool={msg.streamingTool || lastTool}
            argumentChars={msg.streamingArgumentChars} notice={msg.streamingStatus} />}
          renderTools={(steps, offset) => <ToolActivityList items={steps} stopped={msg.streamStopped}
            renderItem={(step, index) => renderToolStep(step, `${msg.id}-${offset + index}`, msg.timestamp, msg.streamStopped, mediaScope)} />}
          actions={!isStreaming ? <>
            <button className="chat__msg-action-btn" title={t('common.edit')} aria-label={t('chat.editMessage')} onClick={() => onStartEdit(msg)}>✏</button>
            <button className="chat__msg-action-btn chat__msg-action-btn--danger" title={t('common.delete')} aria-label={t('chat.deleteMessage')} onClick={() => onDeleteMessage(msg.id)}>🗑</button>
          </> : undefined} />
      </>;
    }
    // 流式正文直接展示；工具与思考由各自的结构化事件渲染。
    if (isStreaming) {
      const display = msg.content.trim();

      // 流式状态指示器
      const phase = msg.streamingPhase;
      const elapsed = msg.phaseElapsed;
      const steps = msg.toolSteps;
      const lastRunningTool = steps?.findLast(s => s.status === 'running')?.tool;
      if (compacting && !display && !steps?.length && !msg.reasoningContent) return null;

      let phaseLabel = msg.streamingStatus || '';
      if (!phaseLabel && phase) phaseLabel = formatStreamStatus(phase, elapsed, msg.streamingTool || lastRunningTool, msg.streamingArgumentChars, locale);
      else if (!phaseLabel && !display && !steps?.length) phaseLabel = formatStreamStatus('llm-waiting', 0, undefined, undefined, locale);

      return (
        <>
          <CompactionNotice message={msg.compactionNotice ?? ''} />
          {/* 原生思考流：默认限高预览，折叠与高度分别控制。 */}
          {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} breaks={msg.reasoningBreaks} isStreaming preview />}
          <TurnProcess kind="tools" present={!!steps?.length}>
          {/* 工具步骤独立渲染（delegate 步用 DelegateCard，按调用顺序 inline） */}
          {steps && renderToolSteps(steps, msg.id, msg.timestamp, undefined, mediaScope)}
          </TurnProcess>
          {/* 流式文本气泡 */}
          <div className="chat__message chat__message--assistant">
            <AgentAvatar agent={agent} className="chat__avatar" fallback="AI" />
            <div className="chat__bubble">
              {!compacting && phaseLabel && <LivePhase phase={phase ?? 'llm-waiting'} elapsed={elapsed}
                tool={msg.streamingTool || lastRunningTool} argumentChars={msg.streamingArgumentChars} notice={msg.streamingStatus} />}
              {display && <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}><BoundedText text={display} id={msg.id} followTail />{!compacting && '▍'}</div>}
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
          {/* 兼容历史记录的思考预览。 */}
          {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} breaks={msg.reasoningBreaks} isStreaming={false} preview />}
          <TurnProcess kind="tools" present={!!toolSteps.length} stopped={msg.streamStopped}>
          {/* 工具步骤独立渲染（delegate 步用 DelegateCard，按调用顺序 inline） */}
          {renderToolSteps(toolSteps, msg.id, msg.timestamp, msg.streamStopped, mediaScope)}
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
        {/* 兼容仅有思考内容的历史记录。 */}
        {msg.reasoningContent && <ReasoningBlock reasoning={msg.reasoningContent} breaks={msg.reasoningBreaks} isStreaming={false} preview />}
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
        {msg.role === 'user' && userNotice}
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
  if (prev.compacting !== next.compacting) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.userNotice !== next.userNotice) return false;
  if (prev.askStatus !== next.askStatus || prev.askStatusDetail !== next.askStatusDetail) return false;
  if (prev.agent?.id !== next.agent?.id || prev.agent?.name !== next.agent?.name) return false;
  if (prev.agent?.avatar?.version !== next.agent?.avatar?.version) return false;
  if (next.isEditing && prev.editContent !== next.editContent) return false;
  return true;
}

const MessageItem = memo(MessageItemInner, areEqual);
export default MessageItem;
