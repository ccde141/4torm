import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, ConnectionMode, Controls, MarkerType, MiniMap, ReactFlow,
  type Connection, type Edge, type EdgeTypes, type Node, type NodeTypes,
  type OnNodesChange, type ReactFlowInstance, useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useLocale } from '../../../i18n/LocaleContext';
import {
  addGroup, assignSeatAndCleanRelations, createExternalRelation, reconcileOrganizationSeats,
  removeGroup, validateExternalRelation,
} from './organization-model';
import type { EditableOrganization, OrganizationSeat } from './organization-types';
import type { WorkspaceEntityStatus } from '../pages/cyclone-workspace-status';
import { CollaborationEdge, type CollaborationEdgeData } from './CollaborationEdge';
import { OrganizationInspector, type OrganizationSelection } from './OrganizationInspector';
import { relationHandles } from './relation-handles';
import { SeatNode, type SeatNodeData } from './SeatNode';
import { WorkGroupNode, type WorkGroupNodeData } from './WorkGroupNode';
import './organization.css';
import type { Agent } from '../../../types';
import { OrganizationContextMenu } from './OrganizationContextMenu';
import {
  closeOrganizationMenu, openOrganizationMenu, type OrganizationMenuKind,
} from './organization-context-menu';
import { findContainingGroup } from './organization-geometry';
import {
  applyOrganizationCanvasNodeChanges, commitOrganizationNodePositions,
  reconcileOrganizationCanvasNodes,
} from './organization-canvas-state';

const nodeTypes: NodeTypes = { seat: SeatNode, group: WorkGroupNode };
const edgeTypes: EdgeTypes = { collaboration: CollaborationEdge };
interface Props {
  draft: EditableOrganization;
  seats: OrganizationSeat[];
  agents: Agent[];
  seatStatuses: Map<string, WorkspaceEntityStatus>;
  completedSignals: Record<string, number>;
  activeDispatchPairs: Set<string>;
  activeContactPairs: Set<string>;
  contactReturnSignals: Record<string, number>;
  saving?: boolean;
  saveState: 'unsaved' | 'saving' | 'saved';
  error?: string;
  onRetrySync?(): void;
  onChange(next: EditableOrganization): void;
  onSave(): void;
  onOpenSeat(seatId: string): void;
  onError(message: string): void;
}

