import { memo, type KeyboardEvent, type RefObject } from 'react';
import BoundedText from '../../../engine/text-display/BoundedText';
import { createPortal } from 'react-dom';
import type { ChatMessage } from '../../../types';
import ToolCallMessage from './ToolCallMessage';
import TwToolActivityGroup from './TwToolActivityGroup';
import TwReasoningBlock from './TwReasoningBlock';
import DelegateCard from './DelegateCard';
import ContactCard from './ContactCard';
import { useLocale } from '../../../i18n/LocaleContext';
import type { MessageKey } from '../../../i18n/locale';
import type { ProviderUsage } from '../token-usage';
import { CompactionNotice } from '../../../components/common/CompactionNotice';
import { CompactionStatus } from '../../../components/common/CompactionStatus';
import type { CompactionActivity } from '../../../components/common/compaction-activity';
import { CompactedHistory } from '../CompactedHistory';
import { isCompactedHistory } from '../compaction-events';
import type { ToolMediaScope } from '../../../engine/tool-media';

export type AgentChatActivity = 'idle' | 'waiting' | 'reasoning' | 'responding'
  | 'tool' | 'delegate' | 'contact' | 'failed';

interface Props {
  mediaScope?: ToolMediaScope;
  visible: boolean;
  sealed: boolean;
  paused: boolean;
  streaming: boolean;
  isEnvelopeRound: boolean;
  activity: AgentChatActivity;
  nodeLabel: string;
  latestUsage?: ProviderUsage | null;
  compactionNotice?: string | null;
  compaction?: CompactionActivity;
  messages: ChatMessage[];
  error: string | null;
  input: string;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onInput: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  onPauseRound: () => void;
  onResumeRound: () => void;
  onStopWorkflow: () => void;
}

const activityLabelKeys: Record<AgentChatActivity, MessageKey> = {
  idle: 'tradewind.chat.activity.idle', waiting: 'tradewind.chat.activity.waiting',
  reasoning: 'tradewind.chat.activity.reasoning', responding: 'tradewind.chat.activity.responding',
  tool: 'tradewind.chat.activity.tool', delegate: 'tradewind.chat.activity.delegate',
  contact: 'tradewind.chat.activity.contact', failed: 'tradewind.chat.activity.failed',
};
const activityBadgeKeys: Record<AgentChatActivity, MessageKey> = {
  idle: 'tradewind.chat.badge.idle', waiting: 'tradewind.chat.badge.waiting',
  reasoning: 'tradewind.chat.badge.reasoning', responding: 'tradewind.chat.badge.responding',
  tool: 'tradewind.chat.badge.tool', delegate: 'tradewind.chat.badge.delegate',
  contact: 'tradewind.chat.badge.contact', failed: 'tradewind.chat.badge.failed',
};

