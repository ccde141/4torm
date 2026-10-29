import { backendFetch } from '../../lib/backend-client';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { Agent, ChatMessage } from '../../types';
import { IMAGE_ACCEPT } from '../../engine/chat/image-attachments';
import { useLocale } from '../../i18n/LocaleContext';
import MessageItem from './MessageItem';
import HumanInputList from './HumanInputList';
import PendingHumanInput, { HumanInputRecovery } from './PendingHumanInput';
import { pendingUserRecovery, unrepresentedHumanInputs, type HumanInputActivity } from './human-input-presentation';
import ExecutionStatusBar from './ExecutionStatusBar';
import { ImageDrafts } from './MessageImages';
import TaskBoardDrawer, { RAIL_W } from './TaskBoardDrawer';
import TeamView from './team/TeamView';
import type { useSessionList } from './useSessionList';
import type { useMessageEditor } from './useMessageEditor';
import type { useHumanInput } from './useHumanInput';
import type { useMonsoonScroll } from './useMonsoonScroll';
import type { useMonsoonTaskboard } from './useMonsoonTaskboard';
import type { useMonsoonImages } from './useMonsoonImages';
import type { AskReplyFeedback } from './useAskReplyFeedback';
import { decidePendingAskInputRoute, findLatestAnswerableAsk } from '../../engine/chat/pending-ask';
import { historyWindow } from './history-window';
import { executionCompactions } from '../../engine/chat/execution-segments';
import { CompactionStatus } from '../common/CompactionStatus';
import type { CompactionActivity } from '../common/compaction-activity';

const HISTORY_BATCH = 24;

interface MonsoonConversationProps {
  agent: Agent | null;
  messages: ChatMessage[];
  askFeedback: AskReplyFeedback | null;
  onAskCheck(): void;
  streaming: boolean;
  compacting: boolean;
  compaction?: CompactionActivity;
  input: string;
  setInput(value: string): void;
  models: { key: string; label: string }[];
  selectedModel: string;
  setSelectedModel(value: string): void;
  sessions: ReturnType<typeof useSessionList>;
  editor: ReturnType<typeof useMessageEditor>;
  human: ReturnType<typeof useHumanInput>;
  scroll: ReturnType<typeof useMonsoonScroll>;
  taskboard: ReturnType<typeof useMonsoonTaskboard>;
  images: ReturnType<typeof useMonsoonImages>;
  send(): void;
  stop(): void;
  answer(messageId: string, answer: string): void;
}

