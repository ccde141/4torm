import { frameworkError } from '../../shared/framework-error.js';
import { loadSeat } from '../seat-store.js';
import { DEFAULT_DUTY, type SeatData } from '../types.js';
import { loadWorkshop } from '../workshop-store.js';
import { loadWorkshopOrganization } from './organization-store.js';
import type { WorkshopOrganization, WorkshopOrganizationState } from './organization-types.js';

export type OrganizationCapability = 'contact' | 'dispatch';

export interface AuthorizedTarget {
  id: string;
  title: string;
  duty: string;
}

interface ListOptions {
  includeSelf?: boolean;
}

interface ResolveOptions {
  allowSelf?: boolean;
}

function authorizationError(
  code: string, kind: 'not_found' | 'permission' | 'conflict', message: string,
): never {
  throw frameworkError({
    code, kind, message, source: 'cyclone.organization.authorization', retryable: false,
  });
}

async function loadSeats(
  dataDir: string, workshopId: string,
): Promise<{ seats: SeatData[]; state: WorkshopOrganizationState }> {
  const workshop = await loadWorkshop(dataDir, workshopId);
  if (!workshop) {
    authorizationError('CYCLONE_WORKSHOP_NOT_FOUND', 'not_found', `工作室不存在：${workshopId}`);
  }
  const loaded = await Promise.all(workshop.seatIds.map(id => loadSeat(dataDir, workshopId, id)));
  const seats = loaded.filter((seat): seat is SeatData => seat !== null);
  const state = await loadWorkshopOrganization(dataDir, workshopId);
  return { seats, state };
}

function groupFor(organization: WorkshopOrganization, seatId: string) {
  return organization.groups.find(group => group.seatIds.includes(seatId));
}

function explicitAllows(
  organization: WorkshopOrganization,
  sourceSeatId: string,
  targetSeatId: string,
): boolean {
  const sourceGroup = groupFor(organization, sourceSeatId);
  const targetGroup = groupFor(organization, targetSeatId);
  if (sourceGroup && sourceGroup.id === targetGroup?.id) {
    return true;
  }
  const relation = organization.externalRelations.find(item => (
    (item.sourceSeatId === sourceSeatId && item.targetSeatId === targetSeatId)
    || (item.sourceSeatId === targetSeatId && item.targetSeatId === sourceSeatId)
  ));
  if (!relation) return false;
  return relation.direction === 'both'
    || (relation.sourceSeatId === sourceSeatId && relation.targetSeatId === targetSeatId);
}

function allows(
  state: WorkshopOrganizationState,
  sourceSeatId: string,
  targetSeatId: string,
  capability: OrganizationCapability,
  allowSelf: boolean,
): boolean {
  if (sourceSeatId === targetSeatId) return allowSelf && capability === 'dispatch';
  if (state.mode === 'legacy-full-mesh') return true;
  return explicitAllows(state.organization, sourceSeatId, targetSeatId);
}

function asTarget(seat: SeatData): AuthorizedTarget {
  return { id: seat.id, title: seat.title, duty: seat.duty?.trim() || DEFAULT_DUTY };
}

export async function listAuthorizedTargets(
  dataDir: string,
  workshopId: string,
  sourceSeatId: string,
  capability: OrganizationCapability,
  options: ListOptions = {},
): Promise<AuthorizedTarget[]> {
  const { seats, state } = await loadSeats(dataDir, workshopId);
  if (!seats.some(seat => seat.id === sourceSeatId)) {
    authorizationError('CYCLONE_SOURCE_SEAT_NOT_FOUND', 'not_found', '来源工位不存在');
  }
  return seats.filter(seat => allows(
    state, sourceSeatId, seat.id, capability, options.includeSelf === true,
  )).map(asTarget);
}

export async function resolveAuthorizedTarget(
  dataDir: string,
  workshopId: string,
  sourceSeatId: string,
  targetTitle: string,
  capability: OrganizationCapability,
  options: ResolveOptions = {},
): Promise<AuthorizedTarget> {
  const { seats, state } = await loadSeats(dataDir, workshopId);
  if (!seats.some(seat => seat.id === sourceSeatId)) {
    authorizationError('CYCLONE_SOURCE_SEAT_NOT_FOUND', 'not_found', '来源工位不存在');
  }
  const matches = seats.filter(seat => seat.title === targetTitle);
  const exactId = seats.find(seat => seat.id === targetTitle);
  if (!exactId && matches.length > 1) {
    authorizationError('CYCLONE_TARGET_SEAT_AMBIGUOUS', 'conflict',
      `工位名「${targetTitle}」有多个匹配，请使用工位 ID`);
  }
  const target = exactId ?? matches[0];
  if (!target) {
    authorizationError(
      'CYCLONE_TARGET_SEAT_NOT_FOUND', 'not_found', `本工作室找不到名为「${targetTitle}」的工位`,
    );
  }
  if (!allows(state, sourceSeatId, target.id, capability, options.allowSelf === true)) {
    authorizationError(
      'CYCLONE_RELATION_DENIED', 'permission',
      `工位「${targetTitle}」不在当前${capability === 'contact' ? '联络' : '派发'}范围内`,
    );
  }
  return asTarget(target);
}
