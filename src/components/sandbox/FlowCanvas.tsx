import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  MarkerType,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { SandboxNode, SandboxEdge, SandboxNodeType, ArrowConfig } from '../../types/sandbox';
import EntryNode from './nodes/EntryNode';
import AgentNode from './nodes/AgentNode';
import ConditionNode from './nodes/ConditionNode';
import LoopNode from './nodes/LoopNode';
import MergeNode from './nodes/MergeNode';
import ForkNode from './nodes/ForkNode';
import VariableNode from './nodes/VariableNode';
import HumanGateNode from './nodes/HumanGateNode';
import ErrorHandlerNode from './nodes/ErrorHandlerNode';
import OutputNode from './nodes/OutputNode';
import GroupNode from './nodes/GroupNode';
import NoteNode from './nodes/NoteNode';

const nodeTypes = {
  entry: EntryNode,
  agent: AgentNode,
  condition: ConditionNode,
  'loop-while': LoopNode,
  merge: MergeNode,
  fork: ForkNode,
  variable: VariableNode,
  'human-gate': HumanGateNode,
  'error-handler': ErrorHandlerNode,
  output: OutputNode,
  group: GroupNode,
  note: NoteNode,
};

interface Props {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onEdgeClick: (edgeId: string) => void;
  onDrop: (type: SandboxNodeType, position: { x: number; y: number }) => void;
  activeAgentIds: string[];
  nodeExecStatus: Record<string, string>;
  manualZIndex?: Record<string, number>;
  onNodeContextMenu: (e: React.MouseEvent, node: Node) => void;
  onPaneContextMenu: (e: React.MouseEvent) => void;
  onEdgeContextMenu: (e: React.MouseEvent, edge: Edge) => void;
  onNodeClick: (e: React.MouseEvent, node: Node) => void;
  onNodeDoubleClick?: (node: Node) => void;
  customNodeTypes?: Record<string, any>;
}

export default function FlowCanvas({
  nodes, edges, onNodesChange, onEdgesChange, onConnect,
  onEdgeClick, onDrop, activeAgentIds, nodeExecStatus, manualZIndex,
  onNodeContextMenu, onPaneContextMenu, onEdgeContextMenu, onNodeClick,
  onNodeDoubleClick, customNodeTypes,
}: Props) {
  const mergedNodeTypes = useMemo(() => ({ ...nodeTypes, ...customNodeTypes }), [customNodeTypes]);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  const zNodes = useMemo(() => nodes.map(n => {
    if (manualZIndex && manualZIndex[n.id] !== undefined) return { ...n, zIndex: manualZIndex[n.id] };
    if (nodeExecStatus[n.id] === 'running') return { ...n, zIndex: 20 };
    if (n.type === 'group') return { ...n, zIndex: 0 };
    if (n.type === 'note') return { ...n, zIndex: 1 };
    return { ...n, zIndex: 10 };
  }), [nodes, nodeExecStatus, manualZIndex]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDropEvt = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!reactFlowWrapper.current || !reactFlowInstance) return;
      const type = e.dataTransfer.getData('application/sandbox-node-type') as SandboxNodeType;
      if (!type) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });
      onDrop(type, position);
    },
    [reactFlowInstance, onDrop],
  );

  return (
    <div ref={reactFlowWrapper} style={{ flex: 1, height: '100%' }} onContextMenu={e => e.preventDefault()}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={zNodes}
          edges={edges.map(e => ({
            ...e,
            style: { stroke: 'var(--color-text-tertiary)', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--color-text-tertiary)' },
          }))}
          nodeTypes={mergedNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDragOver={handleDragOver}
          onDrop={handleDropEvt}
          onEdgeClick={(_e: React.MouseEvent, edge: Edge) => onEdgeClick(edge.id)}
          onNodeContextMenu={(e: React.MouseEvent, node: Node) => onNodeContextMenu(e, node)}
          onPaneContextMenu={(e: React.MouseEvent) => onPaneContextMenu(e)}
          onEdgeContextMenu={(e: React.MouseEvent, edge: Edge) => onEdgeContextMenu(e, edge)}
          onNodeClick={(e: React.MouseEvent, node: Node) => onNodeClick(e, node)}
          onNodeDoubleClick={(_e: React.MouseEvent, node: Node) => onNodeDoubleClick?.(node)}
          fitView
          deleteKeyCode={['Backspace', 'Delete']}
          snapToGrid
          snapGrid={[20, 20]}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-color)" />
          <Controls style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }} />
          <MiniMap
            nodeColor={(n) => {
              const status = nodeExecStatus[n.id];
              if (status === 'running') return '#3b82f6';
              if (status === 'done') return '#22c55e';
              if (status === 'error') return '#ef4444';
              if (n.type === 'entry') return '#6b7280';
              if (n.type === 'agent') return '#7c3aed';
              return 'var(--color-bg-secondary)';
            }}
            style={{ background: 'var(--color-bg)' }}
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