export function MonsoonConversation(props: MonsoonConversationProps) {
  const { t, locale } = useLocale();
  const sessionId = props.sessions.activeSessionId;
  const latestAsk = findLatestAnswerableAsk(props.messages);
  const [historyState, setHistoryState] = useState({ sessionId: '', limit: HISTORY_BATCH });
  const historyAnchor = useRef<{ sessionId: string; height: number; top: number } | null>(null);
  const limit = historyState.sessionId === sessionId ? historyState.limit : HISTORY_BATCH;
  const history = historyWindow(props.messages, props.streaming, limit);
  const compactions = executionCompactions(props.messages);
  const inputRun = props.streaming ? props.messages.findLast(message => message.role === 'assistant' && message.inputRunId) : undefined;
  const inputActivity: HumanInputActivity | undefined = inputRun?.inputRunId ? {
    runId: inputRun.inputRunId, phase: inputRun.streamingPhase, ready: inputRun.inputReady === true,
    closed: inputRun.inputClosed, compacting: props.compaction?.phase === 'running',
  } : undefined;
  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    const container = props.scroll.containerRef.current;
    if (anchor?.sessionId === sessionId && container) {
      container.scrollTop = anchor.top + container.scrollHeight - anchor.height;
    }
    historyAnchor.current = null;
  });
  if (!sessionId) return <div style={emptyStyle}>
    <EmptyIcon /><span style={{ fontSize: 'var(--text-sm)' }}>
      {props.agent ? t('chat.page.selectSession') : t('chat.page.chooseAgent')}
    </span>
  </div>;
  return <>
    <header style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {props.sessions.editingTitle
          ? <input ref={props.sessions.titleInputRef} className="chat__title-input"
            value={props.sessions.editTitleValue}
            onChange={event => props.sessions.setEditTitleValue(event.target.value)}
            onKeyDown={event => titleKey(event, props.sessions.renameSession,
              () => props.sessions.setEditingTitle(false))}
            onBlur={props.sessions.renameSession} />
          : <span className="chat__title" onDoubleClick={props.sessions.startRename}
            title={t('chat.page.rename')}>
            {props.sessions.sessions.find(session => session.id === sessionId)?.title}
          </span>}
        <span style={sessionIdStyle}>{sessionId}</span>
      </div>
      <div style={headerActionsStyle}>
        {props.agent && <TeamView key={`${props.agent.id}/${sessionId}`} agentId={props.agent.id}
          sessionId={sessionId} mainName={props.agent.name} mainBusy={props.streaming} />}
        <AgentWorkspaceButton agent={props.agent} />
        {!!props.models.length && <select value={props.selectedModel}
          onChange={event => props.setSelectedModel(event.target.value)} style={modelStyle}
          aria-label={t('chat.page.selectModel')}>
          {props.models.map(model => <option key={model.key} value={model.key}>{model.label}</option>)}
        </select>}
      </div>
    </header>
    <main style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
      marginRight: props.taskboard.open ? 0 : RAIL_W }}>
      <div className="chat__messages" ref={props.scroll.containerRef}
        style={{ paddingRight: props.taskboard.open ? 'calc(var(--space-6) + 30px)' : 'var(--space-6)' }}>
        {history.hiddenCount > 0 && <button type="button" className="chat__history-more"
          style={{ alignSelf: 'center', padding: 'var(--space-2) var(--space-4)',
            border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
            background: 'var(--glass-bg-strong)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
          onClick={() => {
            const container = props.scroll.containerRef.current;
            if (container) historyAnchor.current = {
              sessionId, height: container.scrollHeight, top: container.scrollTop };
            setHistoryState({ sessionId, limit: limit + HISTORY_BATCH });
          }}>{t('chat.page.loadOlder', { count: Math.min(history.hiddenCount, HISTORY_BATCH) })}</button>}
        {history.messages.map(message => {
          const pendingUser = pendingUserRecovery(message, props.human.pending, props.messages);
          return <Fragment key={message.id}>
            <MessageItem msg={message} agent={props.agent} sessionId={sessionId}
              compactionMarkers={compactions.byAssistant.get(message.id)}
              inlineCompaction={compactions.inlineMarkerIds.has(message.id)}
              userNotice={pendingUser ? <HumanInputRecovery pending={pendingUser}
                busy={props.human.isWorking(pendingUser.input.id)} english={locale === 'en-US'}
                onCheck={() => { void props.human.check(pendingUser); }} /> : undefined}
              askStatus={message.ask && !message.ask.answered
                ? message.id === latestAsk?.id
                  ? props.askFeedback?.askId === message.id ? props.askFeedback.status : 'checking'
                  : 'expired'
                : props.askFeedback?.askId === message.id ? props.askFeedback.status : undefined}
              askStatusDetail={props.askFeedback?.askId === message.id ? props.askFeedback.detail : undefined}
              onAskCheck={message.id === latestAsk?.id ? props.onAskCheck : undefined}
              isStreaming={props.streaming && message === props.messages.at(-1)}
              compacting={props.compaction?.phase === 'running' && message === props.messages.at(-1)}
              isEditing={props.editor.editingMsgId === message.id} editContent={props.editor.editContent}
              setEditContent={props.editor.setEditContent} onSaveEdit={props.editor.saveEdit}
              onCancelEdit={props.editor.cancelEdit} onStartEdit={props.editor.startEdit}
              onDeleteMessage={props.editor.deleteMessage} onAskReply={props.answer} />
            <HumanInputList message={message} pending={props.human.pending}
              isWorking={props.human.isWorking} onCheck={entry => { void props.human.check(entry); }} activity={inputActivity} />
          </Fragment>;
        })}
        {unrepresentedHumanInputs(props.messages, props.human.pending).map(entry => <PendingHumanInput key={entry.input.id} pending={entry}
          busy={props.human.isWorking(entry.input.id)} english={locale === 'en-US'} activity={inputActivity}
          onCheck={() => { void props.human.check(entry); }} />)}
        <div ref={props.scroll.endRef} />
      </div>
      {props.scroll.showJump && <button className="chat__jump-bottom"
        onClick={() => props.scroll.scrollToBottom('smooth')} aria-label={t('chat.page.jumpBottom')}
        title={t('chat.page.jumpLatest')}>↓</button>}
    </main>
    <Composer {...props} />
    <TaskBoardDrawer board={props.taskboard.board} onChange={props.taskboard.change}
      expanded={props.taskboard.open} onToggle={props.taskboard.toggle} glow={props.taskboard.unseen}
      observations={props.taskboard.observations} observationScope="conversation" observationOwnerId={sessionId} />
  </>;
}

function Composer(props: MonsoonConversationProps) {
  const { t, locale } = useLocale();
  const ask = findLatestAnswerableAsk(props.messages);
  const route = decidePendingAskInputRoute(ask, props.askFeedback, props.streaming);
  const answerMode = route === 'answer' || route === 'blocked';
  return <div className="chat__input-area">
    <CompactionStatus activity={props.compaction} />
    <ExecutionStatusBar message={props.streaming && props.compaction?.phase !== 'running'
      ? props.messages.at(-1) : undefined} />
    <ImageDrafts images={props.images.drafts}
      onRemove={key => props.images.setDrafts(values => values.filter(image => image.key !== key))} />
    {props.images.error && <div className="chat__image-error" role="alert">{props.images.error}</div>}
    {props.human.recoveryError && <div className="chat__image-error" role="alert">{props.human.recoveryError}</div>}
    <div className="chat__input-wrapper">
      <input ref={props.images.fileRef} type="file" accept={IMAGE_ACCEPT} multiple hidden
        onChange={event => { void props.images.addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <button type="button" className="chat__attach-btn" onClick={() => props.images.fileRef.current?.click()}
        disabled={props.compacting || props.streaming || answerMode}
        title={props.streaming ? t('chat.page.attachAfterReply') : t('chat.page.attach')}
        aria-label={t('chat.page.attach')}><AttachIcon /></button>
      <textarea ref={props.images.inputRef} className="chat__input" value={props.input}
        onChange={event => resizeInput(event, props.setInput)}
        onPaste={event => {
          if (answerMode && Array.from(event.clipboardData.files)
            .some(file => file.type.startsWith('image/'))) {
            event.preventDefault(); props.images.setError(t('chat.ask.noImages')); return;
          }
          pasteImages(event, props.images.addFiles);
        }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); props.send(); } }}
        disabled={props.compacting}
        placeholder={props.compacting ? t('chat.page.inputCompacting')
          : props.streaming ? t('chat.page.inputStreaming')
            : answerMode ? t('chat.ask.answerPlaceholder') : t('chat.page.inputPlaceholder')}
        rows={1} aria-label={t('chat.page.inputLabel')} />
      <ComposerActions {...props} english={locale === 'en-US'} route={route} />
    </div>
    <div className="chat__command-hints"><span>{t('chat.page.compactHint')}</span></div>
  </div>;
}

