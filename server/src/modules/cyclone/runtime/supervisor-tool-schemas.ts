import type { ToolDef } from '../../../engine/shared/tool-defs-loader.js';

export interface SupervisorMethodTool { method: string; definition: ToolDef; fixed?: Record<string, unknown> }
type Properties = NonNullable<NonNullable<ToolDef['parameters']>['properties']>;
const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };
const text = { type: 'string', maxLength: 20_000 };
const label = { type: 'string', minLength: 1, maxLength: 2_000 };
const boolean = { type: 'boolean' };
const ids = { type: 'array', uniqueItems: true, maxItems: 50, items: id };
const point = { type: 'object', additionalProperties: false, required: ['x', 'y'],
  properties: { x: { type: 'number' }, y: { type: 'number' } } };
const scope = { type: 'string', enum: ['public', 'chair', 'both'] };

function method(method: string, name: string, description: string, required: string[],
  properties: Properties, fixed?: Record<string, unknown>): SupervisorMethodTool {
  return { method, definition: { name, description, parameters: {
    type: 'object', additionalProperties: false, required, properties,
  } }, ...(fixed ? { fixed } : {}) };
}

/** Supervisor-only local management, delegated to the existing human/internal commands. */
export function supervisorManagementTools(): SupervisorMethodTool[] {
  return [
    method('updateSeatRole', 'update_collaboration_seat',
      '修改当前工作室工位的名称、职责、角色或绑定 Agent。保留原工位资料与履历。', ['seatId'],
      { seatId: id, agentId: id, title: label, duty: text, rolePrompt: text, overrideAgentRole: boolean }),
    method('updateSeatCollaboration', 'set_collaboration_permissions',
      '设置工位的联络、派发和公告板协作开关。', ['seatId', 'contact', 'dispatch', 'bulletin'],
      { seatId: id, contact: boolean, dispatch: boolean, bulletin: boolean }),
    method('deleteSeat', 'retire_collaboration_seat',
      '将工位移出活动结构并退出群聊，保留其历史、任务板、记忆与附件快照。忙碌工位会被拒绝。',
      ['seatId'], { seatId: id }),
    method('readWorkshopOrganization', 'read_collaboration_structure',
      '读取当前工作室的协作分组、联络关系及 revision。', [], {}),
    method('saveWorkshopOrganization', 'update_collaboration_structure',
      '按当前 revision 更新协作分组和组间联络关系；冲突时先重新读取，不盲目覆盖。',
      ['expectedRevision', 'groups', 'externalRelations'], {
        expectedRevision: { type: 'integer', minimum: 0 },
        groups: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false,
          required: ['id', 'title', 'seatIds', 'position'], properties: { id, title: label, seatIds: ids,
            position: point, size: { type: 'object', additionalProperties: false, required: ['width', 'height'],
              properties: { width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 } } } } } },
        externalRelations: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: false,
          required: ['id', 'sourceSeatId', 'targetSeatId', 'direction'], properties: {
            id, sourceSeatId: id, targetSeatId: id, direction: { type: 'string', enum: ['both', 'forward'] } } } },
        seatPositions: { type: 'object', additionalProperties: point },
      }),
    method('mutateWorkshopBulletin', 'update_collaboration_bulletin',
      '新增、修改、移除或恢复公告条目；保留公告更改记录。', ['operations'], {
        operations: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object',
          additionalProperties: false, required: ['op'], properties: {
            op: { type: 'string', enum: ['add', 'update', 'remove', 'restore'] }, id, text: label, author: label,
          } } },
      }),
    method('setRoomParticipants', 'set_collaboration_room_members',
      '完整设置群聊成员与发言顺序。运行中的群聊会拒绝修改。', ['roomId', 'seatIds'],
      { roomId: id, seatIds: ids }),
    method('renameRoom', 'rename_collaboration_room', '修改群聊名称。', ['roomId', 'title'],
      { roomId: id, title: label }),
    method('setRoomTopic', 'set_collaboration_room_topic', '修改群聊议题。', ['roomId', 'topic'],
      { roomId: id, topic: label }),
    method('setRoomMode', 'set_collaboration_room_mode', '设置群聊工作或讨论模式。', ['roomId', 'mode'],
      { roomId: id, mode: { type: 'string', enum: ['build', 'plan'] } }),
    method('deleteRoom', 'delete_collaboration_room', '删除指定群聊。忙碌群聊会被拒绝。',
      ['roomId'], { roomId: id }),
    method('compactSeatContext', 'compact_collaboration_seat',
      '压缩工位会话，原始记录保留归档；执行中或挂起时不会强行覆盖。', ['seatId'], { seatId: id }),
    method('resetSeatContext', 'reset_collaboration_seat',
      '归档并清空工位后续上下文，保留原记录。挂起问题需明确 forcePending 才能清空。',
      ['seatId'], { seatId: id, forcePending: boolean }, { mode: 'clear' }),
    method('compactRoomContext', 'compact_collaboration_room',
      '压缩群聊或会长会话，原始记录保留归档。scope 默认 public。', ['roomId'], { roomId: id, scope }),
    method('resetRoomContext', 'reset_collaboration_room',
      '归档并清空群聊或会长后续上下文，原始记录保留。', ['roomId', 'scope'],
      { roomId: id, scope }, { mode: 'clear' }),
    method('readSeatHistory', 'read_collaboration_seat_history',
      '分页读取工位工作与配置/记忆变更履历，使用 nextCursor 续读；版本冲突时重新读取。', ['seatId'],
      { seatId: id, filter: { type: 'string', enum: ['all', 'work', 'changes'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 }, cursor: { type: 'string', maxLength: 96 } }),
  ];
}

export function supervisorCommunicationTools(): ToolDef[] {
  return [
    { name: 'dispatch', description: '按工位 ID 或名称异步交办给当前工作室活动工位，推荐 ID；同名时必须使用 ID。立即返回登记回执。目标在30秒内未接入则撤回并报告 busy；已接入的任务可持续执行，凭派发记录核对结果，不重发已送达任务。',
      parameters: { type: 'object', additionalProperties: false, required: ['target', 'task'],
        properties: { target: { ...label, description: '当前工作室活动工位的 ID 或名称，推荐 ID' },
          task: { type: 'string', minLength: 1, maxLength: 20_000 } } } },
    { name: 'contact', description: '按工位 ID 或名称联络当前工作室的活动工位，推荐 ID；同名时必须使用 ID。最多等待30秒接入；未接入撤回。已接入但暂未回复时返回 contactId，目标继续处理，按需 contact_read 查询，勿重发。',
      parameters: { type: 'object', additionalProperties: false, required: ['target', 'message'],
        properties: { target: { ...label, description: '当前工作室活动工位的 ID 或名称，推荐 ID' },
          message: { type: 'string', minLength: 1, maxLength: 20_000 } } } },
    { name: 'contact_read', description: '读取主管发出或收到的联络状态与分段回复，按 nextOffset 续读。',
      parameters: { type: 'object', additionalProperties: false, required: ['contactId'], properties: {
        contactId: { type: 'string', minLength: 1, maxLength: 160 }, offset: { type: 'integer', minimum: 0 },
      } } },
  ];
}
