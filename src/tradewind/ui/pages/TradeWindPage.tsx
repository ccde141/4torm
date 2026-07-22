/**
 * 信风主页 — 画布编辑器 + 节点面板 + 工具栏 + 配置面板 + 工作流列表
 */

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TradeWindCanvas } from '../canvas/TradeWindCanvas';
import { NodePalette } from '../panels/NodePalette';
import { Toolbar } from '../panels/Toolbar';
import { ConfigPanel } from '../panels/ConfigPanel';
import { WorkflowListPanel } from '../panels/WorkflowListPanel';
import { ProfilePanel } from '../panels/ProfilePanel';
import { AgentChatWindow } from '../chat/AgentChatWindow';
import { MeetingPanel } from '../meeting/MeetingPanel';
import { HumanGatePanel } from '../chat/HumanGatePanel';
import { WorkflowInfoPanel } from '../panels/WorkflowInfoPanel';
import { useWorkflowStore } from '../hooks/useWorkflowStore';
import { useExecution } from '../hooks/useExecution';
import { scheduleAutoSave } from '../hooks/auto-save';
import { deleteWorkflow, openWorkflowWorkspace } from '../workflow-client';
import { validateGraph } from '../workflow-validation';
import type { WorkflowMode } from '../../types';

export default function TradeWindPage() {
  const store = useWorkflowStore();
  const execution = useExecution();
  const [listVisible, setListVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [chatTarget, setChatTarget] = useState<{ nodeId: string; label: string } | null>(null);
  const [meetingTarget, setMeetingTarget] = useState<{ nodeId: string; label: string } | null>(null);
  const [gateTarget, setGateTarget] = useState<{ nodeId: string; label: string; envelopeContent: string } | null>(null);
  // 持久化挂载：曾打开过的面板不卸载，只隐藏
  const openedChatsRef = useRef<Map<string, { nodeId: string; label: string }>>(new Map());
  const openedMeetingsRef = useRef<Map<string, { nodeId: string; label: string }>>(new Map());
  const [, forceUpdate] = useState(0); // 触发重渲染
  const [saveTime, setSaveTime] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 本次工作流是否已结束（结束后面板/侧板转只读"封存"，内容保留不清）
  const [sessionEnded, setSessionEnded] = useState(false);

  // 清空所有已打开的持久面板（用于"开始新一轮 / 切换工作流"，不用于"结束"）
  const clearPanels = useCallback(() => {
    openedChatsRef.current.clear();
    openedMeetingsRef.current.clear();
    setChatTarget(null);
    setMeetingTarget(null);
    forceUpdate(n => n + 1);
  }, []);

  // 运行状态切换：
  //   结束（running→stopped）：不再清面板，内容保留、转只读封存（sessionEnded=true）。
  //   开始新一轮（stopped→running）：此刻才清掉上一轮的封存面板并解除封存。
  //   关软件 / 切换工作流另行清（见 handleNew / onLoad）。
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (!prevRunningRef.current && execution.running) {
      clearPanels();
      setSessionEnded(false);
    } else if (prevRunningRef.current && !execution.running) {
      setSessionEnded(true);
    }
    prevRunningRef.current = execution.running;
  }, [execution.running, clearPanels]);

  // 页面加载时恢复上次打开的工作流，失败则自动新建
  useEffect(() => {
    const init = async () => {
      const lastId = localStorage.getItem('tw-last-workflow');
      if (lastId && lastId !== 'untitled') {
        const res = await fetch(`/api/tradewind/workflow/load/${lastId}`);
        if (res.ok) {
          const data = await res.json() as { workflowId: string; name?: string; graph: import('../../types').WorkflowGraph };
          store.loadGraph(data.graph, data.workflowId, data.name);
          return;
        }
      }
      // 没有可恢复的工作流，开一张空白画布（仅内存，不落盘；加了节点保存/运行时才创建目录）
      const newId = `wf-${Date.now().toString(36)}`;
      store.loadGraph({ nodes: [], edges: [] }, newId, '未命名工作流');
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // workflowId 变化时记住
  useEffect(() => {
    if (store.workflowId !== 'untitled') {
      localStorage.setItem('tw-last-workflow', store.workflowId);
    }
  }, [store.workflowId]);

  // 监听 Agent 节点"交流"按钮事件
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, label } = (e as CustomEvent).detail;
      openedChatsRef.current.set(nodeId, { nodeId, label });
      setChatTarget({ nodeId, label });
      forceUpdate(n => n + 1);
    };
    window.addEventListener('tw-open-chat', handler);
    return () => window.removeEventListener('tw-open-chat', handler);
  }, []);

  // 监听 Meeting 节点"进入会议"按钮事件
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, label } = (e as CustomEvent).detail;
      openedMeetingsRef.current.set(nodeId, { nodeId, label });
      setMeetingTarget({ nodeId, label });
      forceUpdate(n => n + 1);
    };
    window.addEventListener('tw-open-meeting', handler);
    return () => window.removeEventListener('tw-open-meeting', handler);
  }, []);

  // 监听 Human Gate 节点"打开审查"事件
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, label, envelopeContent } = (e as CustomEvent).detail;
      setGateTarget({ nodeId, label, envelopeContent });
    };
    window.addEventListener('tw-open-gate', handler);
    return () => window.removeEventListener('tw-open-gate', handler);
  }, []);

  // 同步运行状态到全局标记（节点组件读取）
  useEffect(() => {
    (window as any).__tw_running = execution.running;
  }, [execution.running]);

  // 5 分钟自动保存
  const runAutoSave = useEffectEvent(async () => {
    if (await store.save()) {
      setSaveError(null);
      setSaveTime(Date.now());
    }
  });
  const reportAutoSaveError = useEffectEvent((error: unknown) => {
    setSaveError((error as Error).message || '自动保存失败');
  });

  useEffect(() => {
    if (store.workflowId === 'untitled') return;
    return scheduleAutoSave(runAutoSave, () => {}, reportAutoSaveError);
  }, [store.workflowId]);

  const handleRun = useCallback(async (mode: WorkflowMode = 'manual', profileId?: string) => {
    const graph = store.getGraph();
    const errors = validateGraph(graph, mode);
    if (errors.length > 0) {
      alert('工作流校验未通过：\n\n' + errors.join('\n'));
      return;
    }
    // 运行前先保存：确保后端工作流目录 / workspace 已创建（新建后未手动保存也能直接跑）
    try {
      if (!await store.save()) {
        setSaveError('空工作流尚未创建工作区');
        return;
      }
      setSaveError(null);
      execution.start(graph, store.workflowId, undefined, mode, profileId);
    } catch (error) {
      setSaveError((error as Error).message || '保存工作流失败');
    }
  }, [store, execution]);

  const handleStop = useCallback(() => {
    execution.stop();
  }, [execution]);

  const handleSave = useCallback(async () => {
    try {
      if (await store.save()) setSaveTime(Date.now());
      setSaveError(null);
    } catch (error) {
      setSaveError((error as Error).message || '保存工作流失败');
    }
  }, [store]);

  const handleOpenWorkspace = useCallback(async () => {
    try {
      await store.save();
      await openWorkflowWorkspace(store.workflowId);
      setSaveError(null);
    } catch (error) {
      setSaveError((error as Error).message || '打开工作流工作区失败');
    }
  }, [store]);

  const handleNew = useCallback(() => {
    clearPanels();
    setSessionEnded(false);
    const newId = `wf-${Date.now().toString(36)}`;
    store.loadGraph({ nodes: [], edges: [] }, newId, '未命名工作流');
    // 不立即落盘：空工作流无内容，等加了节点保存/运行时才创建目录（避免 0 节点幽灵 + 列表噪声）
  }, [store, clearPanels]);

  const handleDelete = useCallback(async (id: string) => {
    if (execution.running && id === store.workflowId) {
      throw new Error('当前工作流正在运行，请先停止后再删除');
    }
    await deleteWorkflow(id);
    if (id === store.workflowId) handleNew();
  }, [execution.running, store.workflowId, handleNew]);

  const selectedNode = useMemo(
    () => store.nodes.find((n) => n.id === store.selectedNodeId) ?? null,
    [store.nodes, store.selectedNodeId],
  );

  // 信息侧板数据：agent 节点列表 + 喂给 output 的终端节点
  const agentNodes = useMemo(
    () => store.nodes.filter((n) => n.type === 'agent').map((n) => ({ id: n.id, label: (n.data as any)?.label ?? n.id })),
    [store.nodes],
  );
  const outputSourceId = useMemo(() => {
    const outputNode = store.nodes.find((n) => n.type === 'output');
    if (!outputNode) return null;
    return store.edges.find((e) => e.target === outputNode.id)?.source ?? null;
  }, [store.nodes, store.edges]);

  return (
    <div className="tw-page">
      <Toolbar
        workflowId={store.workflowId}
        workflowName={store.workflowName}
        running={execution.running}
        saveTime={saveTime}
        onRun={handleRun}
        onOpenProfiles={() => setProfileVisible(true)}
        onStop={handleStop}
        onSave={handleSave}
        onOpenWorkspace={handleOpenWorkspace}
        onSetWorkflowName={store.setWorkflowName}
        onLoadList={() => setListVisible(!listVisible)}
      />
      <div className="tw-page__body">
        <NodePalette />
        <WorkflowListPanel
          visible={listVisible}
          currentId={store.workflowId}
          onClose={() => setListVisible(false)}
          onLoad={(id) => { clearPanels(); setSessionEnded(false); store.load(id); }}
          onNew={handleNew}
          onDelete={handleDelete}
        />
        <ProfilePanel
          visible={profileVisible}
          workflowId={store.workflowId}
          onClose={() => setProfileVisible(false)}
          onRun={handleRun}
        />
        <ReactFlowProvider>
          <TradeWindCanvas store={store} />
        </ReactFlowProvider>
        <ConfigPanel
          node={selectedNode}
          nodes={store.nodes}
          edges={store.edges}
          onClose={() => store.selectNode(null)}
          onUpdate={store.updateNodeData}
          onSyncReworkEdge={store.syncReworkEdge}
        />
        <WorkflowInfoPanel
          nodes={agentNodes}
          outputSourceId={outputSourceId}
          running={execution.running}
          sessionEnded={sessionEnded}
          lap={execution.lap}
        />
      </div>
      {(execution.error || saveError) && (
        <div className="tw-page__error">{execution.error || saveError}</div>
      )}
      {/* Agent 聊天面板：曾打开过的持久挂载，只隐藏不卸载 */}
      {[...openedChatsRef.current.values()].map(({ nodeId, label }) => (
        <AgentChatWindow
          key={nodeId}
          nodeId={nodeId}
          nodeLabel={label}
          executionId={execution.executionId}
          onClose={() => setChatTarget(null)}
          visible={chatTarget?.nodeId === nodeId}
          sealed={sessionEnded}
        />
      ))}
      {/* 会议室面板：同上 */}
      {[...openedMeetingsRef.current.values()].map(({ nodeId, label }) => (
        <MeetingPanel
          key={nodeId}
          nodeId={nodeId}
          nodeLabel={label}
          onClose={() => setMeetingTarget(null)}
          visible={meetingTarget?.nodeId === nodeId}
        />
      ))}
      {gateTarget && (
        <HumanGatePanel
          nodeId={gateTarget.nodeId}
          nodeLabel={gateTarget.label}
          envelopeContent={gateTarget.envelopeContent}
          onClose={() => setGateTarget(null)}
        />
      )}
    </div>
  );
}
