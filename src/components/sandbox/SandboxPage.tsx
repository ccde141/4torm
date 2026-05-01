import { useState, useCallback, useRef, useEffect } from 'react';
import '../../styles/components/sandbox.css';
import '../../styles/components/flow-nodes.css';
import {
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as flowAddEdge,
} from '@xyflow/react';
import type {
  SandboxWorkflow,
  SandboxNodeType,
  SandboxNode,
  SandboxEdge,
  ArrowConfig,
  NodeExecStatus,
  FlowExecStatus,
  ExecutionLog,
  Envelope,
  Port,
  SandboxNodeData,
  EntryNodeData,
  AgentNodeData,
  ConditionNodeData,
  LoopNodeData,
  MergeNodeData,
  ForkNodeData,
  VariableNodeData,
  HumanGateNodeData,
  ErrorHandlerNodeData,
  OutputNodeData,
  SubflowNodeData,
  GroupNodeData,
  NoteNodeData,
} from '../../types/sandbox';
import { getWorkflows, saveWorkflow, getExecutionState, saveExecutionState, clearExecutionState, createWorkflow, createInitialExecutionState, importWorkflow } from '../../store/sandbox';
import { setAgentStatus, getAgents } from '../../store/agent';
import type { Agent } from '../../types';
import { executeWorkflow, type ExecContext, validateWorkflow } from '../../engine/sandbox/executor';
import { createEnvelope, createEnvelopeFromUpstream, serializeEnvelope } from '../../engine/sandbox/envelope';
import { registerCustomNodes, getCustomNodeTypes, type PaletteEntry } from '../../engine/sandbox/customNodeLoader';
import FlowCanvas from './FlowCanvas';
import SandboxSidebar from './SandboxSidebar';
import HumanGateDialog from './HumanGateDialog';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import { NODE_CONFIG_SCHEMAS, ARROW_CONFIG_SCHEMA, type ConfigField } from './configSchema';

let nodeCounter = 0;

function genNodeId(type: SandboxNodeType): string {
  return `node-${type}-${++nodeCounter}`;
}

function createNodeData(type: SandboxNodeType): SandboxNodeData {
  switch (type) {
    case 'entry': return { label: '入口', inputContent: '', execStatus: 'idle' } as EntryNodeData;
    case 'agent': return { label: 'Agent', agentId: '', agentName: '', agentRole: '', outputSchema: null, inputPorts: [{ id: 'in-0', label: '输入' }], workspacePath: '', execStatus: 'idle' } as AgentNodeData;
    case 'condition': return { label: '条件分支', rules: [], execStatus: 'idle' } as ConditionNodeData;
    case 'loop-while': return { label: '条件循环', loopType: 'while', conditionField: 'input', conditionOperator: 'neq', conditionValue: 'done', maxIterations: 10, execStatus: 'idle' } as LoopNodeData;
    case 'merge': return { label: '合并', strategy: 'concat', execStatus: 'idle' } as MergeNodeData;
    case 'fork': return { label: '分叉', branchCount: 2, execStatus: 'idle' } as ForkNodeData;
    case 'variable': return { label: '变量', mode: 'read', variableName: '', sourceField: 'input', execStatus: 'idle' } as VariableNodeData;
    case 'human-gate': return { label: '人工确认', prompt: '请审阅当前内容并选择下一步操作', execStatus: 'idle' } as HumanGateNodeData;
    case 'error-handler': return { label: '错误处理', execStatus: 'idle' } as ErrorHandlerNodeData;
    case 'output': return { label: '输出', mode: 'final', filePath: 'workflow_output', fileNameTemplate: '{flow}_output', format: 'json', execStatus: 'idle' } as OutputNodeData;
    case 'subflow': return { label: '子流程', subflowId: '', subflowName: '', execStatus: 'idle' } as SubflowNodeData;
    case 'group': return { label: '组' } as GroupNodeData;
    case 'note': return { label: '备注', content: '' } as NoteNodeData;
    default: return { label: type, execStatus: 'idle' } as any;
  }
}

