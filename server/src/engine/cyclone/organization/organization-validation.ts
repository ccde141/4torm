import { frameworkError } from '../../shared/framework-error.js';
import {
  WORKSHOP_ORGANIZATION_VERSION,
  type ExternalRelation,
  type OrganizationDraft,
  type OrganizationPoint,
  type OrganizationSize,
  type SaveOrganizationInput,
  type WorkGroup,
  type WorkshopOrganization,
} from './organization-types.js';

type JsonRecord = Record<string, unknown>;

function invalid(message: string, details?: Record<string, unknown>): never {
  throw frameworkError({
    code: 'CYCLONE_ORGANIZATION_INVALID', kind: 'validation', message,
    source: 'cyclone.organization.validation', retryable: false, details,
  });
}

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${field} 必须是对象`);
  return value as JsonRecord;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${field} 不能为空`);
  return value.trim();
}

function finite(value: unknown, field: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    invalid(`${field} 必须是${positive ? '正' : '有限'}数`);
  }
  return value;
}

function point(value: unknown, field: string): OrganizationPoint {
  const input = record(value, field);
  return { x: finite(input.x, `${field}.x`), y: finite(input.y, `${field}.y`) };
}

function size(value: unknown, field: string): OrganizationSize | undefined {
  if (value === undefined) return undefined;
  const input = record(value, field);
  return {
    width: finite(input.width, `${field}.width`, true),
    height: finite(input.height, `${field}.height`, true),
  };
}

function parseGroup(value: unknown, index: number): WorkGroup {
  const field = `groups[${index}]`;
  const input = record(value, field);
  if (!Array.isArray(input.seatIds)) invalid(`${field}.seatIds 必须是数组`);
  return {
    id: text(input.id, `${field}.id`), title: text(input.title, `${field}.title`),
    seatIds: input.seatIds.map((seatId, seatIndex) => text(seatId, `${field}.seatIds[${seatIndex}]`)),
    position: point(input.position, `${field}.position`), size: size(input.size, `${field}.size`),
  };
}

function parseRelation(value: unknown, index: number): ExternalRelation {
  const field = `externalRelations[${index}]`;
  const input = record(value, field);
  return {
    id: text(input.id, `${field}.id`),
    sourceSeatId: text(input.sourceSeatId, `${field}.sourceSeatId`),
    targetSeatId: text(input.targetSeatId, `${field}.targetSeatId`),
    direction: relationDirection(input.direction, `${field}.direction`),
  };
}

function relationDirection(value: unknown, field: string): ExternalRelation['direction'] {
  if (value !== 'both' && value !== 'forward') invalid(`${field} 必须是 both 或 forward`);
  return value;
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) invalid(`${label}不能重复：${value}`);
    seen.add(value);
  }
}

function validateMembership(groups: WorkGroup[], workshopSeatIds: readonly string[]): Map<string, string> {
  assertUnique(groups.map(group => group.id), '协作组 id ');
  assertUnique(groups.map(group => group.title), '协作组名称');
  const knownSeats = new Set(workshopSeatIds);
  const groupBySeat = new Map<string, string>();
  for (const group of groups) {
    for (const seatId of group.seatIds) {
      if (!knownSeats.has(seatId)) invalid(`协作组引用了不存在的工位：${seatId}`);
      if (groupBySeat.has(seatId)) invalid(`工位不能属于多个协作组：${seatId}`);
      groupBySeat.set(seatId, group.id);
    }
  }
  return groupBySeat;
}

function validateRelations(
  relations: ExternalRelation[], workshopSeatIds: readonly string[], groupBySeat: Map<string, string>,
): void {
  assertUnique(relations.map(relation => relation.id), '关系 id ');
  const knownSeats = new Set(workshopSeatIds);
  const pairs: string[] = [];
  for (const relation of relations) {
    const { sourceSeatId: source, targetSeatId: target } = relation;
    if (!knownSeats.has(source) || !knownSeats.has(target)) invalid('跨组关系引用了不存在的工位');
    if (source === target) invalid('跨组关系不能连接工位自身');
    const sourceGroup = groupBySeat.get(source);
    if (sourceGroup && sourceGroup === groupBySeat.get(target)) invalid('同组工位不应创建跨组关系');
    pairs.push([source, target].sort().join('\0'));
  }
  assertUnique(pairs, '工位关系');
}

function parseSeatPositions(
  value: unknown, workshopSeatIds: readonly string[],
): Record<string, OrganizationPoint> | undefined {
  if (value === undefined) return undefined;
  const input = record(value, 'seatPositions');
  const knownSeats = new Set(workshopSeatIds);
  return Object.fromEntries(Object.entries(input).map(([seatId, position]) => {
    if (!knownSeats.has(seatId)) invalid(`工位布局引用了不存在的工位：${seatId}`);
    return [seatId, point(position, `seatPositions.${seatId}`)];
  }));
}

export function validateOrganizationDraft(
  value: unknown, workshopSeatIds: readonly string[],
): OrganizationDraft {
  const input = record(value, 'organization');
  if (!Array.isArray(input.groups)) invalid('groups 必须是数组');
  if (!Array.isArray(input.externalRelations)) invalid('externalRelations 必须是数组');
  const groups = input.groups.map(parseGroup);
  const externalRelations = input.externalRelations.map(parseRelation);
  const groupBySeat = validateMembership(groups, workshopSeatIds);
  validateRelations(externalRelations, workshopSeatIds, groupBySeat);
  const seatPositions = parseSeatPositions(input.seatPositions, workshopSeatIds);
  return { groups, externalRelations, ...(seatPositions ? { seatPositions } : {}) };
}

export function validateExpectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    invalid('expectedRevision 必须是非负整数');
  }
  return value as number;
}

export function validateSaveOrganizationInput(
  value: unknown, workshopSeatIds: readonly string[],
): SaveOrganizationInput {
  const input = record(value, 'organization');
  return {
    expectedRevision: validateExpectedRevision(input.expectedRevision),
    ...validateOrganizationDraft(input, workshopSeatIds),
  };
}

export function validateStoredOrganization(
  value: unknown, workshopSeatIds: readonly string[],
): WorkshopOrganization {
  const input = record(value, 'organization');
  if (input.version !== WORKSHOP_ORGANIZATION_VERSION) invalid('不支持的组织数据版本');
  if (!Number.isInteger(input.revision) || (input.revision as number) < 1) invalid('revision 必须是正整数');
  const updatedAt = text(input.updatedAt, 'updatedAt');
  if (Number.isNaN(Date.parse(updatedAt))) invalid('updatedAt 必须是有效时间');
  return {
    version: WORKSHOP_ORGANIZATION_VERSION,
    revision: input.revision as number,
    updatedAt,
    ...validateOrganizationDraft(input, workshopSeatIds),
  };
}
