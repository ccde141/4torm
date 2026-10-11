import { useCallback, useEffect, useRef, useState } from 'react';
import { getAgents } from '../../store/agent';
import { AGENTS_CHANGED_EVENT } from '../../store/agent-events';
import type { Agent } from '../../types';
import { ClientFrameworkError } from '../../api/error-contract';
import { getTaskDetail, getTideSession, listTideSessions,
  type TideRunRecord, type TideSession, type TideSessionSummary,
  type TideTask, type TideRunState } from '../../api/tide';
import { createLatestRequestGuard } from '../../lib/latest-request';
import { useTideOverview } from './use-tide-overview';
import { acceptsTideResponse, selectTideAgent, selectTideCreate,
  selectTideSession, selectTideTask, type TidePageIdentity,
  type TideSelection } from './tide-selection';

const EMPTY_IDENTITY: TidePageIdentity = { agentId: null, selection: null };

export function useTideEntities(active: boolean) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [identity, setIdentity] = useState<TidePageIdentity>(EMPTY_IDENTITY);
  const identityRef = useRef(identity);
  const [taskDetail, setTaskDetail] = useState<TideTask | null>(null);
  const [viewingSession, setViewingSession] = useState<TideSession | null>(null);
  const [sessionList, setSessionList] = useState<TideSessionSummary[]>([]);
  const [runs, setRuns] = useState<TideRunRecord[]>([]);
  const [runState, setRunState] = useState<TideRunState | null>(null);
  const [detailError, setDetailError] = useState('');
  const taskGuard = useRef(createLatestRequestGuard());
  const sessionGuard = useRef(createLatestRequestGuard());
  const sessionsGuard = useRef(createLatestRequestGuard());
  const agentsGuard = useRef(createLatestRequestGuard());
  const overview = useTideOverview(identity.agentId ?? undefined, active);

  const replaceIdentity = useCallback((next: TidePageIdentity) => {
    identityRef.current = next;
    setIdentity(next);
    taskGuard.current.cancel();
    sessionGuard.current.cancel();
    setDetailError('');
  }, []);

  const clearSelection = useCallback(() => {
    replaceIdentity({ ...identityRef.current, selection: null });
    setTaskDetail(null);
    setViewingSession(null);
    setRuns([]);
    setRunState(null);
  }, [replaceIdentity]);

  const changeAgent = useCallback((agentId: string) => {
    const next = selectTideAgent(identityRef.current, agentId);
    replaceIdentity(next);
    sessionsGuard.current.cancel();
    setSessionList([]);
    setTaskDetail(null);
    setViewingSession(null);
    setRuns([]);
    setRunState(null);
  }, [replaceIdentity]);

  const refreshTask = useCallback(async (requested?: TideSelection) => {
    const expected = requested ?? identityRef.current.selection;
    if (expected?.kind !== 'task') return;
    if (!acceptsTideResponse(identityRef.current, expected)) return;
    const request = taskGuard.current.begin();
    try {
      const detail = await getTaskDetail(expected.taskId);
      if (!request.isCurrent() || !acceptsTideResponse(identityRef.current, expected)) return;
      if (detail.task.id !== expected.taskId || detail.task.agentId !== expected.agentId) {
        clearSelection(); return;
      }
      setTaskDetail(detail.task);
      setRuns(detail.recent);
      setRunState(detail.runState ?? null);
      setDetailError('');
    } catch (cause) {
      if (!request.isCurrent() || !acceptsTideResponse(identityRef.current, expected)) return;
      if (cause instanceof ClientFrameworkError && cause.kind === 'not_found') {
        clearSelection(); return;
      }
      setDetailError(String(cause));
      throw cause;
    }
  }, [clearSelection]);

  const refreshSession = useCallback(async () => {
    const expected = identityRef.current.selection;
    if (expected?.kind !== 'session') return;
    const request = sessionGuard.current.begin();
    try {
      const session = await getTideSession(expected.agentId, expected.sessionId);
      if (!request.isCurrent() || !acceptsTideResponse(identityRef.current, expected)) return;
      if (session.id !== expected.sessionId || session.agentId !== expected.agentId) {
        clearSelection(); return;
      }
      setViewingSession(session);
      setDetailError('');
    } catch (cause) {
      if (!request.isCurrent() || !acceptsTideResponse(identityRef.current, expected)) return;
      if (cause instanceof ClientFrameworkError && cause.kind === 'not_found') {
        clearSelection(); return;
      }
      setDetailError(String(cause));
      throw cause;
    }
  }, [clearSelection]);

  const refreshSessions = useCallback(async () => {
    const agentId = identityRef.current.agentId;
    const request = sessionsGuard.current.begin();
    if (!agentId) { setSessionList([]); return; }
    const list = await listTideSessions(agentId);
    if (!request.isCurrent() || identityRef.current.agentId !== agentId) return;
    setSessionList(list.filter(session => session.agentId === agentId));
  }, []);

  const refreshAgents = useCallback(async () => {
    const request = agentsGuard.current.begin();
    const list = await getAgents();
    if (!request.isCurrent()) return;
    setAgents(list);
    const current = identityRef.current.agentId;
    if (current && !list.some(agent => agent.id === current)) {
      replaceIdentity(EMPTY_IDENTITY);
      sessionsGuard.current.cancel();
      setSessionList([]); setTaskDetail(null); setViewingSession(null); setRuns([]);
      setRunState(null);
    }
  }, [replaceIdentity]);

  const openTask = useCallback((task: TideTask, recent?: TideRunRecord[],
    initialRunState?: TideRunState | null) => {
    replaceIdentity(selectTideTask(identityRef.current, task.agentId, task.id));
    setTaskDetail(task); setViewingSession(null); setRuns(recent ?? []);
    setRunState(initialRunState ?? null);
    if (!recent || initialRunState === undefined) void refreshTask().catch(() => {});
  }, [refreshTask, replaceIdentity]);

  const openSession = useCallback((agentId: string, sessionId: string,
    initial?: TideSession) => {
    replaceIdentity(selectTideSession(identityRef.current, agentId, sessionId));
    setTaskDetail(null); setRuns([]); setRunState(null); setViewingSession(initial ?? null);
    if (!initial) void refreshSession().catch(() => {});
  }, [refreshSession, replaceIdentity]);

  const openCreate = useCallback(() => {
    const agentId = identityRef.current.agentId;
    if (!agentId) return;
    replaceIdentity(selectTideCreate(identityRef.current, agentId));
    setTaskDetail(null); setRuns([]); setRunState(null); setViewingSession(null);
  }, [replaceIdentity]);

  useEffect(() => {
    void refreshAgents().catch(() => {});
    const onAgentsChanged = () => { void refreshAgents().catch(() => {}); };
    window.addEventListener(AGENTS_CHANGED_EVENT, onAgentsChanged);
    return () => {
      window.removeEventListener(AGENTS_CHANGED_EVENT, onAgentsChanged);
      agentsGuard.current.cancel();
    };
  }, [refreshAgents]);

  useEffect(() => {
    void refreshSessions().catch(() => {});
    if (!active) return () => sessionsGuard.current.cancel();
    const timer = setInterval(() => {
      void refreshAgents().catch(() => {});
      void refreshSessions().catch(() => {});
    }, 3000);
    return () => { clearInterval(timer); sessionsGuard.current.cancel(); };
  }, [active, identity.agentId, refreshAgents, refreshSessions]);

  useEffect(() => () => {
    taskGuard.current.cancel(); sessionGuard.current.cancel(); sessionsGuard.current.cancel();
  }, []);

  const selection = identity.selection;
  const selectedAgent = agents.find(agent => agent.id === identity.agentId) ?? null;
  const selectedTask = selection?.kind === 'task'
    ? overview.tasks.find(task => task.id === selection.taskId
      && task.agentId === selection.agentId)
      ?? (taskDetail?.id === selection.taskId && taskDetail.agentId === selection.agentId
        ? taskDetail : null)
    : null;
  const selectedSession = selection?.kind === 'session'
    && viewingSession?.id === selection.sessionId
    && viewingSession.agentId === selection.agentId ? viewingSession : null;

  return { agents, identity, selectedAgent, selectedTask, selectedSession,
    sessionList, runs, runState, detailError, ...overview,
    changeAgent, clearSelection, openTask, openSession, openCreate,
    refreshTask, refreshSession, refreshSessions, refreshAgents };
}

export type TideEntities = ReturnType<typeof useTideEntities>;
export function isCurrentTideSelection(entities: TideEntities, expected: TideSelection): boolean {
  return acceptsTideResponse(entities.identity, expected);
}
