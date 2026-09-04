import type { NodeChange } from '@xyflow/react';
import type { EditableOrganization, OrganizationPoint } from './organization-types';

export function applyOrganizationNodePositions(
  draft: EditableOrganization,
  changes: NodeChange[],
): EditableOrganization {
  let next = draft;
  for (const change of changes) {
    if (change.type !== 'position' || !change.position) continue;
    const group = next.groups.find(item => item.id === change.id);
    next = group
      ? moveGroup(next, group.id, group.seatIds, group.position, change.position)
      : moveSeat(next, change.id, change.position);
  }
  return next;
}

function moveSeat(
  draft: EditableOrganization, seatId: string, position: OrganizationPoint,
): EditableOrganization {
  const current = draft.seatPositions[seatId];
  if (current && samePoint(current, position)) return draft;
  return { ...draft, seatPositions: { ...draft.seatPositions, [seatId]: position } };
}

function moveGroup(
  draft: EditableOrganization,
  groupId: string,
  seatIds: string[],
  current: OrganizationPoint,
  position: OrganizationPoint,
): EditableOrganization {
  if (samePoint(current, position)) return draft;
  const dx = position.x - current.x;
  const dy = position.y - current.y;
  const seatPositions = { ...draft.seatPositions };
  for (const seatId of seatIds) {
    const point = seatPositions[seatId];
    if (point) seatPositions[seatId] = { x: point.x + dx, y: point.y + dy };
  }
  return {
    ...draft,
    seatPositions,
    groups: draft.groups.map(group => group.id === groupId ? { ...group, position } : group),
  };
}

function samePoint(left: OrganizationPoint, right: OrganizationPoint): boolean {
  return left.x === right.x && left.y === right.y;
}
