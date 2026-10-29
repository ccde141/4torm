import { createHash } from 'node:crypto';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { validateSaveOrganizationInput } from '../../../engine/cyclone/organization/organization-validation.js';
import type { CycloneWorkshopService } from './workshop-service.js';

export interface ReadCollaborationStructureInput {
  workshopId: string; view: 'seats' | 'groups' | 'relations'; cursor?: string; limit: number; revision?: number;
}

/** Agent projection; persistence and authorization remain owned by the workshop service. */
export class CycloneAgentOrganizationService {
  constructor(private readonly workshops: CycloneWorkshopService) {}

  async read(input: ReadCollaborationStructureInput) {
    const summary = await this.workshops.summary(input.workshopId);
    const state = await this.workshops.organization(input.workshopId);
    if (input.revision !== undefined && input.revision !== (state.organization?.revision ?? 0)) {
      throw structureError('CHANGED', 'conflict', '协作结构版本已变化，请重新读取全部视图');
    }
    const groups = state.organization?.groups ?? [];
    const relations = state.organization?.externalRelations ?? [];
    const positions = state.organization?.seatPositions ?? {};
    const latest = await this.workshops.require(input.workshopId);
    if (latest.seatIds.length !== summary.seats.length
      || latest.seatIds.some(id => !summary.seats.some(seat => seat.id === id))) {
      throw structureError('CHANGED', 'conflict', '读取期间工位名单已变化，请重新读取');
    }
    const seats = summary.seats.map(seat => ({ seatId: seat.id, title: seat.title,
      agentId: seat.agentId, groupId: groups.find(group => group.seatIds.includes(seat.id))?.id ?? null,
      ...(positions[seat.id] ? { position: positions[seat.id] } : {}) }));
    const version = createHash('sha256').update(JSON.stringify([input.workshopId, state, seats])).digest('hex');
    const items: unknown[] = input.view === 'seats' ? seats : input.view === 'groups' ? groups : relations;
    const start = offset(input.cursor, `${version}:${input.view}`, items.length);
    let end = Math.min(start + input.limit, items.length);
    const output = () => ({ workshopId: input.workshopId, mode: state.mode,
      revision: state.organization?.revision ?? 0, view: input.view,
      counts: { seats: seats.length, groups: groups.length, relations: relations.length },
      items: items.slice(start, end), total: items.length, truncated: end < items.length,
      ...(end < items.length ? { nextCursor: `${version}:${input.view}:${end}` } : {}) });
    while (JSON.stringify(output()).length > 24_000 && end > start + 1) end--;
    const result = output();
    if (JSON.stringify(result).length > 24_000) throw structureError('OUTPUT_LIMIT', 'validation',
      '单项协作结构超出读取预算，请在协作结构页面检查异常长字段');
    return result;
  }

  async update(workshopId: string, value: unknown) {
    const workshop = await this.workshops.require(workshopId);
    const input = validateSaveOrganizationInput(value, workshop.seatIds);
    const current = await this.workshops.organization(workshopId);
    if ((current.organization?.revision ?? 0) !== input.expectedRevision) throw structureError(
      'REVISION_CONFLICT', 'conflict', '协作结构版本已变化，请重新读取并合并修改');
    // Omitting layout must not erase the human's canvas arrangement. The store performs CAS.
    const organization = await this.workshops.saveOrganization(workshopId, {
      ...input, seatPositions: input.seatPositions ?? current.organization?.seatPositions,
    });
    return { workshopId, mode: 'explicit' as const, revision: organization.revision,
      counts: { groups: organization.groups.length, relations: organization.externalRelations.length } };
  }
}

function offset(cursor: string | undefined, version: string, total: number): number {
  if (cursor === undefined) return 0;
  const match = /^([a-f0-9]{64}:(?:seats|groups|relations)):(\d+)$/.exec(cursor);
  if (!match) throw structureError('INPUT_INVALID', 'validation', '协作结构分页游标无效');
  if (match[1] !== version) throw structureError('CHANGED', 'conflict',
    '协作结构或工位名单已变化，请重新读取；不同视图的游标不能混用');
  const value = Number(match[2]);
  if (!Number.isSafeInteger(value) || value > total) throw structureError('INPUT_INVALID',
    'validation', '协作结构分页位置无效');
  return value;
}

function structureError(code: string, kind: 'validation' | 'conflict', message: string) {
  return frameworkError({ code: `CYCLONE_AGENT_STRUCTURE_${code}`, kind, message,
    source: 'cyclone.agent-organization', retryable: false });
}
