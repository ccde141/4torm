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
import { useWorkflowPageSync } from '../hooks/useWorkflowPageSync';
import { deleteWorkflow } from '../workflow-client';
import { validateGraph } from '../workflow-validation';
import type { WorkflowMode } from '../../types';
import type { ExecutionPhase } from '../hooks/execution-phase';
import { useLocale } from '../../../i18n/LocaleContext';
import { forgetPersistedWorkflow, rememberPersistedWorkflow } from '../workflow-recovery';

export default function TradeWindPage() {
  const { t } = useLocale();
  const store = useWorkflowStore();
  const execution = useExecution(store.workflowId);
  const editorRunning = execution.running && execution.workflowId === store.workflowId;
  const editorExecutionId = execution.workflowId === store.workflowId ? execution.executionId : null;
  const {
    saveTime, saveError, setSaveError, listRefreshKey, conflictText,
    handleSave, handleOpenWorkspace, handleReload, handleSaveCopy, reloadLabel, copyLabel,
  } = useWorkflowPageSync(store);
  const [listVisible, setListVisible] = useState(false);
  const [profileVisible, setProfileVisible] = useState(false);
  const [chatTarget, setChatTarget] = useState<{ nodeId: string; label: string } | null>(null);
  const [meetingTarget, setMeetingTarget] = useState<{ nodeId: string; label: string } | null>(null);
  const [gateTarget, setGateTarget] = useState<{ nodeId: string; label: string; envelopeContent: string } | null>(null);
  // 持久化挂载：曾打开过的面板不卸载，只隐藏
  const openedChatsRef = useRef<Map<string, { nodeId: string; label: string }>>(new Map());
  const openedMeetingsRef = useRef<Map<string, { nodeId: string; label: string }>>(new Map());
  const lastEditorExecutionRef = useRef<{ workflowId: string; executionId: string } | null>(null);
  useEffect(() => {
    if (editorExecutionId) lastEditorExecutionRef.current = { workflowId: store.workflowId, executionId: editorExecutionId };
  }, [editorExecutionId, store.workflowId]);
  const panelExecutionId = editorExecutionId || (
    lastEditorExecutionRef.current?.workflowId === store.workflowId
      ? lastEditorExecutionRef.current.executionId : null
  );
  const [, forceUpdate] = useState(0); // 触发重渲染

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
  const prevRunningRef = useRef<{ workflowId: string; running: boolean }>({ workflowId: '', running: false });
  useEffect(() => {
    const previous = prevRunningRef.current;
    if (!previous.running && editorRunning) {
      clearPanels();
      setSessionEnded(false);
    } else if (previous.workflowId === store.workflowId && previous.running && !editorRunning) {
      setSessionEnded(true);
    }
    prevRunningRef.current = { workflowId: store.workflowId, running: editorRunning };
  }, [editorRunning, store.workflowId, clearPanels]);

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
    (window as any).__tw_running = editorRunning;
  }, [editorRunning]);

  const handleRun = useCallback(async (mode: WorkflowMode = 'manual', profileId?: string) => {
    const graph = store.getGraph();
    const errors = validateGraph(graph, mode, t);
    if (errors.length > 0) {
      alert(`${t('tradewind.validationFailed')}\n\n${errors.join('\n')}`);
      return;
    }
    // 运行前先保存：确保后端工作流目录 / workspace 已创建（新建后未手动保存也能直接跑）
    try {
      if (!await store.save()) {
        setSaveError(t('tradewind.emptyWorkspace'));
        return;
      }
      rememberPersistedWorkflow(localStorage, store.workflowId);
      setSaveError(null);
      execution.start(store.workflowId, undefined, mode, profileId);
    } catch (error) {
      setSaveError((error as Error).message || t('tradewind.saveFailed'));
    }
  }, [store, execution, t]);

  const handleStop = useCallback(() => {
    execution.stop();
  }, [execution]);

  const handleNew = useCallback(() => {
    clearPanels();
    setSessionEnded(false);
    const newId = `wf-${Date.now().toString(36)}`;
    store.loadGraph({ nodes: [], edges: [] }, newId, t('tradewind.untitled'));
    // 不立即落盘：空工作流无内容，等加了节点保存/运行时才创建目录（避免 0 节点幽灵 + 列表噪声）
  }, [store, clearPanels, t]);

  const handleDelete = useCallback(async (id: string, expectedRevision: string) => {
    if (execution.running && id === store.workflowId) {
      throw new Error(t('tradewind.deleteRunning'));
    }
    await deleteWorkflow(id, expectedRevision, t('tradewind.workflowList.deleteFailed'));
    if (id === store.workflowId) {
      forgetPersistedWorkflow(localStorage, id);
      handleNew();
    }
  }, [execution.running, store.workflowId, handleNew, t]);

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
  const currentWorkflowPhase: ExecutionPhase = execution.workflowId === store.workflowId
    ? execution.phase
    : 'idle';
  const toolbarPhase: ExecutionPhase = execution.running ? execution.phase : currentWorkflowPhase;

  return (
    <div className="tw-page">
      <Toolbar
        workflowId={store.workflowId}
        workflowName={store.workflowName}
        activeWorkflowId={execution.running ? execution.workflowId : null}
        running={execution.running}
        phase={toolbarPhase}
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
          refreshKey={listRefreshKey}
          currentId={store.workflowId}
          onClose={() => setListVisible(false)}
          onLoad={async (id) => {
            try {
              if (await store.load(id)) {
                clearPanels();
                setSessionEnded(false);
                rememberPersistedWorkflow(localStorage, id);
                setSaveError(null);
              }
            } catch (error) {
              setSaveError(error instanceof Error ? error.message : t('tradewind.workflowList.loadFailed'));
            }
          }}
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
          <TradeWindCanvas store={store} executionPhase={currentWorkflowPhase} />
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
          workflowId={store.workflowId}
          executionId={editorExecutionId}
          running={editorRunning}
          sessionEnded={sessionEnded}
          lap={execution.lap}
        />
      </div>
      {(execution.error || saveError) && (
        <div className="tw-page__error">{execution.error || saveError}</div>
      )}
      {store.revisionState.conflict && (
        <div className="tw-page__error" role="alert">
          <span>{conflictText} </span>
          <button type="button" onClick={() => void handleReload()}>{reloadLabel}</button>
          <button type="button" onClick={() => void handleSaveCopy()}>{copyLabel}</button>
        </div>
      )}
      {/* Agent 聊天面板：曾打开过的持久挂载，只隐藏不卸载 */}
      {[...openedChatsRef.current.values()].map(({ nodeId, label }) => (
        <AgentChatWindow
          key={nodeId}
          nodeId={nodeId}
          nodeLabel={label}
          workflowId={store.workflowId}
          executionId={panelExecutionId}
          onClose={() => setChatTarget(null)}
          visible={chatTarget?.nodeId === nodeId}
          sealed={sessionEnded}
        />
      ))}
      {/* 会议室面板：同上 */}
      {panelExecutionId && [...openedMeetingsRef.current.values()].map(({ nodeId, label }) => (
        <MeetingPanel
          key={nodeId}
          nodeId={nodeId}
          nodeLabel={label}
          workflowId={store.workflowId}
          executionId={panelExecutionId}
          onClose={() => setMeetingTarget(null)}
          visible={meetingTarget?.nodeId === nodeId}
        />
      ))}
      {gateTarget && panelExecutionId && (
        <HumanGatePanel
          executionId={panelExecutionId}
          nodeId={gateTarget.nodeId}
          nodeLabel={gateTarget.label}
          envelopeContent={gateTarget.envelopeContent}
          onClose={() => setGateTarget(null)}
        />
      )}
    </div>
  );
}
