import type {
  EditableOrganization,
  ExternalRelation,
  OrganizationPoint,
  OrganizationSeat,
  WorkGroup,
  WorkshopOrganizationState,
} from './organization-types.js';

export function defaultSeatPosition(index: number): OrganizationPoint {
  return { x: 80 + (index % 4) * 250, y: 90 + Math.floor(index / 4) * 160 };
}

function overlapsSeat(existing: OrganizationPoint, candidate: OrganizationPoint): boolean {
  return Math.abs(existing.x - candidate.x) < 230 && Math.abs(existing.y - candidate.y) < 130;
}

function availableSeatPosition(occupied: OrganizationPoint[], startIndex: number): OrganizationPoint {
  let index = startIndex;
  while (true) {
    const candidate = defaultSeatPosition(index);
    if (!occupied.some(position => overlapsSeat(position, candidate))) return candidate;
    index += 1;
  }
}

export function reconcileOrganizationSeats(
  draft: EditableOrganization,
  seats: OrganizationSeat[],
): EditableOrganization {
  const knownSeatIds = new Set(seats.map(seat => seat.id));
  const seatPositions = Object.fromEntries(
    Object.entries(draft.seatPositions).filter(([seatId]) => knownSeatIds.has(seatId)),
  );
  const occupied = Object.values(seatPositions);
  let changed = Object.keys(seatPositions).length !== Object.keys(draft.seatPositions).length;
  const groups = draft.groups.map(group => {
    const seatIds = group.seatIds.filter(seatId => knownSeatIds.has(seatId));
    if (seatIds.length === group.seatIds.length) return group;
    changed = true;
    return { ...group, seatIds };
  });
  const externalRelations = draft.externalRelations.filter(relation => (
    knownSeatIds.has(relation.sourceSeatId) && knownSeatIds.has(relation.targetSeatId)
  ));
  if (externalRelations.length !== draft.externalRelations.length) changed = true;
  seats.forEach((seat, index) => {
    if (seatPositions[seat.id]) return;
    const position = availableSeatPosition(occupied, index);
    seatPositions[seat.id] = position;
    occupied.push(position);
    changed = true;
  });
  return changed ? { ...draft, groups, externalRelations, seatPositions } : draft;
}

export function rebaseEditableOrganization(
  draft: EditableOrganization,
  state: WorkshopOrganizationState,
  seats: OrganizationSeat[],
): EditableOrganization {
  const reconciled = reconcileOrganizationSeats(draft, seats);
  return {
    ...reconciled,
    baseRevision: state.organization?.revision ?? 0,
    activatesExplicitMode: state.mode === 'legacy-full-mesh'
      ? reconciled.activatesExplicitMode
      : false,
  };
}

export function createEditableOrganization(
  state: WorkshopOrganizationState,
  seats: OrganizationSeat[],
): EditableOrganization {
  const organization = state.organization;
  const saved = organization?.seatPositions ?? {};
  return reconcileOrganizationSeats({
    baseRevision: organization?.revision ?? 0,
    activatesExplicitMode: state.mode === 'legacy-full-mesh',
    groups: organization?.groups.map(group => ({ ...group, seatIds: [...group.seatIds] })) ?? [],
    externalRelations: organization?.externalRelations.map(relation => ({ ...relation })) ?? [],
    seatPositions: Object.fromEntries(seats.flatMap(seat => (
      saved[seat.id] ? [[seat.id, saved[seat.id]]] : []
    ))),
  }, seats);
}

export function assignSeatToGroup(
  groups: WorkGroup[], seatId: string, groupId: string | null,
): WorkGroup[] {
  return groups.map(group => {
    const seatIds = group.seatIds.filter(id => id !== seatId);
    if (group.id === groupId) seatIds.push(seatId);
    return { ...group, seatIds };
  });
}

export function assignSeatAndCleanRelations(
  draft: EditableOrganization, seatId: string, groupId: string | null,
): EditableOrganization {
  const groups = assignSeatToGroup(draft.groups, seatId, groupId);
  const externalRelations = draft.externalRelations.filter(relation => {
    const sourceGroup = groupIdFor(groups, relation.sourceSeatId);
    return !sourceGroup || sourceGroup !== groupIdFor(groups, relation.targetSeatId);
  });
  return { ...draft, groups, externalRelations };
}

export function removeGroup(groups: WorkGroup[], groupId: string): WorkGroup[] {
  return groups.filter(group => group.id !== groupId);
}

function groupIdFor(groups: WorkGroup[], seatId: string): string | undefined {
  return groups.find(group => group.seatIds.includes(seatId))?.id;
}

export function createExternalRelation(
  relations: ExternalRelation[],
  groups: WorkGroup[],
  sourceSeatId: string,
  targetSeatId: string,
): ExternalRelation[] {
  const invalidReason = validateExternalRelation(relations, groups, sourceSeatId, targetSeatId);
  if (invalidReason) throw new Error(invalidReason);
  return [...relations, {
    id: `relation-${crypto.randomUUID()}`,
    sourceSeatId, targetSeatId, direction: 'both',
  }];
}

export function validateExternalRelation(
  relations: ExternalRelation[],
  groups: WorkGroup[],
  sourceSeatId: string,
  targetSeatId: string,
): string | null {
  if (sourceSeatId === targetSeatId) return '不能连接工位自身';
  const sourceGroup = groupIdFor(groups, sourceSeatId);
  if (sourceGroup && sourceGroup === groupIdFor(groups, targetSeatId)) {
    return '同组工位已由集合关系连接';
  }
  if (relations.some(item => (
    (item.sourceSeatId === sourceSeatId && item.targetSeatId === targetSeatId)
    || (item.sourceSeatId === targetSeatId && item.targetSeatId === sourceSeatId)
  ))) return '这两个工位的关系已经存在';
  return null;
}

export function reverseExternalRelation(relation: ExternalRelation): ExternalRelation {
  return {
    ...relation,
    sourceSeatId: relation.targetSeatId,
    targetSeatId: relation.sourceSeatId,
  };
}

export function addGroup(
  groups: WorkGroup[], index: number, position?: OrganizationPoint,
): WorkGroup[] {
  return [...groups, {
    id: `group-${crypto.randomUUID()}`,
    title: `协作组 ${index + 1}`,
    seatIds: [],
    position: position ?? { x: 40 + (index % 3) * 360, y: 40 + Math.floor(index / 3) * 300 },
    size: { width: 320, height: 240 },
  }];
}
