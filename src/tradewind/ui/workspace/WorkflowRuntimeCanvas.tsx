import { useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MarkerType } from '@xyflow/react';
import type { WorkflowRun } from './records/records-client';
import type { WorkflowNodeStatus } from '../hooks/useWorkflowNodeStatus';
import type { HandoffState } from '../../types/handoff';
import { TradeWindEdge } from '../canvas/edges/TradeWindEdge';
import type { ExecutionPhase } from '../hooks/execution-phase';
import { RuntimeWorkflowNode } from './RuntimeWorkflowNode';
import { WorkflowInitialViewport, type WorkflowViewportMemory } from '../canvas/WorkflowInitialViewport';

const types = { runtime: RuntimeWorkflowNode };
const edgeTypes = { tradewind: TradeWindEdge };
interface Props {
  run: WorkflowRun;
  nodes: Record<string, WorkflowNodeStatus>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  live: boolean;
  phase?: ExecutionPhase;
  handoff?: HandoffState;
  envelopeId?: string | null;
  viewports?: WorkflowViewportMemory;
}

/** An immutable run snapshot, independent of the graph being edited. */
export function WorkflowRuntimeCanvas(props: Props) {
  const nodes = useMemo(() => props.run.graph.nodes.map(node => ({
    id: node.id, type: 'runtime', position: node.position, width: node.width, height: node.height,
    selected: props.selectedId === node.id, data: { node, status: props.nodes[node.id],
      workflowId: props.run.workflowId, executionId: props.run.executionId, live: props.live, phase: props.phase,
      participantCount: node.type === 'meeting' && Array.isArray(node.config.participantNodeIds)
        ? node.config.participantNodeIds.filter(id => props.run.graph.nodes.some(item => item.id === id)).length : undefined,
      queue: props.handoff?.nodes.find(item => item.nodeId === node.id) },
  })), [props.run.graph, props.run.workflowId, props.run.executionId, props.nodes, props.selectedId, props.handoff, props.live, props.phase]);
  const edges = useMemo(() => props.run.graph.edges.map(edge => ({
    id: edge.id, source: edge.source, target: edge.target,
    type: 'tradewind', data: { kind: edge.kind, rework: edge.rework, orchestration: props.run.graph.orchestration },
    markerEnd: edge.kind !== 'note' ? { type: MarkerType.ArrowClosed } : undefined,
    animated: Boolean(props.nodes[edge.source]?.busy),
    style: { ...(edge.rework ? { strokeDasharray: '5 5' } : {}),
      ...(props.envelopeId && props.handoff?.lastHandoffs.some(item => item.envelopeId === props.envelopeId && item.edgeId === edge.id)
        ? { stroke: 'var(--color-accent)', strokeWidth: 2.5, opacity: 1 } : {}) },
  })), [props.run.graph, props.nodes, props.handoff, props.envelopeId]);
  return <div className="tw-runtime-canvas"><ReactFlowProvider><ReactFlow
    nodes={nodes} edges={edges} nodeTypes={types} edgeTypes={edgeTypes}
    nodesDraggable={false} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
    onNodeClick={(_, node) => props.onSelect(node.id)} onPaneClick={() => props.onSelect(null)}
    proOptions={{ hideAttribution: true }}>
    <WorkflowInitialViewport active workflowId={props.run.workflowId} memory={props.viewports} />
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,.05)" />
    <Controls showInteractive={false} className="tw-controls" />
  </ReactFlow></ReactFlowProvider></div>;
}
