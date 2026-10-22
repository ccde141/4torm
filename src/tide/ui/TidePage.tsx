import { useEffect, useRef, useState } from 'react';
import { deleteTask, deleteTideSession, getTaskDetail, getTideSession,
  runNow, toggleTask } from '../../api/tide';
import { waitOperation } from '../../api/collaboration';
import { createTideNavigationIntent } from './tide-navigation-intent';
import { waitForTideRun } from './tide-runtime';
import { subscribeTideChanges } from './tide-change-client';
import { tideRefreshTargets } from './tide-change-routing';
import { useTideEntities } from './use-tide-entities';
import TidePageSidebar from './TidePageSidebar';
import TidePageMain from './TidePageMain';
import type { TideSelection } from './tide-selection';
import './tide-task-form.css';
import './tide-schedule-fields.css';
import './tide-task-detail.css';
import './tide-run-history.css';
import './tide-session-view.css';
import './tide-session-list.css';

export default function TidePage({ active = true, preselectTask, onClearPreselect }: {
  active?: boolean; preselectTask?: string | null; onClearPreselect?: () => void;
}) {
  const entities = useTideEntities(active);
  const live = useRef(entities);
  live.current = entities;
  const [manualRuns, setManualRuns] = useState<Map<string, string | null>>(new Map());
  const manualRunsRef = useRef(manualRuns);
  const waits = useRef(new Map<string, AbortController>());
  const navigationGuard = useRef(createTideNavigationIntent());
  const [navigationError, setNavigationError] = useState('');
  const [connected, setConnected] = useState(false);
  const agentsRef = useRef(entities.agents);
  agentsRef.current = entities.agents;

  useEffect(() => {
    if (!preselectTask) navigationGuard.current.reset();
  }, [preselectTask]);

  useEffect(() => {
    if (!active || !preselectTask || agentsRef.current.length === 0) return;
    const request = navigationGuard.current.begin(preselectTask);
    if (!request) return;
    const navigate = async () => {
      try {
        if (preselectTask.startsWith('session:')) {
          const match = /^session:([^:]+):(.+)$/.exec(preselectTask);
          const owner = agentsRef.current.find(agent => agent.id === match?.[1]);
          if (!match || !owner) throw new Error('关联的潮汐会话或 Agent 已不存在');
          const session = await getTideSession(owner.id, match[2]!);
          if (!request.isCurrent()) return;
          live.current.openSession(owner.id, session.id, session);
        } else {
          const detail = await getTaskDetail(preselectTask);
          if (!request.isCurrent()) return;
          if (!agentsRef.current.some(agent => agent.id === detail.task.agentId)) {
            throw new Error('关联的 Agent 已不存在');
          }
          live.current.openTask(detail.task, detail.recent, detail.runState);
        }
        setNavigationError('');
        onClearPreselect?.();
      } catch (cause) {
        if (!request.isCurrent()) return;
        setNavigationError(`无法定位潮汐目标：${String(cause)}`);
        onClearPreselect?.();
      }
    };
    void navigate();
    return () => navigationGuard.current.cancel();
  }, [active, preselectTask, entities.agents.length, onClearPreselect]);

  useEffect(() => {
    if (!active) { setConnected(false); return; }
    return subscribeTideChanges(event => {
      const current = live.current;
      if (event.type === 'disconnected') { setConnected(false); return; }
      if (event.type === 'sync') {
        setConnected(true);
        void current.refresh();
        void current.refreshSessions().catch(() => {});
        void current.refreshTask().catch(() => {});
        void current.refreshSession().catch(() => {});
        return;
      }
      const targets = tideRefreshTargets(current.identity, event);
      if (targets.overview) void current.refresh();
      if (targets.sessions) {
        void current.refreshSessions().catch(() => {});
      }
      if (targets.task) {
        void current.refreshTask(current.identity.selection ?? undefined).catch(() => {});
      }
      if (targets.session) {
        void current.refreshSession().catch(() => {});
      }
    });
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const interval = entities.identity.selection?.kind === 'session'
      ? 3000 : connected ? 15_000 : 3000;
    const timer = setInterval(() => {
      const current = live.current;
      if (current.identity.selection?.kind === 'task') {
        void current.refreshTask().catch(() => {});
      } else if (current.identity.selection?.kind === 'session') {
        void current.refreshSession().catch(() => {});
      }
    }, interval);
    return () => clearInterval(timer);
  }, [active, connected, entities.identity.selection?.kind]);

  useEffect(() => () => {
    navigationGuard.current.cancel();
    for (const controller of waits.current.values()) controller.abort();
  }, []);

  const setManualRun = (taskId: string, runId: string | null) => {
    const next = new Map(manualRunsRef.current).set(taskId, runId);
    manualRunsRef.current = next;
    setManualRuns(next);
  };
  const clearManualRun = (taskId: string, runId: string | null) => {
    if (manualRunsRef.current.get(taskId) !== runId) return;
    const next = new Map(manualRunsRef.current);
    next.delete(taskId);
    manualRunsRef.current = next;
    setManualRuns(next);
  };
  const cancelWaits = () => {
    for (const controller of waits.current.values()) controller.abort();
    waits.current.clear();
    manualRunsRef.current = new Map();
    setManualRuns(new Map());
  };

  const handleRunNow = async (taskId: string) => {
    if (manualRunsRef.current.has(taskId)) return;
    const task = live.current.tasks.find(item => item.id === taskId);
    if (!task) return;
    const expected: TideSelection = { kind: 'task', agentId: task.agentId, taskId };
    const controller = new AbortController();
    waits.current.set(taskId, controller);
    setManualRun(taskId, null);
    let runId: string | null = null;
    try {
      const receipt = await runNow(taskId);
      if (controller.signal.aborted) return;
      runId = receipt.runId;
      setManualRun(taskId, runId);
      void live.current.refresh();
      await waitForTideRun(taskId, runId, timeoutMs =>
        waitOperation('tide', taskId, runId!, timeoutMs, controller.signal),
      { timeoutMs: 60_000 });
      await live.current.refresh();
      await live.current.refreshTask(expected);
    } catch (cause) {
      if (!controller.signal.aborted) {
        await live.current.refresh();
        alert(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      clearManualRun(taskId, runId);
      if (waits.current.get(taskId) === controller) waits.current.delete(taskId);
    }
  };

  const handleAgent = (agentId: string) => {
    navigationGuard.current.manualSelection(preselectTask);
    setNavigationError('');
    cancelWaits();
    live.current.changeAgent(agentId);
  };
  const handleTask = (taskId: string) => {
    const task = live.current.tasks.find(item => item.id === taskId);
    if (!task) return;
    navigationGuard.current.manualSelection(preselectTask);
    setNavigationError('');
    live.current.openTask(task);
  };
  const handleCreate = () => {
    navigationGuard.current.manualSelection(preselectTask);
    setNavigationError('');
    live.current.openCreate();
  };
  const handleToggle = async (taskId: string) => {
    await toggleTask(taskId);
    await live.current.refresh();
    await live.current.refreshTask().catch(() => {});
  };
  const handleDelete = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      const selection = live.current.identity.selection;
      if (selection?.kind === 'task' && selection.taskId === taskId) {
        live.current.clearSelection();
      }
      await live.current.refresh();
      await live.current.refreshSessions();
    } catch (cause) { alert(cause instanceof Error ? cause.message : String(cause)); }
  };
  const handleViewSession = (sessionId: string, ownerAgentId?: string) => {
    const agentId = ownerAgentId ?? live.current.selectedAgent?.id;
    if (!agentId) return;
    navigationGuard.current.manualSelection(preselectTask);
    setNavigationError('');
    live.current.openSession(agentId, sessionId);
  };
  const handleDeleteSession = async () => {
    const task = live.current.selectedTask;
    if (!task) return;
    const expected: TideSelection = { kind: 'task', agentId: task.agentId, taskId: task.id };
    try {
      await deleteTideSession(task.id);
      await live.current.refreshTask(expected);
      await live.current.refresh();
      await live.current.refreshSessions();
    } catch (cause) { alert(cause instanceof Error ? cause.message : String(cause)); }
  };

  return <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>
    {navigationError && <p role="alert" className="agent-detail__error"
      style={{ position: 'absolute', top: 8, right: 18, zIndex: 2 }}>{navigationError}</p>}
    <TidePageSidebar entities={entities} manualRuns={manualRuns}
      onAgent={handleAgent} onTask={handleTask} onCreate={handleCreate}
      onToggle={taskId => { void handleToggle(taskId); }}
      onDelete={taskId => { void handleDelete(taskId); }}
      onRun={taskId => { void handleRunNow(taskId); }} onSession={handleViewSession} />
    <TidePageMain entities={entities} onViewSession={handleViewSession}
      onDeleteSession={() => { void handleDeleteSession(); }} />
  </div>;
}
