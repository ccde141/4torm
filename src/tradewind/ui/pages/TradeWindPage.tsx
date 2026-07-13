/**
 * 信风主页 — 画布编辑器 + 节点面板 + 工具栏 + 配置面板 + 工作流列表
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { WorkflowGraph, WorkflowMode } from '../../types';

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
          const data = await res.json() as { workflowId: string; graph: import('../../types').WorkflowGraph };
          store.loadGraph(data.graph, data.workflowId);
          return;
        }
      }
      // 没有可恢复的工作流，开一张空白画布（仅内存，不落盘；加了节点保存/运行时才创建目录）
      const newId = `wf-${Date.now().toString(36)}`;
      store.loadGraph({ nodes: [], edges: [] }, newId);
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
  useEffect(() => {
    if (store.workflowId === 'untitled') return;
    const timer = setInterval(() => {
      store.save().then(() => setSaveTime(Date.now()));
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [store.workflowId, store]);

  const handleRun = useCallback(async (mode: WorkflowMode = 'manual', profileId?: string) => {
    const graph = store.getGraph();
    const errors = validateGraph(graph, mode);
    if (errors.length > 0) {
      alert('工作流校验未通过：\n\n' + errors.join('\n'));
      return;
    }
    // 运行前先保存：确保后端工作流目录 / workspace 已创建（新建后未手动保存也能直接跑）
    await store.save();
    execution.start(graph, store.workflowId, undefined, mode, profileId);
  }, [store, execution]);

  const handleStop = useCallback(() => {
    execution.stop();
  }, [execution]);

  const handleSave = useCallback(async () => {
    await store.save();
    setSaveTime(Date.now());
  }, [store]);

  const handleNew = useCallback(() => {
    clearPanels();
    setSessionEnded(false);
    const newId = `wf-${Date.now().toString(36)}`;
    store.loadGraph({ nodes: [], edges: [] }, newId);
    // 不立即落盘：空工作流无内容，等加了节点保存/运行时才创建目录（避免 0 节点幽灵 + 列表噪声）
  }, [store, clearPanels]);

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/tradewind/workflow/${id}`, { method: 'DELETE' });
  }, []);

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
        running={execution.running}
        saveTime={saveTime}
        onRun={handleRun}
        onOpenProfiles={() => setProfileVisible(true)}
        onStop={handleStop}
        onSave={handleSave}
        onSetWorkflowId={store.setWorkflowId}
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
      {execution.error && (
        <div className="tw-page__error">{execution.error}</div>
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

// ── 运行前校验 ────────────────────────────────────────────────────

function validateGraph(graph: WorkflowGraph, mode: WorkflowMode = 'manual'): string[] {
  const errors: string[] = [];

  // 自动模式否决手动专属节点（即时否决，无需往返后端；后端仍是最终事实源）
  if (mode === 'auto') {
    for (const n of graph.nodes) {
      if (n.type === 'meeting') errors.push(`自动模式不支持会议室节点「${n.label}」——会议需人类在场，请改用手动运行或移除`);
      if (n.type === 'human-gate') errors.push(`自动模式不支持暂停点节点「${n.label}」——全自动无人恢复，请改用手动运行或移除`);
    }
  }

  // Output 只能有一个
  const outputs = graph.nodes.filter(n => n.type === 'output');
  if (outputs.length === 0) errors.push('缺少出口节点');
  if (outputs.length > 1) errors.push(`出口节点只能有一个，当前有 ${outputs.length} 个`);

  // Agent 节点 agentId 不能为空
  for (const n of graph.nodes) {
    if (n.type === 'agent') {
      const agentId = (n.config as any)?.agentId;
      if (!agentId) errors.push(`Agent「${n.label}」未选择 Agent 实体`);
    }
    if (n.type === 'meeting') {
      const cfg = n.config as any;
      if (!cfg?.chairAgentId) errors.push(`会议室「${n.label}」未选择会长`);
      if (!cfg?.participantNodeIds?.length) errors.push(`会议室「${n.label}」未选择参与者`);
    }
  }

  // Entry 至少一个
  const entries = graph.nodes.filter(n => n.type === 'entry');
  if (entries.length === 0) errors.push('缺少入口节点');

  return errors;
}
