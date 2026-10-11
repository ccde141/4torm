import { useEffect, useRef, type RefObject } from 'react';
import { streamUrl } from '../../lib/apiBase';
import { getSession } from '../../store/chat';
import type { Agent, ChatMessage } from '../../types';
import { applyExternalSessionSnapshot, parseMonsoonSessionSignal,
  SessionRefreshBuffer } from './monsoon-external-sync';

interface Options {
  active: boolean;
  agent: Agent | null;
  activeSessionId: string | null;
  streaming: boolean;
  activeSessionIdRef: RefObject<string | null>;
  selectedAgentIdRef: RefObject<string | null>;
  messagesRef: RefObject<ChatMessage[]>;
  runnersRef: RefObject<{ has(sessionId: string): boolean }>;
  setMessages(messages: ChatMessage[]): void;
  refreshSessions(agent: Agent): Promise<void>;
  reportError(detail: string): void;
}

export function useMonsoonExternalChanges(options: Options): void {
  const { active, agent, activeSessionId, streaming, activeSessionIdRef, selectedAgentIdRef, messagesRef,
    runnersRef, setMessages, refreshSessions, reportError } = options;
  const buffer = useRef(new SessionRefreshBuffer());
  const refreshRef = useRef<(sessionId: string) => void>(() => undefined);
  useEffect(() => {
    if (!active || !agent || typeof EventSource === 'undefined') return;
    let open = true;
    let sequence = 0;
    const fail = (error: unknown) => { if (open) reportError(String(error)); };
    const refreshList = () => { void refreshSessions(agent).catch(fail); };
    const refreshCurrent = (sessionId: string) => {
      if (!buffer.current.note(sessionId, runnersRef.current.has(sessionId))) return;
      const request = ++sequence;
      void applyExternalSessionSnapshot(agent.id, sessionId, {
        load: getSession,
        currentMessages: () => messagesRef.current,
        mayApply: () => {
          if (!open || request !== sequence || selectedAgentIdRef.current !== agent.id
            || activeSessionIdRef.current !== sessionId) return false;
          if (runnersRef.current.has(sessionId)) {
            buffer.current.note(sessionId, true);
            return false;
          }
          return true;
        },
        apply: setMessages,
      }).catch(fail);
    };
    refreshRef.current = refreshCurrent;
    const source = new EventSource(streamUrl('/api/tide/changes'), { withCredentials: true });
    source.onopen = () => {
      refreshList();
      const sessionId = activeSessionIdRef.current;
      if (sessionId) refreshCurrent(sessionId);
    };
    source.onmessage = message => {
      try {
        const signal = parseMonsoonSessionSignal(message.data);
        if (!signal || signal.agentId !== agent.id) return;
        refreshList();
        if (activeSessionIdRef.current === signal.sessionId) refreshCurrent(signal.sessionId);
      } catch (error) { fail(error); }
    };
    return () => { open = false; sequence++; source.close();
      refreshRef.current = () => undefined; buffer.current.clear(); };
  }, [active, agent, activeSessionIdRef, selectedAgentIdRef, messagesRef,
    runnersRef, setMessages, refreshSessions, reportError]);
  useEffect(() => {
    if (!active || !agent || !activeSessionId || streaming) return;
    if (buffer.current.drain(activeSessionId, runnersRef.current.has(activeSessionId))) {
      refreshRef.current(activeSessionId);
    }
  }, [active, agent, activeSessionId, streaming, runnersRef]);
}
