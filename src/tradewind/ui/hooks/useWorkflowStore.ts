/**
 * 信风画布状态管理 — 节点/边/选中状态
 *
 * 使用 React 19 的 useState + useCallback 管理 xyflow 状态。
 * 不引入 zustand/jotai，保持项目一致性。
 */

import { useState, useCallback, useRef } from 'react';
import type { Node, Edge, OnNodesChange, OnEdgesChange, OnConnect, Connection } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import type { WorkflowGraph, EdgeKind } from '../../types';
import { loadWorkflow, saveWorkflow, type WorkflowChangeEvent, type SaveWorkflowInput } from '../workflow-client';
import { deserializeWorkflowNode, serializeWorkflowNode, deserializeWorkflowEdge, serializeWorkflowEdge } from '../workflow-node-serialization';
import { useLocale } from '../../../i18n/LocaleContext';
import { WorkflowRevisionTracker, type WorkflowRevisionState } from './workflow-revision';
import { WorkflowLoadGate } from './workflow-load-gate';
import { reconcileWorkflowRemote } from './workflow-remote-sync';
import { getDefaultConfig, getDefaultLabel, nextId } from './workflow-editor-defaults';

// ── 类型 ──────────────────────────────────────────────────────────

export interface WorkflowStoreState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  workflowId: string;
  workflowName: string;
  orchestration: 'strict' | 'handoff';
  revisionState: WorkflowRevisionState;
}

export interface WorkflowStoreActions {
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  selectNode: (id: string | null) => void;
  addNode: (type: string, position: { x: number; y: number }, config?: Record<string, unknown>) => void;
  removeSelected: () => void;
  deleteNode: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
  cloneNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  syncReworkEdge: (gateNodeId: string, targetNodeId: string | null) => void;
  getGraph: () => WorkflowGraph;
  loadGraph: (graph: WorkflowGraph, workflowId: string, workflowName?: string, revision?: string | null) => void;
  clearSelection: () => void;
  save: (name?: string) => Promise<boolean>;
  saveAsCopy: () => Promise<{ id: string; saved: boolean; adopted: boolean } | null>;
  load: (workflowId: string) => Promise<boolean>;
  cancelLoad: () => void;
  prepareSwitch: () => Promise<void>;
  initializeGraph: (graph: WorkflowGraph, id: string, name: string, revision?: string) => void;
  reconcileRemote: (change?: WorkflowChangeEvent) => Promise<void>;
  setWorkflowName: (name: string) => void;
}

// ── Hook ──────────────────────────────────────────────────────────

