import { applyNodeChanges, type Node, type NodeChange } from '@xyflow/react';
import { applyOrganizationNodePositions } from './organization-node-changes';
import type { EditableOrganization } from './organization-types';

export function applyOrganizationCanvasNodeChanges(
  nodes: Node[],
  changes: NodeChange[],
  baseDraft: EditableOrganization,
): Node[] {
  const changedNodes = applyNodeChanges(changes, nodes);
  const positionedDraft = applyOrganizationNodePositions(baseDraft, changes);
  if (positionedDraft === baseDraft) return changedNodes;
  return changedNodes.map(node => {
    const position = node.type === 'group'
      ? positionedDraft.groups.find(group => group.id === node.id)?.position
      : positionedDraft.seatPositions[node.id];
    return position ? { ...node, position } : node;
  });
}

export function reconcileOrganizationCanvasNodes(current: Node[], projected: Node[]): Node[] {
  const currentById = new Map(current.map(node => [node.id, node]));
  return projected.map(node => ({ ...currentById.get(node.id), ...node }));
}

export function commitOrganizationNodePositions(
  draft: EditableOrganization,
  nodes: Node[],
): EditableOrganization {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const groups = draft.groups.map(group => {
    const position = nodeById.get(group.id)?.position;
    return position && !samePoint(position, group.position) ? { ...group, position } : group;
  });
  const seatPositions = { ...draft.seatPositions };
  let changed = groups.some((group, index) => group !== draft.groups[index]);
  for (const seatId of Object.keys(seatPositions)) {
    const position = nodeById.get(seatId)?.position;
    if (position && !samePoint(position, seatPositions[seatId])) {
      seatPositions[seatId] = position; changed = true;
    }
  }
  return changed ? { ...draft, groups, seatPositions } : draft;
}

function samePoint(left: { x: number; y: number }, right: { x: number; y: number }): boolean {
  return left.x === right.x && left.y === right.y;
}
