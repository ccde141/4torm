import { useCallback, useEffect, useRef, useState } from 'react';
import { getAgents } from '../../store/agent';
import { getSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirm } from '../common/ConfirmDialog';
import { useSessionList } from './useSessionList';
import { useMessageEditor } from './useMessageEditor';
import { useStreamRunners } from './useStreamRunners';
import { useHumanInput } from './useHumanInput';
import { useMonsoonCatalog } from './useMonsoonCatalog';
import { useMonsoonTaskboard } from './useMonsoonTaskboard';
import { useMonsoonImages } from './useMonsoonImages';
import { useMonsoonScroll } from './useMonsoonScroll';
import { useMonsoonActions } from './useMonsoonActions';
import { useMonsoonExternalChanges } from './useMonsoonExternalChanges';
import { MonsoonSidebar } from './MonsoonSidebar';
import { MonsoonConversation } from './MonsoonConversation';
import '../../styles/components/chat.css';
import '../../styles/components/session-list.css';
import '../../styles/components/loading.css';

export interface ChatPageProps {
  active?: boolean;
  preselectSession?: string;
  onClearPreselect?: () => void;
}

export default function ChatPage({ active = true, preselectSession, onClearPreselect }: ChatPageProps) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  const selectedAgentIdRef = useRef<string | null>(null);
  const setMessages = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next; setMessagesState(next);
  }, []);

  const catalog = useMonsoonCatalog(active, selectedAgent, setSelectedAgent);
  const runners = useStreamRunners(() => activeSessionIdRef.current, setMessages, setStreaming);
  const sessions = useSessionList(selectedAgent, catalog.selectedModel, catalog.models,
    setSelectedAgent, setMessages, setStreaming, catalog.setSelectedModel, runners);
  const taskboard = useMonsoonTaskboard(sessions.activeSessionId, activeSessionIdRef, streaming);
  const images = useMonsoonImages(input, setInput, active,
    `${selectedAgent?.id ?? ''}:${sessions.activeSessionId ?? ''}`);
  const human = useHumanInput({ agent: selectedAgent, sessionId: sessions.activeSessionId,
    model: catalog.selectedModel, runners, refresh: sessions.refreshSessions,
    getMessages: () => messagesRef.current,
    clearText: text => { setInput(previous => previous.trim() === text ? '' : previous); images.setError(''); },
    onTaskboard: (sessionId, board) => {
      if (activeSessionIdRef.current === sessionId) taskboard.applyAgent(board);
    },
  });
  const editor = useMessageEditor(sessions.activeSessionId, selectedAgent,
    setMessages, sessions.refreshSessions);
  const scroll = useMonsoonScroll(messages, sessions.activeSessionId);
  const actions = useMonsoonActions({ selectedAgent, selectedModel: catalog.selectedModel,
    activeSessionId: sessions.activeSessionId, streaming, input, setInput, messages, setMessages,
    setStreaming, messagesRef, selectedAgentIdRef, activeSessionIdRef, runners, human,
    sessions, images, scroll, taskboard, translate: t });
  useMonsoonExternalChanges({ active, agent: selectedAgent,
    activeSessionId: sessions.activeSessionId, streaming, activeSessionIdRef,
    selectedAgentIdRef, messagesRef, runnersRef: runners.runners, setMessages,
    refreshSessions: sessions.refreshSessions, reportError: images.setError });

  useEffect(() => { activeSessionIdRef.current = sessions.activeSessionId; }, [sessions.activeSessionId]);
  useEffect(() => { selectedAgentIdRef.current = selectedAgent?.id ?? null; }, [selectedAgent?.id]);
  usePreselectedSession(preselectSession, onClearPreselect, catalog.agents, catalog.models,
    sessions.selectAgent, sessions.selectSession, catalog.setSelectedModel);

  const deleteSession = async (session: (typeof sessions.sessions)[number]) => {
    const accepted = await confirm({ title: t('chat.page.deleteSessionTitle', { title: session.title }),
      message: t('chat.page.deleteSessionMessage'), confirmText: t('common.delete'), danger: true });
    if (accepted) sessions.deleteSession(session.id);
  };

  return <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
    <MonsoonSidebar agents={catalog.agents} offlineIds={catalog.offlineIds}
      selectedAgent={selectedAgent} sessions={sessions.sessions} displayUsage={sessions.displayUsage}
      activeSessionId={sessions.activeSessionId} selectAgent={sessions.selectAgent}
      selectSession={sessions.selectSession} newSession={sessions.newSession}
      deleteSession={session => { void deleteSession(session); }} />
    <section style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <MonsoonConversation agent={selectedAgent} messages={messages} streaming={streaming}
        askFeedback={actions.askFeedback.feedback} onAskCheck={() => { void actions.checkAsk(); }}
        compacting={actions.compacting} input={input} setInput={setInput}
        compaction={sessions.activeSessionId ? runners.compactions[sessions.activeSessionId] : undefined}
        models={catalog.models} selectedModel={catalog.selectedModel}
        setSelectedModel={catalog.setSelectedModel} sessions={sessions} editor={editor}
        human={human} scroll={scroll} taskboard={taskboard} images={images}
        send={() => { void actions.send(); }} stop={actions.stop}
        answer={(messageId, answer) => { void actions.answer(messageId, answer); }} />
    </section>
  </div>;
}

function usePreselectedSession(
  sessionId: string | undefined,
  clear: (() => void) | undefined,
  agents: Agent[],
  models: { key: string; label: string }[],
  selectAgent: (agent: Agent) => void,
  selectSession: (id: string) => void,
  setModel: (model: string) => void,
) {
  useEffect(() => {
    if (!sessionId) return;
    let current = true;
    void (async () => {
      const session = await getSession(sessionId);
      if (!session || !current) return;
      const availableAgents = agents.length ? agents : await getAgents();
      const agent = availableAgents.find(candidate => candidate.id === session.agentId);
      if (!agent || !current) return;
      selectAgent(agent);
      if (session.model && models.some(model => model.key === session.model)) setModel(session.model);
      selectSession(session.id); clear?.();
    })();
    return () => { current = false; };
  }, [sessionId, agents, models, selectAgent, selectSession, setModel, clear]);
}