export function useWorkflowStore(): WorkflowStoreState & WorkflowStoreActions {
  const { t } = useLocale();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState('untitled');
  const [workflowName, setWorkflowName] = useState(() => t('tradewind.untitled'));
  const [orchestration, setOrchestration] = useState<'strict' | 'handoff'>('strict');
  const [revisionState, setRevisionState] = useState<WorkflowRevisionState>({
    workflowId: 'untitled', revision: null, dirty: false, saving: false, conflict: false,
  });
  const revisionRef = useRef<WorkflowRevisionTracker | null>(null);
  if (!revisionRef.current) revisionRef.current = new WorkflowRevisionTracker(setRevisionState);
  const draftRef = useRef<(name?: string) => Omit<SaveWorkflowInput, 'expectedRevision'> | null>(() => null);
  const loadGateRef = useRef(new WorkflowLoadGate());
  const initializedRef = useRef(false);
  const markDirty = useCallback(() => revisionRef.current?.edit(), []);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      if (changes.some(change => !['select', 'dimensions'].includes(change.type))) markDirty();
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [markDirty],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      if (changes.some(change => change.type !== 'select')) markDirty();
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [markDirty],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      // Note 节点出去的边自动设为 'note' 类型
      const sourceNode = nodes.find(n => n.id === connection.source);
      const kind: EdgeKind = sourceNode?.type === 'note' ? 'note' : 'handoff';
      const edge: Edge = {
        ...connection,
        id: nextId('e'),
        type: 'tradewind',
        data: { kind },
      } as Edge;
      markDirty();
      setEdges((eds) => addEdge(edge, eds));
    },
    [nodes, markDirty],
  );

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  const addNode = useCallback(
    (type: string, position: { x: number; y: number }, config?: Record<string, unknown>) => {
      const id = nextId(type);
      const label = getDefaultLabel(type, t);
      const node: Node = {
        id,
        type,
        position,
        data: { label, config: config ?? getDefaultConfig(type) },
      };
      markDirty();
      setNodes((nds) => [...nds, node]);
    },
    [t, markDirty],
  );

  const removeSelected = useCallback(() => {
    if (!selectedNodeId) return;
    markDirty();
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId, markDirty]);

  const deleteNode = useCallback((nodeId: string) => {
    markDirty();
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId, markDirty]);

  const deleteEdge = useCallback((edgeId: string) => {
    markDirty();
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
  }, [markDirty]);

  const cloneNode = useCallback((nodeId: string) => {
    if (!nodes.some(node => node.id === nodeId)) return;
    markDirty();
    setNodes((nds) => {
      const source = nds.find((n) => n.id === nodeId);
      if (!source) return nds;
      const id = nextId(source.type ?? 'node');
      const clone: Node = {
        ...source,
        id,
        position: { x: source.position.x + 40, y: source.position.y + 40 },
        data: { ...(source.data as object) },
        selected: false,
      };
      return [...nds, clone];
    });
  }, [nodes, markDirty]);

  const updateNodeData = useCallback((nodeId: string, data: Record<string, unknown>) => {
    markDirty();
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      return { ...n, data: { ...(n.data as object), ...data } };
    }));
  }, [markDirty]);

  /**
   * 同步 Human Gate 节点的 rework 边
   * - 删除该 gate 的所有现有 rework 出线
   * - 如果指定了 targetNodeId，创建新的 rework 边（sourcePort=1, rework=true）
   */
  const syncReworkEdge = useCallback((gateNodeId: string, targetNodeId: string | null) => {
    markDirty();
    setEdges((eds) => {
      // 删除该 gate 的旧 rework 出线
      const filtered = eds.filter(e => !(e.source === gateNodeId && (e.data as any)?.rework));
      if (!targetNodeId) return filtered;
      // 加新边
      const newEdge: Edge = {
        id: nextId('e'),
        source: gateNodeId,
        target: targetNodeId,
        type: 'tradewind',
        data: { kind: 'handoff', rework: true, sourcePort: 1 },
      } as Edge;
      return [...filtered, newEdge];
    });
  }, [markDirty]);

  const getGraph = useCallback((): WorkflowGraph => {
    return { orchestration, nodes: nodes.map(serializeWorkflowNode), edges: edges.map(serializeWorkflowEdge) };
  }, [nodes, edges, orchestration]);

  draftRef.current = (name?: string) => {
    const graph = getGraph();
    // Empty drafts are persistable; execution validity belongs to the run validator.
    return workflowId === 'untitled' ? null : { workflowId, graph, name: name?.trim() || workflowName };
  };

  const loadGraph = useCallback((graph: WorkflowGraph, wfId: string, name?: string, revision: string | null = null) => {
    initializedRef.current = true;
    loadGateRef.current.invalidate();
    revisionRef.current?.load(wfId, revision);
    setWorkflowId(wfId);
    setWorkflowName(name?.trim() || wfId);
    setOrchestration(graph.orchestration ?? 'strict');
    setNodes(graph.nodes.map(deserializeWorkflowNode));
    setEdges(graph.edges.map(deserializeWorkflowEdge));
    setSelectedNodeId(null);
  }, []);

  const save = useCallback(async (name?: string) => {
    return revisionRef.current!.save(
      () => draftRef.current(name),
      input => saveWorkflow(input, t('tradewind.saveFailed')),
    );
  }, [t]);

  const clearSelection = useCallback(() => {
    loadGraph({ orchestration, nodes: [], edges: [] }, 'untitled', t('tradewind.untitled'));
  }, [loadGraph, orchestration, t]);

  const prepareSwitch = useCallback(async () => {
    const tracker = revisionRef.current!;
    await tracker.waitForSave();
    if (!tracker.state.dirty) return;
    if (!await save()) throw new Error(t('tradewind.notReady'));
    if (tracker.state.dirty) throw new Error('草稿仍有未保存修改，请先保存。 / Save the latest draft before switching.');
  }, [save, t]);
  const cancelLoad = useCallback(() => loadGateRef.current.invalidate(), []);
  const initializeGraph = useCallback((graph: WorkflowGraph, id: string, name: string, revision?: string) => {
    const state = revisionRef.current!.state;
    if (!initializedRef.current && state.workflowId === 'untitled' && !state.dirty) loadGraph(graph, id, name, revision);
  }, [loadGraph]);

  const saveAsCopy = useCallback(async (): Promise<{ id: string; saved: boolean; adopted: boolean } | null> => {
    const graph = getGraph();
    if (workflowId === 'untitled') return null;
    const id = `wf-${crypto.randomUUID()}`;
    const name = workflowName;
    const result = await revisionRef.current!.saveCopy(
      { workflowId: id, graph, name },
      input => saveWorkflow(input, t('tradewind.saveFailed')),
      revision => loadGraph(graph, id, name, revision),
    );
    return { id, ...result };
  }, [getGraph, workflowId, workflowName, loadGraph, t]);

  const load = useCallback(async (id: string) => {
    return loadGateRef.current.run(
      () => loadWorkflow(id, t('tradewind.workflowList.loadFailed')),
      data => loadGraph(data.graph, data.workflowId, data.name, data.revision),
    );
  }, [loadGraph, t]);

  const reconcileRemote = useCallback((change?: WorkflowChangeEvent) => reconcileWorkflowRemote(
    revisionRef.current!, loadGateRef.current, change,
    id => loadWorkflow(id, t('tradewind.workflowList.loadFailed')),
    data => loadGraph(data.graph, data.workflowId, data.name, data.revision),
    clearSelection,
    localStorage,
  ), [loadGraph, clearSelection, t]);

  const renameWorkflow = useCallback((name: string) => {
    if (name !== workflowName) markDirty();
    setWorkflowName(name);
  }, [workflowName, markDirty]);

  return {
    nodes, edges, selectedNodeId, workflowId, workflowName, orchestration, revisionState,
    onNodesChange, onEdgesChange, onConnect,
    selectNode, addNode, removeSelected, deleteNode, deleteEdge, cloneNode, updateNodeData,
    syncReworkEdge,
    getGraph, loadGraph, clearSelection, save, saveAsCopy, load, cancelLoad, prepareSwitch, initializeGraph,
    reconcileRemote, setWorkflowName: renameWorkflow,
  };
}