function ComposerActions(props: MonsoonConversationProps & {
  english: boolean; route: ReturnType<typeof decidePendingAskInputRoute> }) {
  const { t } = useLocale();
  if (props.compacting) return <button className="chat__stop-btn" onClick={props.stop}
    title={props.english ? 'Stop compaction' : '中止压缩'} aria-label={props.english ? 'Stop compaction' : '中止压缩'}>
    <StopIcon /></button>;
  if (props.route === 'blocked') return <>
    <button className="chat__send-btn" disabled title={t('chat.ask.checking')}
      aria-label={t('chat.ask.sendAnswer')}><SendIcon /></button>
    {props.streaming && <button className="chat__stop-btn" onClick={props.stop}
      title={t('chat.page.stop')}><StopIcon /></button>}
  </>;
  if (props.streaming) return <>
    <button className="chat__send-btn" onClick={props.send}
      disabled={!props.input.trim() || props.human.busy}
      title={props.english ? 'Send human steering' : '发送插话'}
      aria-label={props.english ? 'Send human steering' : '发送插话'}><SendIcon /></button>
    <button className="chat__stop-btn" onClick={props.stop} title={t('chat.page.stop')}><StopIcon /></button>
  </>;
  return <button className="chat__send-btn" onClick={props.send}
    disabled={!props.input.trim() && !props.images.drafts.length}
    title={props.route === 'answer' ? t('chat.ask.sendAnswer') : undefined}
    aria-label={props.route === 'answer' ? t('chat.ask.sendAnswer') : undefined}><SendIcon /></button>;
}

function titleKey(event: React.KeyboardEvent, save: () => void, cancel: () => void) {
  if (event.key === 'Enter') save();
  if (event.key === 'Escape') cancel();
}
function resizeInput(event: React.ChangeEvent<HTMLTextAreaElement>, set: (value: string) => void) {
  set(event.target.value); event.target.style.height = 'auto';
  event.target.style.height = `${Math.min(event.target.scrollHeight, 200)}px`;
}
function pasteImages(event: React.ClipboardEvent, add: (files: File[]) => Promise<void>) {
  const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
  if (files.length) { event.preventDefault(); void add(files); }
}
function AgentWorkspaceButton({ agent }: { agent: Agent | null }) {
  const { t } = useLocale();
  const open = async () => {
    if (!agent) return;
    const response = await backendFetch(`/api/chat/agent/${agent.id}/open-workspace`, { method: 'POST' });
    if (!response.ok) alert((await response.json().catch(() => ({})))?.error
      || t('chat.page.workspaceOpenFailed', { status: response.status }));
  };
  return <button type="button" onClick={open} disabled={!agent} className="chat__workspace-btn"
    title={agent ? t('chat.page.workspaceOpen') : t('chat.page.selectAgentFirst')}>
    <span className="chat__workspace-btn-icon" aria-hidden="true">↗</span><span>{t('chat.page.workspace')}</span>
  </button>;
}

const EmptyIcon = () => <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
const SendIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>;
const StopIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>;
const AttachIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.8-2.8l9.3-9.3" /></svg>;

const headerStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--border-color)', fontSize: 'var(--text-sm)' };
const headerActionsStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginRight: 30 };
const sessionIdStyle: React.CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', textShadow: 'var(--text-halo)' };
const emptyStyle: React.CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--space-4)', color: 'var(--color-text-tertiary)', textShadow: 'var(--text-halo)' };
const modelStyle: React.CSSProperties = { padding: '2px var(--space-2)', background: 'var(--color-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontSize: 'var(--text-xs)', fontFamily: 'inherit', maxWidth: 220 };