export default function AgentChatView(props: Props) {
  const { t } = useLocale();
  const { visible, sealed, paused, streaming, isEnvelopeRound, activity, nodeLabel,
    latestUsage, compactionNotice, compaction, messages, error, input, messagesContainerRef, messagesEndRef, onClose, onInput,
    onKeyDown, onSend, onStop, onPauseRound, onResumeRound, onStopWorkflow } = props;
  const statusText = sealed ? t('tradewind.chat.sealedStatus')
    : paused ? t('tradewind.chat.pausedStatus') : t(activityLabelKeys[activity]);
  if (!visible) return null;
  return createPortal(
    <div className="tw-chat-overlay">
      <div className="tw-chat-window">
        <div className="tw-chat-window__header">
          <div className="tw-chat-window__identity">
            <span className="tw-chat-window__eyebrow">AGENT NODE</span>
            <span className="tw-chat-window__title">{nodeLabel}</span>
            {latestUsage !== undefined && <small className="tw-chat-window__eyebrow"
              title={t('tradewind.chat.recentInputTooltip')}>{latestUsage
              ? t('tradewind.chat.recentInputTokens', { count: latestUsage.promptTokens.toLocaleString() })
              : t('tradewind.chat.recentInputUnknown')}</small>}
          </div>
          <span className={`tw-chat-window__state tw-chat-window__state--${activity}${streaming ? ' tw-chat-window__state--active' : ''}`}>
            {sealed ? t('tradewind.chat.sealedBadge') : paused ? t('tradewind.chat.pausedBadge') : t(activityBadgeKeys[activity])}
          </span>
          <button className="tw-chat-window__close" onClick={onClose} aria-label={t('tradewind.chat.close')}>×</button>
        </div>
        <div className="tw-chat-window__messages" ref={messagesContainerRef}>
          {messages.map((msg) => <AgentChatMessage key={msg.id} message={msg}
            mediaScope={props.mediaScope}
            isStreaming={streaming && msg === messages[messages.length - 1]} />)}
          {error && <div className="tw-chat-msg tw-chat-msg--error">{error}</div>}
          {compactionNotice && <CompactionNotice message={compactionNotice} />}
          <div ref={messagesEndRef} />
        </div>
        <CompactionStatus activity={compaction} />
        <div className={`tw-chat-status tw-chat-status--${activity}${streaming ? ' tw-chat-status--active' : ''}${paused ? ' tw-chat-status--paused' : ''}`}>
          <span className="tw-chat-status__pulse" /><span>{statusText}</span>
        </div>
        <div className="tw-chat-window__input-area">
          {sealed ? <div className="tw-chat-window__sealed">{t('tradewind.chat.sealedMessage')}</div> : (
            <div className="tw-chat-window__composer">
              <textarea className="tw-chat-window__input" value={input} onChange={event => {
                onInput(event.target.value);
                event.target.style.height = 'auto';
                event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
              }} onKeyDown={onKeyDown} placeholder={t('tradewind.chat.placeholder')} disabled={streaming || paused || compaction?.phase === 'running'} rows={1} />
              <AgentChatControls paused={paused} streaming={streaming} isEnvelopeRound={isEnvelopeRound}
                input={input} compaction={compaction} onSend={onSend} onStop={onStop} onPauseRound={onPauseRound}
                onResumeRound={onResumeRound} onStopWorkflow={onStopWorkflow} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const AgentChatMessage = memo(function AgentChatMessage({ message, isStreaming, mediaScope }: { message: ChatMessage; isStreaming: boolean; mediaScope?: ToolMediaScope }) {
  const { t } = useLocale();
  if (message.toolCall?.toolName === 'delegate') return <DelegateCard toolCall={message.toolCall as any} content={message.content} mediaScope={mediaScope} />;
  if (message.toolCall?.toolName === 'contact') return <ContactCard toolCall={message.toolCall} />;
  if (message.toolCall) return <ToolCallMessage toolCall={message.toolCall} mediaScope={mediaScope} />;
  if (message.role === 'system' && isCompactedHistory(message.content)) return <CompactedHistory content={message.content} />;
  if (message.role === 'system') return <div className="tw-chat-msg tw-chat-msg--system"><BoundedText text={message.content} /></div>;
  if (message.role === 'user') return <div className="tw-chat-row tw-chat-row--user">
    <div className="tw-chat-avatar tw-chat-avatar--user">{t('tradewind.chat.you')}</div><div className="tw-chat-bubble"><BoundedText text={message.content} /></div>
  </div>;
  const toolSteps = message.toolSteps || [];
  if (toolSteps.length) return <div className="tw-chat-row tw-chat-row--assistant">
    <div className="tw-chat-avatar tw-chat-avatar--assistant">AI</div><div className="tw-chat-bubble">
      {message.reasoningContent && <TwReasoningBlock content={message.reasoningContent} streaming={isStreaming} />}
      <TwToolActivityGroup items={toolSteps} renderItem={(step, index) => <ToolCallMessage key={index} toolCall={{
        toolName: step.tool, params: step.args, result: step.result, toolImages: step.toolImages,
        status: step.status === 'running' ? 'pending' : step.status === 'done' ? 'success' : step.status === 'error' ? 'error' : 'pending', diff: step.diff,
      }} mediaScope={mediaScope} />}/>
      {message.content && <div className="tw-chat-content"><BoundedText text={message.content} followTail={isStreaming} /></div>}
    </div>
  </div>;
  return <div className="tw-chat-row tw-chat-row--assistant">
    <div className="tw-chat-avatar tw-chat-avatar--assistant">AI</div><div className="tw-chat-bubble">
      {message.reasoningContent && <TwReasoningBlock content={message.reasoningContent} streaming={isStreaming} />}
      {isStreaming && !message.content.trim() ? <><span className="tw-chat-streaming-dot" />{t('tradewind.chat.waitingModel')}</>
        : <><BoundedText text={message.content} followTail={isStreaming} />{isStreaming && <span className="tw-chat-cursor" />}</>}
    </div>
  </div>;
});

function AgentChatControls({ paused, streaming, isEnvelopeRound, input, compaction, onSend, onStop,
  onPauseRound, onResumeRound, onStopWorkflow }: Pick<Props, 'paused' | 'streaming' | 'isEnvelopeRound' |
    'input' | 'compaction' | 'onSend' | 'onStop' | 'onPauseRound' | 'onResumeRound' | 'onStopWorkflow'>) {
  const { t } = useLocale();
  if (paused) return <>
    <button className="tw-chat-window__resume" onClick={onResumeRound}>{t('tradewind.chat.resume')}</button>
    <button className="tw-chat-window__stop tw-chat-window__stop--wide" onClick={onStopWorkflow}>{t('tradewind.chat.stopWorkflow')}</button>
  </>;
  if (streaming && isEnvelopeRound) return <>
    <button className="tw-chat-window__pause" onClick={onPauseRound}>{t('tradewind.chat.pause')}</button>
    <button className="tw-chat-window__stop tw-chat-window__stop--wide" onClick={onStopWorkflow}>{t('tradewind.chat.stopWorkflow')}</button>
  </>;
  if (streaming) return <button className="tw-chat-window__stop" onClick={onStop} aria-label={t('tradewind.chat.stopGeneration')}>■</button>;
  return <button className="tw-chat-window__send" onClick={onSend} disabled={!input.trim() || compaction?.phase === 'running'} aria-label={t('tradewind.chat.sendMessage')}>➤</button>;
}
