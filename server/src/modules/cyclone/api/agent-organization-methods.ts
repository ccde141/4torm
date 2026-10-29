import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { collaborationStructureProperties } from '../domain/organization-schema.js';
import type { CycloneAgentOrganizationService, ReadCollaborationStructureInput } from '../application/agent-organization-service.js';

const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };
export function cycloneAgentOrganizationManifests(): ModuleMethodManifest[] {
  return [
    { id: 'readCollaborationStructure', kind: 'query', permission: 'observe', audiences: ['agent', 'internal'],
      agentTool: { name: 'read_collaboration_structure', description:
        '分页读取协作图：view=seats（默认）列工位与所属组，groups 列协作组，relations 列定向关系。返回 mode、revision 和 nextCursor；后续视图带上 revision，按同一视图游标读完，变化冲突后重新读取。未配置图的 legacy-full-mesh 表示默认互通，不是隔离。' },
      inputSchema: { type: 'object', additionalProperties: false, required: ['workshopId'], properties: {
        workshopId: id, view: { type: 'string', enum: ['seats', 'groups', 'relations'] },
        cursor: { type: 'string', maxLength: 100 }, limit: { type: 'integer', minimum: 1, maximum: 12 },
        revision: { type: 'integer', minimum: 0 },
      } }, output: { mode: 'inline' } },
    { id: 'updateCollaborationStructure', kind: 'command', permission: 'design', audiences: ['agent', 'internal'],
      agentTool: { name: 'update_collaboration_structure', description:
        '按 expectedRevision 完整替换本工作室的 groups 和 externalRelations；不是追加。先读完当前结构，保留不改的组、关系和布局。同组默认互通，跨组/未分组按 forward（source→target）或 both 联络与派发；不授予工具或协作开关权限。首次保存从默认互通切换为显式结构，空组空关系将隔离全部不同工位。省略 seatPositions 保留原布局；冲突必须重读。' },
      inputSchema: { type: 'object', additionalProperties: false,
        required: ['workshopId', 'expectedRevision', 'groups', 'externalRelations'],
        properties: { workshopId: id, ...collaborationStructureProperties() } }, output: { mode: 'inline' } },
  ];
}

export function cycloneAgentOrganizationHandlers(service: CycloneAgentOrganizationService): Record<string, ModuleMethodHandler> {
  return {
    readCollaborationStructure: { parse: parseRead, invoke: (_context, input) => service.read(input as ReturnType<typeof parseRead>) },
    updateCollaborationStructure: { parse: parseUpdate, invoke: (_context, input) => {
      const value = input as ReturnType<typeof parseUpdate>;
      return service.update(value.workshopId, value.organization);
    } },
  };
}

function parseRead(value: unknown): ReadCollaborationStructureInput {
  const item = exact(value, ['workshopId', 'view', 'cursor', 'limit', 'revision']);
  const view = item.view === undefined ? 'seats' : item.view;
  if (view !== 'seats' && view !== 'groups' && view !== 'relations') throw invalid('view 无效');
  if (item.cursor !== undefined && (typeof item.cursor !== 'string' || !item.cursor || item.cursor.length > 100)) throw invalid('cursor 无效');
  const limit = item.limit === undefined ? 8 : item.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 12) throw invalid('limit 必须为 1 至 12');
  if (item.revision !== undefined && (!Number.isSafeInteger(item.revision) || (item.revision as number) < 0)) {
    throw invalid('revision 必须为非负安全整数');
  }
  return { workshopId: workshopId(item.workshopId), view,
    ...(item.revision === undefined ? {} : { revision: item.revision as number }),
    ...(item.cursor === undefined ? {} : { cursor: item.cursor as string }), limit: limit as number };
}

function parseUpdate(value: unknown) {
  const item = exact(value, ['workshopId', 'expectedRevision', 'groups', 'externalRelations', 'seatPositions']);
  if (!Array.isArray(item.groups) || item.groups.length > 100
    || !Array.isArray(item.externalRelations) || item.externalRelations.length > 1_000) throw invalid('组或关系数量无效');
  if (!Number.isSafeInteger(item.expectedRevision) || (item.expectedRevision as number) < 0) {
    throw invalid('expectedRevision 必须为非负安全整数');
  }
  for (const value of item.groups) {
    const group = exact(value, ['id', 'title', 'seatIds', 'position', 'size']);
    label(group.id, 160); label(group.title, 2_000);
    if (!Array.isArray(group.seatIds) || group.seatIds.length > 50) throw invalid('seatIds 无效');
    group.seatIds.forEach(value => label(value, 160));
    exact(group.position, ['x', 'y']);
    if (group.size !== undefined) exact(group.size, ['width', 'height']);
  }
  for (const value of item.externalRelations) {
    const relation = exact(value, ['id', 'sourceSeatId', 'targetSeatId', 'direction']);
    for (const key of ['id', 'sourceSeatId', 'targetSeatId']) label(relation[key], 160);
  }
  if (item.seatPositions !== undefined) {
    const positions = exact(item.seatPositions);
    for (const [id, value] of Object.entries(positions)) {
      label(id, 160); exact(value, ['x', 'y']);
    }
  }
  // Business validation uses the current workshop roster in the application/store layer.
  return { workshopId: workshopId(item.workshopId),
    organization: { expectedRevision: item.expectedRevision, groups: item.groups,
      externalRelations: item.externalRelations,
      ...(item.seatPositions === undefined ? {} : { seatPositions: item.seatPositions }) } };
}

function exact(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('参数必须为对象');
  if (keys && Object.keys(value).some(key => !keys.includes(key))) throw invalid('存在不支持的字段');
  return value as Record<string, unknown>;
}
function label(value: unknown, max: number): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid('名称或 ID 无效');
}
function workshopId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid('workshopId 无效');
  return value;
}
function invalid(message: string) {
  return frameworkError({ code: 'CYCLONE_AGENT_STRUCTURE_INPUT_INVALID', kind: 'validation',
    message, source: 'cyclone.agent-organization', retryable: false });
}