export default function SandboxPage() {
  const [workflow, setWorkflow] = useState<SandboxWorkflow | null>(null);
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [flowEdges, setFlowEdges] = useState<Edge[]>([]);
  const [execStatus, setExecStatus] = useState<FlowExecStatus>('idle');
  const [nodeExecStatus, setNodeExecStatus] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [humanGate, setHumanGate] = useState<any>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [manualZIndex, setManualZIndex] = useState<Record<string, number>>({});
  const humanGateResolve = useRef<((env: Envelope) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workflowRef = useRef<SandboxWorkflow | null>(null);
  workflowRef.current = workflow;

  const [customPalette, setCustomPalette] = useState<PaletteEntry[]>([]);
  const [customTypes, setCustomTypes] = useState<Record<string, any>>({});
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    getAgents().then(setAgents).catch((e) => console.warn('[Sandbox] 加载 Agent 列表失败:', e));
  }, []);

  useEffect(() => {
    // Lazy load custom nodes in background; failure is non-fatal
    registerCustomNodes().then(({ customTypes: ct, paletteEntries }) => {
      setCustomTypes(ct);
      setCustomPalette(paletteEntries);
    }).catch((e) => console.warn('[Sandbox] 注册自定义节点失败:', e));
  }, []);

  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; items: ContextMenuItem[];
  } | null>(null);

  const [configPanel, setConfigPanel] = useState<{
    type: 'node' | 'edge';
    nodeId?: string;
    edgeId?: string;
    nodeType?: string;
    data?: Record<string, any>;
    schema?: ConfigField[];
  } | null>(null);

  const syncToFlow = useCallback((wf: SandboxWorkflow) => {
    const nodeMap = new Map(wf.nodes.map(n => [n.id, n]));
    setFlowNodes(wf.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })));
    setFlowEdges(wf.edges.map(e => {
      let targetHandle = e.targetHandle;
      const targetNode = nodeMap.get(e.target);
      if (!targetHandle && targetNode?.type === 'agent') {
        targetHandle = 'in-0';
      }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle,
        data: { arrowConfig: e.arrowConfig },
      };
    }));
    const statusMap: Record<string, string> = {};
    for (const n of wf.nodes) {
      if ('execStatus' in n.data) {
        statusMap[n.id] = (n.data as any).execStatus;
      }
    }
    setNodeExecStatus(statusMap);
  }, []);

  const handleSelectWorkflow = useCallback(async (name: string) => {
    const oldWf = workflowRef.current;
    if (oldWf?.activeAgentIds?.length) {
      for (const agentId of oldWf.activeAgentIds) {
        setAgentStatus(agentId, 'idle').catch(() => {});
      }
    }
    const wfs = await getWorkflows();
    const wf = wfs.find(w => w.name === name) || null;
    setWorkflow(wf);
    if (wf) syncToFlow(wf);
    const exec = await getExecutionState(name);
    if (exec) {
      setExecStatus(exec.status);
      setLogs(exec.logs || []);
    } else {
      setExecStatus('idle');
      setLogs([]);
    }
  }, [syncToFlow]);

  const handleNewWorkflow = useCallback(() => {
    const oldWf = workflowRef.current;
    if (oldWf?.activeAgentIds?.length) {
      for (const agentId of oldWf.activeAgentIds) {
        setAgentStatus(agentId, 'idle').catch(() => {});
      }
    }
    setWorkflow(null);
    setFlowNodes([]);
    setFlowEdges([]);
    setExecStatus('idle');
    setLogs([]);
    setNodeExecStatus({});
    setConfigPanel(null);
    setContextMenu(null);
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setFlowNodes(nds => {
      const next = applyNodeChanges(changes, nds);
      if (workflow) {
        const updated: SandboxWorkflow = {
          ...workflow,
          nodes: next.map(n => ({
            id: n.id,
            type: (n.type || 'agent') as SandboxNodeType,
            position: n.position,
            data: n.data as SandboxNodeData,
          })),
        };
        setWorkflow(updated);
        saveWorkflow(updated);
      }
      return next;
    });
  }, [workflow]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdges(eds => {
      const next = applyEdgeChanges(changes, eds);
      if (workflow) {
        const updated: SandboxWorkflow = {
          ...workflow,
          edges: next.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle || undefined,
            targetHandle: e.targetHandle || undefined,
            arrowConfig: e.data?.arrowConfig,
          })),
        };
        setWorkflow(updated);
        saveWorkflow(updated);
      }
      return next;
    });
  }, [workflow]);

  const onConnect = useCallback((connection: Connection) => {
    setFlowEdges(eds => {
      const next = flowAddEdge({
        ...connection,
        id: `edge-${connection.source}-${connection.sourceHandle || ''}-${connection.target}-${connection.targetHandle || ''}`,
      }, eds);
      if (workflow) {
        const updated: SandboxWorkflow = {
          ...workflow,
          edges: next.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle || undefined,
            targetHandle: e.targetHandle || undefined,
          })),
        };
        setWorkflow(updated);
        saveWorkflow(updated);
      }
      return next;
    });
  }, [workflow]);

  const onDrop = useCallback((type: SandboxNodeType, position: { x: number; y: number }) => {
    if (!workflow) return;
    const id = genNodeId(type);
    const data = createNodeData(type);
    const style = (type === 'group' || type === 'note')
      ? undefined
      : { width: 180, height: 60 };
    const newNode: SandboxNode = { id, type, position, data, ...(style ? { style } : {}) };
    const updated: SandboxWorkflow = { ...workflow, nodes: [...workflow.nodes, newNode] };
    setWorkflow(updated);
    saveWorkflow(updated);
    setFlowNodes(prev => [...prev, {
      id, type, position, data, ...(style ? { style } : {}),
    }]);
  }, [workflow]);

  const handleEdgeClick = useCallback((edgeId: string) => {
    if (!workflow) return;
    const edge = workflow.edges.find(e => e.id === edgeId);
    if (!edge) return;
    setConfigPanel({
      type: 'edge',
      edgeId: edge.id,
      data: edge.arrowConfig || {},
      schema: ARROW_CONFIG_SCHEMA,
    });
  }, [workflow]);

  const handleNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (node.type === 'group' || node.type === 'note') return;
    const schema = NODE_CONFIG_SCHEMAS[node.type || ''] || [];
    const data = { ...node.data };

    if (node.type === 'agent') {
      const nd = data as Record<string, any>;
      if (!nd.inputPorts) {
        nd.inputPorts = [{ id: 'in-0', label: '输入' }];
      }
      if (nd.agentId && !nd.workspacePath) {
        nd.workspacePath = `data/agents/${nd.agentId}/.workspace/`;
      }
      if (nd.agentId && !nd.agentName && agents.length > 0) {
        const agent = agents.find(a => a.id === nd.agentId);
        if (agent) nd.agentName = agent.name;
      }
    }

    setConfigPanel({
      type: 'node',
      nodeId: node.id,
      nodeType: node.type || '',
      data,
      schema,
    });
  }, [agents]);

  const handleConfigFieldChange = useCallback((fieldKey: string, value: any) => {
    if (!configPanel || !workflow) return;
    if (configPanel.type === 'node' && configPanel.nodeId) {
      const nodeId = configPanel.nodeId;

      // Agent: agentId changed — pre-resolve agentName and workspacePath
      let resolvedAgentName: string | undefined;
      let resolvedWorkspacePath: string | undefined;
      if (fieldKey === 'agentId' && value) {
        const selectedAgent = agents.find(a => a.id === value);
        if (selectedAgent) {
          resolvedAgentName = selectedAgent.name;
          resolvedWorkspacePath = selectedAgent.config?.workspace || `data/agents/${value}/.workspace/`;
        }
      }

      setWorkflow(prev => {
        const node = prev.nodes.find(n => n.id === nodeId);
        let nextEdges = [...prev.edges];

        // Condition: rules shrunk — delete edges on removed output handles
        if (fieldKey === 'rules' && node) {
          const oldRules = (node.data as any).rules as any[] | undefined;
          const newRules = value as any[];
          const oldCount = Array.isArray(oldRules) ? oldRules.length : 0;
          const newCount = Array.isArray(newRules) ? newRules.length : 0;
          if (newCount < oldCount) {
            const removedHandleIds = new Set<string>();
            for (let i = newCount; i < oldCount; i++) removedHandleIds.add(`output-${i}`);
            nextEdges = nextEdges.filter(e => !(e.source === nodeId && e.sourceHandle && removedHandleIds.has(e.sourceHandle)));
          }
        }

        // Fork: branchCount shrunk — delete edges on removed fork handles
        if (fieldKey === 'branchCount' && node) {
          const oldCount = (node.data as any).branchCount as number || 2;
          const newCount = Number(value) || 2;
          if (newCount < oldCount) {
            const removedHandleIds = new Set<string>();
            for (let i = newCount; i < oldCount; i++) removedHandleIds.add(`fork-${i}`);
            nextEdges = nextEdges.filter(e => !(e.source === nodeId && e.sourceHandle && removedHandleIds.has(e.sourceHandle)));
          }
        }

        // Agent: inputPorts shrunk — delete edges on removed input handles
        if (fieldKey === 'inputPorts' && node) {
          const oldPorts = ((node.data as any).inputPorts) as any[] | undefined;
          const newPorts = value as any[];
          const oldIds = new Set(oldPorts?.map((p: any) => p.id));
          const newIds = new Set(newPorts?.map((p: any) => p.id));
          const removedHandleIds = new Set([...oldIds].filter(id => !newIds.has(id)));
          if (removedHandleIds.size > 0) {
            nextEdges = nextEdges.filter(e => !(e.target === nodeId && e.targetHandle && removedHandleIds.has(e.targetHandle)));
          }
        }

        const updatedNodes = prev.nodes.map(n => {
          if (n.id === nodeId) {
            const updatedData: any = { ...n.data, [fieldKey]: value };
            if (resolvedAgentName !== undefined) updatedData.agentName = resolvedAgentName;
            if (resolvedWorkspacePath !== undefined) updatedData.workspacePath = resolvedWorkspacePath;
            return { ...n, data: updatedData };
          }
          return n;
        });
        const updated = { ...prev, nodes: updatedNodes, edges: nextEdges };
        saveWorkflow(updated);
        return updated;
      });
      setFlowNodes(prev => prev.map(n => {
        if (n.id === nodeId) {
          const updatedData: any = { ...n.data, [fieldKey]: value };
          if (resolvedAgentName !== undefined) updatedData.agentName = resolvedAgentName;
          if (resolvedWorkspacePath !== undefined) updatedData.workspacePath = resolvedWorkspacePath;
          return { ...n, data: updatedData };
        }
        return n;
      }));
      setFlowEdges(prev => {
        const node = workflow.nodes.find(n => n.id === nodeId);
        let nextEdges = [...workflow.edges];
        if (fieldKey === 'rules' && node) {
          const oldRules = (node.data as any).rules as any[] | undefined;
          const newRules = value as any[];
          const oldCount = Array.isArray(oldRules) ? oldRules.length : 0;
          const newCount = Array.isArray(newRules) ? newRules.length : 0;
          if (newCount < oldCount) {
            const removedHandleIds = new Set<string>();
            for (let i = newCount; i < oldCount; i++) removedHandleIds.add(`output-${i}`);
            nextEdges = nextEdges.filter(e => !(e.source === nodeId && e.sourceHandle && removedHandleIds.has(e.sourceHandle)));
          }
        }
        if (fieldKey === 'branchCount' && node) {
          const oldCount = (node.data as any).branchCount as number || 2;
          const newCount = Number(value) || 2;
          if (newCount < oldCount) {
            const removedHandleIds = new Set<string>();
            for (let i = newCount; i < oldCount; i++) removedHandleIds.add(`fork-${i}`);
            nextEdges = nextEdges.filter(e => !(e.source === nodeId && e.sourceHandle && removedHandleIds.has(e.sourceHandle)));
          }
        }
        if (fieldKey === 'inputPorts' && node) {
          const oldPorts = ((node.data as any).inputPorts) as any[] | undefined;
          const newPorts = value as any[];
          const oldIds = new Set(oldPorts?.map((p: any) => p.id));
          const newIds = new Set(newPorts?.map((p: any) => p.id));
          const removedHandleIds = new Set([...oldIds].filter(id => !newIds.has(id)));
          if (removedHandleIds.size > 0) {
            nextEdges = nextEdges.filter(e => !(e.target === nodeId && e.targetHandle && removedHandleIds.has(e.targetHandle)));
          }
        }
        return prev.filter(e => nextEdges.some(ne => ne.id === e.id));
      });
      setConfigPanel(prev => {
        if (!prev) return null;
        const updatedData: any = { ...prev.data, [fieldKey]: value };
        if (resolvedAgentName !== undefined) updatedData.agentName = resolvedAgentName;
        if (resolvedWorkspacePath !== undefined) updatedData.workspacePath = resolvedWorkspacePath;
        return { ...prev, data: updatedData };
      });
    } else if (configPanel.type === 'edge' && configPanel.edgeId) {
      const edgeId = configPanel.edgeId;
      setWorkflow(prev => {
        const updatedEdges = prev.edges.map(e => {
          if (e.id === edgeId) {
            return { ...e, arrowConfig: { ...e.arrowConfig, [fieldKey]: value, extractField: fieldKey === 'extractField' ? (value || null) : (e.arrowConfig?.extractField || null), contextMode: fieldKey === 'contextMode' ? value : (e.arrowConfig?.contextMode ?? true), injectRole: fieldKey === 'injectRole' ? value : (e.arrowConfig?.injectRole ?? false) } };
          }
          return e;
        });
        const updated = { ...prev, edges: updatedEdges };
        saveWorkflow(updated);
        return updated;
      });
      setFlowEdges(prev => prev.map(e => {
        if (e.id === edgeId) {
          const arrowConfig = { ...(e.data as any)?.arrowConfig, [fieldKey]: value, extractField: fieldKey === 'extractField' ? (value || null) : ((e.data as any)?.arrowConfig?.extractField || null), contextMode: fieldKey === 'contextMode' ? value : ((e.data as any)?.arrowConfig?.contextMode ?? true), injectRole: fieldKey === 'injectRole' ? value : ((e.data as any)?.arrowConfig?.injectRole ?? false) };
          return { ...e, data: { ...e.data, arrowConfig } };
        }
        return e;
      }));
      setConfigPanel(prev => prev ? { ...prev, data: { ...prev.data, [fieldKey]: value } } : null);
    }
  }, [configPanel, workflow, agents]);

  const NODE_PALETTE: Array<{ type: SandboxNodeType; label: string; icon: string }> = [
    { type: 'entry', label: '入口', icon: '⬇' },
    { type: 'agent', label: 'AI Agent', icon: '🤖' },
    { type: 'condition', label: '条件分支', icon: '◇' },
    { type: 'loop-while', label: '条件循环', icon: '↻' },
    { type: 'merge', label: '合并', icon: '⊕' },
    { type: 'fork', label: '分叉', icon: '⑂' },
    { type: 'variable', label: '变量', icon: '📦' },
    { type: 'human-gate', label: '人工确认', icon: '👤' },
    { type: 'error-handler', label: '错误处理', icon: '⚠' },
    { type: 'output', label: '输出', icon: '💾' },
    { type: 'subflow', label: '子流程', icon: '📋' },
  ];

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: '复制节点',
        action: () => {
          if (!workflow) return;
          const src = workflow.nodes.find(n => n.id === node.id);
          if (!src) return;
          const newId = genNodeId(src.type);
          const newNode: SandboxNode = {
            id: newId,
            type: src.type,
            position: { x: src.position.x + 50, y: src.position.y + 50 },
            data: JSON.parse(JSON.stringify(src.data)),
          };
          const updated = { ...workflow, nodes: [...workflow.nodes, newNode] };
          setWorkflow(updated);
          saveWorkflow(updated);
          setFlowNodes(prev => [...prev, { id: newId, type: src.type, position: newNode.position, data: newNode.data }]);
        },
      },
      { label: '上移一层', action: () => {
        setManualZIndex(prev => {
          const allZ = Object.values(prev).filter(v => v < 20);
          const maxZ = allZ.length > 0 ? Math.max(...allZ) : 10;
          return { ...prev, [node.id]: maxZ + 1 };
        });
      }},
      { label: '下移一层', action: () => {
        setManualZIndex(prev => ({
          ...prev,
          [node.id]: Math.max(1, (prev[node.id] ?? 10) - 1),
        }));
      }},
      { label: '重置层级', action: () => {
        setManualZIndex(prev => {
          const next = { ...prev };
          delete next[node.id];
          return next;
        });
      }},
      { divider: true },
      { label: '删除节点', danger: true, action: () => {
        if (!workflow || !window.confirm('确定删除此节点？')) return;
        const updated = { ...workflow, nodes: workflow.nodes.filter(n => n.id !== node.id), edges: workflow.edges.filter(e => e.source !== node.id && e.target !== node.id) };
        setWorkflow(updated);
        saveWorkflow(updated);
        setFlowNodes(prev => prev.filter(n => n.id !== node.id));
        setFlowEdges(prev => prev.filter(e => e.source !== node.id && e.target !== node.id));
      }},
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [workflow]);

  const handlePaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const nodePaletteItems: ContextMenuItem[] = [
      ...NODE_PALETTE.map(n => ({
        label: `${n.icon} ${n.label}`,
        action: () => {
          if (!workflow) return;
          const flowEl = document.querySelector('.react-flow');
          if (flowEl) {
            const rect = flowEl.getBoundingClientRect();
            onDrop(n.type, { x: e.clientX - rect.left - 100, y: e.clientY - rect.top - 30 });
          }
        },
      })),
      ...customPalette.map(n => ({
        label: `⚙ ${n.label}`,
        action: () => {
          if (!workflow) return;
          const flowEl = document.querySelector('.react-flow');
          if (flowEl) {
            const rect = flowEl.getBoundingClientRect();
            onDrop(n.type as SandboxNodeType, { x: e.clientX - rect.left - 100, y: e.clientY - rect.top - 30 });
          }
        },
      })),
    ];

    const items: ContextMenuItem[] = [
      { label: '添加节点', children: nodePaletteItems },
      { label: '添加 Group', action: () => {
        if (!workflow) return;
        const id = genNodeId('group');
        const newNode: SandboxNode = { id, type: 'group', position: { x: 200, y: 200 }, style: { width: 300, height: 200 }, data: { label: '组' } as any };
        const updated = { ...workflow, nodes: [...workflow.nodes, newNode] };
        setWorkflow(updated);
        saveWorkflow(updated);
        setFlowNodes(prev => [...prev, { id, type: 'group', position: newNode.position, style: newNode.style, data: newNode.data }]);
      }},
      { label: '添加 Note', action: () => {
        if (!workflow) return;
        const id = genNodeId('note');
        const newNode: SandboxNode = { id, type: 'note', position: { x: 200, y: 200 }, style: { width: 180, height: 100 }, data: { label: '备注', content: '' } as any };
        const updated = { ...workflow, nodes: [...workflow.nodes, newNode] };
        setWorkflow(updated);
        saveWorkflow(updated);
        setFlowNodes(prev => [...prev, { id, type: 'note', position: newNode.position, style: newNode.style, data: newNode.data }]);
      }},
      { divider: true },
      { label: '保存工作流', action: () => { if (workflow) saveWorkflow(workflow); } },
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [workflow, customPalette]);

  const handleEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: '配置箭头',
        action: () => setConfigPanel({
          type: 'edge',
          edgeId: edge.id,
          data: edge.data?.arrowConfig || {},
          schema: ARROW_CONFIG_SCHEMA,
        }),
      },
      { label: '删除连线', danger: true, action: () => {
        if (!workflow) return;
        const updated = { ...workflow, edges: workflow.edges.filter(ed => ed.id !== edge.id) };
        setWorkflow(updated);
        saveWorkflow(updated);
        setFlowEdges(prev => prev.filter(e => e.id !== edge.id));
      }},
    ];
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }, [workflow]);

  const handleToggleAgent = useCallback(async (agentId: string) => {
    if (!workflow) return;
    const isActive = workflow.activeAgentIds.includes(agentId);
    const nextIds = isActive
      ? workflow.activeAgentIds.filter(id => id !== agentId)
      : [...workflow.activeAgentIds, agentId];
    const updated = { ...workflow, activeAgentIds: nextIds };
    setWorkflow(updated);
    await saveWorkflow(updated);
    // Lock/unlock agent status
    try {
      await setAgentStatus(agentId, isActive ? 'idle' : 'sandbox');
    } catch { /* ok */ }
  }, [workflow]);

  const handleRun = useCallback(async () => {
    if (!workflow) return;
    if (execStatus === 'running') return;

    const validationErrors = validateWorkflow(workflow);
    if (validationErrors.length > 0) {
      alert(`工作流校验失败:\n${validationErrors.join('\n')}`);
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    setExecStatus('running');
    setLogs([]);

    const ctx: ExecContext = {
      signal: abortController.signal,
      flowId: workflow.id,
      flowName: workflow.name,
      onLog: (log) => setLogs(prev => [...prev, log]),
      onNodeStatus: (nodeId, status) => {
        setNodeExecStatus(prev => ({ ...prev, [nodeId]: status }));
        // Also update the flow node data
        setFlowNodes(prev => prev.map(n =>
          n.id === nodeId ? { ...n, data: { ...n.data, execStatus: status } } : n
        ));
      },
      onPause: async (payload) => {
        return new Promise<Envelope>((resolve) => {
          humanGateResolve.current = resolve;
          setHumanGate(payload);
        });
      },
    };

    const state = (await getExecutionState(workflow.name)) || createInitialExecutionState();

    try {
      const result = await executeWorkflow(workflow, state, ctx);
      setExecStatus(result.status);
      await saveExecutionState(workflow.name, result);
      setLogs(result.logs);
    } catch (err) {
      setExecStatus('error');
      setLogs(prev => [...prev, {
        timestamp: new Date().toISOString(),
        nodeId: '',
        nodeName: '系统',
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
      }]);
    }
  }, [workflow, execStatus]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setExecStatus('idle');
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    setIsDragOver(false);
    setImportMessage(null);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    const jsonFile = files.find(f => f.name.endsWith('.json'));
    if (!jsonFile) {
      setImportMessage('请拖入 .json 格式的工作流文件');
      return;
    }

    try {
      const text = await jsonFile.text();
      const wf = await importWorkflow(text);
      setWorkflow(wf);
      syncToFlow(wf);
      setImportMessage(`已导入工作流 "${wf.name}"`);
      setTimeout(() => setImportMessage(null), 3000);
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : '导入失败');
    }
  }, [syncToFlow]);

  const handleHumanGateContinue = useCallback((envelope: Envelope) => {
    setHumanGate(null);
    humanGateResolve.current?.(envelope);
    humanGateResolve.current = null;
  }, []);

  const handleHumanGateTerminate = useCallback(() => {
    setHumanGate(null);
    abortRef.current?.abort();
    setExecStatus('idle');
  }, []);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <SandboxSidebar
        activeWorkflowId={workflow?.id || null}
        onSelectWorkflow={handleSelectWorkflow}
        onNewWorkflow={handleNewWorkflow}
        activeAgentIds={workflow?.activeAgentIds || []}
        onToggleAgent={handleToggleAgent}
        customPalette={customPalette}
      />

      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 100,
            background: 'rgba(37, 99, 235, 0.15)',
            border: '3px dashed var(--color-accent)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid var(--glass-border)',
              padding: 'var(--space-6)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
              textAlign: 'center',
              color: 'var(--color-text)',
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--font-semibold)',
            }}>
              释放以导入工作流
            </div>
          </div>
        )}
        {importMessage && !isDragOver && (
          <div style={{
            position: 'absolute',
            top: 'var(--space-3)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: importMessage.startsWith('已导入') ? 'var(--color-success)' : 'var(--color-error)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--font-medium)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
          }}>
            {importMessage}
          </div>
        )}
        {/* Toolbar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-2) var(--space-4)',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--color-bg-secondary)',
          flexShrink: 0,
        }}>
          <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
            {workflow?.name || '未选择工作流'}
          </span>
          <span style={{
            fontSize: '10px',
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: execStatus === 'running' ? 'var(--color-sandbox-orange)' :
                        execStatus === 'finished' ? 'var(--color-success)' :
                        execStatus === 'error' ? 'var(--color-error)' :
                        execStatus === 'paused' ? 'var(--color-warning)' :
                        'var(--color-bg)',
            color: execStatus === 'idle' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
            border: '1px solid var(--border-color)',
          }}>
            {execStatus === 'running' ? '运行中' :
             execStatus === 'finished' ? '已完成' :
             execStatus === 'error' ? '错误' :
             execStatus === 'paused' ? '暂停' : '就绪'}
          </span>
          <div style={{ flex: 1 }} />
          {execStatus === 'running' ? (
            <button className="sandbox-btn" onClick={handleStop}
              style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>
              停止
            </button>
          ) : (
            <button className="sandbox-btn sandbox-btn-run" onClick={handleRun}
              disabled={!workflow || workflow.nodes.length === 0}>
              执行 ▶
            </button>
          )}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <FlowCanvas
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={handleEdgeClick}
            onDrop={onDrop}
            activeAgentIds={workflow?.activeAgentIds || []}
            nodeExecStatus={nodeExecStatus}
            manualZIndex={manualZIndex}
            onNodeContextMenu={handleNodeContextMenu}
            onPaneContextMenu={handlePaneContextMenu}
            onEdgeContextMenu={handleEdgeContextMenu}
            onNodeClick={handleNodeClick}
            customNodeTypes={customTypes}
          />
        </div>

        {/* Logs panel */}
        {logs.length > 0 && (
          <div style={{
            height: '180px',
            borderTop: '1px solid var(--glass-border)',
            overflow: 'auto',
            padding: 'var(--space-3)',
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            flexShrink: 0,
          }}>
            <div className="sandbox-sidebar-label" style={{ marginBottom: 'var(--space-2)' }}>
              执行日志
            </div>
            {logs.map((log, i) => (
              <div key={i} style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                padding: '2px 0',
                color: log.level === 'error' ? 'var(--color-error)' :
                       log.level === 'warn' ? 'var(--color-warning)' :
                       'var(--color-text-tertiary)',
              }}>
                <span style={{ opacity: 0.5 }}>{log.timestamp.slice(11, 19)}</span>{' '}
                {log.nodeName && <><span style={{ color: 'var(--color-accent)' }}>[{log.nodeName}]</span> </>}
                {log.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Config Panel (slide-out) */}
      {configPanel && (
        <>
          <div className="config-panel-overlay" onClick={() => setConfigPanel(null)} />
          <div className="config-panel" onKeyDown={e => e.key === 'Escape' && setConfigPanel(null)}>
            <div className="config-panel-header">
              <h3>{configPanel.type === 'node' ? '节点配置' : '箭头配置'}</h3>
              <button className="config-panel-close" onClick={() => setConfigPanel(null)}>✕</button>
            </div>
            <div className="config-panel-body">
              {configPanel.schema?.map(field => {
                const value = configPanel.data?.[field.key];
                const id = `field-${configPanel.nodeId || configPanel.edgeId}-${field.key}`;
                return (
                  <div className="config-field" key={field.key}>
                    <label className="config-field-label" htmlFor={id}>{field.label}</label>
                    {field.type === 'text' && field.key !== 'workspacePath' && (
                      <input id={id} className="config-field-input" value={value ?? ''} placeholder={field.placeholder} onChange={e => handleConfigFieldChange(field.key, e.target.value)} />
                    )}
                    {field.key === 'workspacePath' && (
                      <input id={id} className="config-field-input" type="text" value={value ?? ''} readOnly style={{ background: 'var(--color-bg-tertiary)', opacity: 0.7, cursor: 'not-allowed' }} />
                    )}
                    {field.type === 'number' && (
                      <input id={id} className="config-field-input" type="number" min={field.min} max={field.max} value={value ?? field.default ?? ''} onChange={e => handleConfigFieldChange(field.key, Number(e.target.value))} />
                    )}
                    {field.type === 'textarea' && (
                      <textarea id={id} className="config-field-textarea" rows={field.rows || 3} value={value ?? ''} placeholder={field.placeholder} onChange={e => handleConfigFieldChange(field.key, e.target.value)} />
                    )}
                    {field.type === 'select' && field.key === 'agentId' && (
                      <select id={id} className="config-field-select" value={value ?? ''} onChange={e => {
                        handleConfigFieldChange(field.key, e.target.value);
                      }}>
                        <option value="">-- 未选择 --</option>
                        {agents
                          .filter(a => (workflow?.activeAgentIds || []).includes(a.id))
                          .map(a => <option key={a.id} value={a.id}>{a.name} ({a.model})</option>)}
                      </select>
                    )}
                    {field.type === 'select' && field.key !== 'agentId' && (
                      <select id={id} className="config-field-select" value={value ?? field.default ?? ''} onChange={e => handleConfigFieldChange(field.key, e.target.value)}>
                        {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    )}
                    {field.type === 'toggle' && (
                      <label className="config-field-toggle">
                        <input id={id} type="checkbox" checked={value ?? field.default ?? false} onChange={e => handleConfigFieldChange(field.key, e.target.checked)} />
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{field.label}</span>
                      </label>
                    )}
                    {field.type === 'json' && (
                      <textarea id={id} className="config-field-textarea" rows={6} value={typeof value === 'object' ? JSON.stringify(value, null, 2) : (value || '')} placeholder={field.placeholder} onChange={e => {
                        try { handleConfigFieldChange(field.key, JSON.parse(e.target.value)); } catch { handleConfigFieldChange(field.key, e.target.value); }
                      }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items} onClose={() => setContextMenu(null)} />
      )}

      {/* Human gate dialog */}
      {humanGate && (
        <HumanGateDialog
          nodeName={humanGate.nodeName}
          envelope={humanGate.envelope}
          prompt={humanGate.prompt}
          onContinue={handleHumanGateContinue}
          onTerminate={handleHumanGateTerminate}
        />
      )}
    </div>
  );
}
