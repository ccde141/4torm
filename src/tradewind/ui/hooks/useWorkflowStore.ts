/**
 * 信风画布状态管理 — 节点/边/选中状态
 *
 * 使用 React 19 的 useState + useCallback 管理 xyflow 状态。
 * 不引入 zustand/jotai，保持项目一致性。
 */

import { useState, useCallback } from 'react';
import type { Node, Edge, OnNodesChange, OnEdgesChange, OnConnect, Connection } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import type { WorkflowGraph, WorkflowNode, WorkflowEdge, EdgeKind } from '../../types';
import { saveWorkflow } from '../workflow-client';
import { deserializeWorkflowNode, serializeWorkflowNode } from '../workflow-node-serialization';

// ── 类型 ──────────────────────────────────────────────────────────

export interface WorkflowStoreState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  workflowId: string;
  workflowName: string;
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
  loadGraph: (graph: WorkflowGraph, workflowId: string, workflowName?: string) => void;
  save: (name?: string) => Promise<boolean>;
  load: (workflowId: string) => Promise<void>;
  setWorkflowName: (name: string) => void;
}

// ── ID 生成 ───────────────────────────────────────────────────────

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}`;
}

// ── Hook ──────────────────────────────────────────────────────────

export function useWorkflowStore(): WorkflowStoreState & WorkflowStoreActions {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState('untitled');
  const [workflowName, setWorkflowName] = useState('未命名工作流');

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
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
      setEdges((eds) => addEdge(edge, eds));
    },
    [nodes],
  );

  const selectNode = useCallback((id: string | null) => {
    setSelectedNodeId(id);
  }, []);

  const addNode = useCallback(
    (type: string, position: { x: number; y: number }, config?: Record<string, unknown>) => {
      const id = nextId(type);
      const label = getDefaultLabel(type);
      const node: Node = {
        id,
        type,
        position,
        data: { label, config: config ?? getDefaultConfig(type) },
      };
      setNodes((nds) => [...nds, node]);
    },
    [],
  );

  const removeSelected = useCallback(() => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId));
  }, []);

  const cloneNode = useCallback((nodeId: string) => {
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
  }, []);

  const updateNodeData = useCallback((nodeId: string, data: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      return { ...n, data: { ...(n.data as object), ...data } };
    }));
  }, []);

  /**
   * 同步 Human Gate 节点的 rework 边
   * - 删除该 gate 的所有现有 rework 出线
   * - 如果指定了 targetNodeId，创建新的 rework 边（sourcePort=1, rework=true）
   */
  const syncReworkEdge = useCallback((gateNodeId: string, targetNodeId: string | null) => {
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
  }, []);

  const getGraph = useCallback((): WorkflowGraph => {
    const wfNodes: WorkflowNode[] = nodes.map(serializeWorkflowNode);
    const wfEdges: WorkflowEdge[] = edges.map((e) => {
      const data = (e.data ?? {}) as { kind?: EdgeKind; rework?: boolean; sourcePort?: number };
      return {
        id: e.id,
        source: e.source,
        sourcePort: data.sourcePort ?? 0,
        target: e.target,
        targetPort: 0,
        kind: (data.kind ?? 'handoff') as EdgeKind,
        rework: data.rework,
      };
    });
    return { nodes: wfNodes, edges: wfEdges };
  }, [nodes, edges]);

  const loadGraph = useCallback((graph: WorkflowGraph, wfId: string, name?: string) => {
    setWorkflowId(wfId);
    setWorkflowName(name?.trim() || wfId);
    setNodes(graph.nodes.map(deserializeWorkflowNode));
    setEdges(graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'tradewind',
      data: { kind: e.kind, rework: e.rework, sourcePort: e.sourcePort },
    })));
    setSelectedNodeId(null);
  }, []);

  const save = useCallback(async (name?: string) => {
    const graph = getGraph();
    // 空工作流（0 节点）不落盘：新建/自动保存若把空图写盘，会在目录里堆出一堆 0 节点幽灵条目。
    // 空工作流无内容可丢，等真正加了节点（运行/保存时）才创建目录。
    if (graph.nodes.length === 0) return false;
    await saveWorkflow({ workflowId, graph, name: name?.trim() || workflowName });
    return true;
  }, [workflowId, workflowName, getGraph]);

  const load = useCallback(async (id: string) => {
    const res = await fetch(`/api/tradewind/workflow/load/${id}`);
    if (!res.ok) return;
    const data = await res.json() as { workflowId: string; name?: string; graph: WorkflowGraph };
    loadGraph(data.graph, data.workflowId, data.name);
  }, [loadGraph]);

  return {
    nodes, edges, selectedNodeId, workflowId, workflowName,
    onNodesChange, onEdgesChange, onConnect,
    selectNode, addNode, removeSelected, deleteNode, deleteEdge, cloneNode, updateNodeData,
    syncReworkEdge,
    getGraph, loadGraph, save, load, setWorkflowName,
  };
}

// ── 默认值 ────────────────────────────────────────────────────────

function getDefaultLabel(type: string): string {
  const map: Record<string, string> = {
    entry: '入口', output: '出口', agent: 'Agent',
    meeting: '会议室', note: 'Note', 'human-gate': '暂停点',
  };
  return map[type] ?? type;
}

function getDefaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'agent': return { agentId: '' };
    case 'meeting': return { chairAgentId: '', participantNodeIds: [] };
    case 'note': return { content: '' };
    default: return {};
  }
}