export function CycloneOrganizationCanvas(props: Props) {
  const { t } = useLocale();
  const {
    draft, seats, agents, seatStatuses, completedSignals, activeDispatchPairs, activeContactPairs,
    contactReturnSignals, onChange, onOpenSeat, onError,
  } = props;
  const [selection, setSelection] = useState<OrganizationSelection>(null);
  const [menu, setMenu] = useState(closeOrganizationMenu);
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragBaseRef = useRef(draft);
  const labels = useMemo(() => ({
    seat: t('cyclone.org.seat'), running: t('cyclone.org.running'),
    waiting: t('cyclone.org.waiting'), failed: t('cyclone.org.failed'), unread: t('cyclone.org.unread'),
    idle: t('cyclone.org.idle'), openChat: t('cyclone.org.openChat'),
  }), [t]);
  const layoutDraft = useMemo(
    () => reconcileOrganizationSeats(draft, seats),
    [draft, seats],
  );
  const projectedNodes = useMemo<Node[]>(() => [
    ...draft.groups.map(group => ({
      id: group.id, type: 'group', position: group.position,
      style: { width: group.size?.width ?? 320, height: group.size?.height ?? 240 },
      zIndex: -1, selectable: true, connectable: false,
      data: {
        title: group.title, memberCount: group.seatIds.length,
        seatCountLabel: t('cyclone.org.seatCount', { count: group.seatIds.length }),
        onResize: (width: number, height: number) => onChange({
          ...draft, groups: draft.groups.map(item => item.id === group.id ? { ...item, size: { width, height } } : item),
        }),
      } satisfies WorkGroupNodeData,
    })),
    ...seats.map(seat => ({
      id: seat.id, type: 'seat', position: layoutDraft.seatPositions[seat.id], zIndex: 2,
      data: { title: seat.title, duty: seat.duty, agent: agents.find(agent => agent.id === seat.agentId),
        status: seatStatuses.get(seat.id) ?? 'idle',
        completedSignal: completedSignals[seat.id] ?? 0, labels, onOpen: () => onOpenSeat(seat.id) } satisfies SeatNodeData,
    })),
  ], [agents, completedSignals, draft, labels, layoutDraft.seatPositions,
    onChange, onOpenSeat, seats, seatStatuses, t]);
  const [nodes, setNodes] = useNodesState(projectedNodes);
  useEffect(() => {
    if (draggingRef.current) return;
    setNodes(current => reconcileOrganizationCanvasNodes(current, projectedNodes));
  }, [projectedNodes, setNodes]);
  const canvasSeatPositions = useMemo(() => Object.fromEntries(nodes
    .filter(node => node.type === 'seat')
    .map(node => [node.id, node.position])), [nodes]);
  const edges = useMemo<Edge[]>(() => {
    const permanentPairs = new Set<string>();
    const result: Edge[] = draft.externalRelations.map(relation => {
      const pair = `${relation.sourceSeatId}:${relation.targetSeatId}`;
      const handles = relationHandles(
        canvasSeatPositions[relation.sourceSeatId] ?? draft.seatPositions[relation.sourceSeatId],
        canvasSeatPositions[relation.targetSeatId] ?? draft.seatPositions[relation.targetSeatId],
      );
      permanentPairs.add(pair);
      return { id: relation.id, source: relation.sourceSeatId, target: relation.targetSeatId,
        ...handles,
        type: 'collaboration',
        ...(relation.direction === 'forward' ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
        data: { direction: relation.direction,
          dispatchActive: activeDispatchPairs.has(pair), contactActive: activeContactPairs.has(pair),
          returnSignal: contactReturnSignals[pair] ?? 0 } satisfies CollaborationEdgeData };
    });
    const transientPairs = new Set([
      ...activeDispatchPairs, ...activeContactPairs, ...Object.keys(contactReturnSignals),
    ]);
    for (const pair of transientPairs) {
      if (permanentPairs.has(pair)) continue;
      const separator = pair.indexOf(':');
      const source = pair.slice(0, separator); const target = pair.slice(separator + 1);
      if (!source || !target) continue;
      const handles = relationHandles(
        canvasSeatPositions[source] ?? draft.seatPositions[source],
        canvasSeatPositions[target] ?? draft.seatPositions[target],
      );
      result.push({ id: `activity-${pair}`, source, target, type: 'collaboration', selectable: false,
        ...handles,
        markerEnd: { type: MarkerType.ArrowClosed }, data: {
          direction: 'forward',
          dispatchActive: activeDispatchPairs.has(pair), contactActive: activeContactPairs.has(pair),
          returnSignal: contactReturnSignals[pair] ?? 0,
        } satisfies CollaborationEdgeData });
    }
    return result;
  }, [activeContactPairs, activeDispatchPairs, canvasSeatPositions, contactReturnSignals,
    draft.externalRelations, draft.seatPositions]);

  const commitNodeDrag = useCallback((node: Node) => {
    const finalChange = { id: node.id, type: 'position' as const, position: node.position, dragging: false };
    const baseDraft = dragBaseRef.current;
    const snapshot = applyOrganizationCanvasNodeChanges(
      flowRef.current?.getNodes() ?? nodes, [finalChange], baseDraft,
    );
    draggingRef.current = false;
    setNodes(snapshot);
    let nextDraft = commitOrganizationNodePositions(baseDraft, snapshot);
    if (node.type === 'seat') {
      const targetGroup = findContainingGroup(nextDraft.groups, node.position, {
        width: node.measured?.width ?? 210,
        height: node.measured?.height ?? 110,
      });
      nextDraft = assignSeatAndCleanRelations(nextDraft, node.id, targetGroup?.id ?? null);
    }
    if (nextDraft !== baseDraft) onChange(nextDraft);
  }, [nodes, onChange, setNodes]);

  const handleNodesChange: OnNodesChange = useCallback(changes => {
    setNodes(current => applyOrganizationCanvasNodeChanges(current, changes, dragBaseRef.current));
  }, [setNodes]);

  const connect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    try {
      onChange({ ...draft, externalRelations: createExternalRelation(
        draft.externalRelations, draft.groups, connection.source, connection.target,
      ) });
    } catch (error) { onError((error as Error).message); }
  }, [draft, onChange, onError]);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target) return false;
    return validateExternalRelation(
      draft.externalRelations, draft.groups, connection.source, connection.target,
    ) === null;
  }, [draft.externalRelations, draft.groups]);

  const menuPosition = useCallback((event: React.MouseEvent | MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }, []);
  const openMenu = useCallback((event: React.MouseEvent | MouseEvent, kind: OrganizationMenuKind,
    id: string | null = null) => {
    event.preventDefault();
    const position = menuPosition(event);
    const flowPosition = kind === 'pane'
      ? flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? null
      : null;
    setMenu(openOrganizationMenu(kind, position.x, position.y, id, flowPosition));
  }, [menuPosition]);
  const inspect = useCallback((kind: 'seat' | 'group' | 'relation', id: string) => {
    setSelection({ kind, id });
  }, []);
  const deleteGroup = useCallback((id: string) => {
    onChange({ ...draft, groups: removeGroup(draft.groups, id) }); setSelection(null);
  }, [draft, onChange]);
  const deleteRelation = useCallback((id: string) => {
    onChange({ ...draft, externalRelations: draft.externalRelations.filter(item => item.id !== id) });
    setSelection(null);
  }, [draft, onChange]);

  return <div className="cyclone-org" ref={canvasRef}>
    <div className="cyclone-org__toolbar">
      <button type="button" onClick={() => props.onChange({
        ...props.draft, groups: addGroup(props.draft.groups, props.draft.groups.length),
      })}>{t('cyclone.org.addGroup')}</button>
      <button type="button" onClick={props.onSave}
        disabled={props.saving || props.saveState === 'saved'}>{t('cyclone.org.save')}</button>
      <span className={`cyclone-org__save-state cyclone-org__save-state--${props.saveState}`}>
        {t(`cyclone.org.${props.saveState}`)}
      </span>
    </div>
    {props.draft.activatesExplicitMode && <div className="cyclone-org__mode">{t('cyclone.org.legacy')}</div>}
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodesChange={handleNodesChange}
      onNodeDragStart={() => { draggingRef.current = true; dragBaseRef.current = draft; }}
      onNodeDragStop={(_, node) => commitNodeDrag(node)}
      onConnect={connect} isValidConnection={isValidConnection} connectionMode={ConnectionMode.Loose}
      onNodeClick={(_, node) => setSelection({ kind: node.type === 'group' ? 'group' : 'seat', id: node.id })}
      onEdgeClick={(_, edge) => setSelection({ kind: 'relation', id: edge.id })}
      panOnDrag selectionKeyCode="Shift" deleteKeyCode={null} edgesReconnectable={false}
      onInit={instance => { flowRef.current = instance; }}
      onPaneContextMenu={event => openMenu(event, 'pane')}
      onNodeContextMenu={(event, node) => openMenu(event, node.type === 'group' ? 'group' : 'seat', node.id)}
      onEdgeContextMenu={(event, edge) => {
        if (draft.externalRelations.some(relation => relation.id === edge.id)) openMenu(event, 'relation', edge.id);
      }}
      onPaneClick={() => { setSelection(null); setMenu(closeOrganizationMenu()); }}
      fitView proOptions={{ hideAttribution: true }}>
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.04)" />
      <Controls showInteractive={false} className="cyclone-org__controls" />
      <MiniMap className="cyclone-org__minimap"
        nodeColor={node => node.type === 'seat' ? '#f59e0b' : '#334155'} maskColor="rgba(15,23,42,.8)" />
    </ReactFlow>
    <OrganizationContextMenu menu={menu} onClose={() => setMenu(closeOrganizationMenu())}
      onInspect={inspect} onOpenSeat={onOpenSeat}
      onAddGroup={position => onChange({ ...draft, groups: addGroup(draft.groups, draft.groups.length, position) })}
      onDeleteGroup={deleteGroup} onDeleteRelation={deleteRelation} />
    <OrganizationInspector draft={props.draft} seats={props.seats} selection={selection}
      onChange={props.onChange} onClear={() => setSelection(null)} />
    {props.error && <div className="cyclone-org__error" role="alert">
      <span>{props.error}</span>
      {props.onRetrySync && <button type="button" onClick={props.onRetrySync}>
        {t('cyclone.org.retrySync')}
      </button>}
    </div>}
  </div>;
}
