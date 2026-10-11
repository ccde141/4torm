import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import type {
  MeetingIdentity, MeetingMessageCommand, MeetingOrderCommand, MeetingParticipantCommand,
  TradewindMeetingCommands,
} from '../application/meeting-commands.js';

export function tradewindMeetingManifests(): ModuleMethodManifest[] {
  return [
    command('endMeeting', 'end_workflow_meeting', '结束当前信风会议并生成纪要，随后继续下游节点。', identitySchema()),
    command('joinMeeting', 'join_workflow_meeting', '将已配置的节点加入当前信风会议。', participantSchema()),
    command('leaveMeeting', 'leave_workflow_meeting', '将节点请离当前信风会议。', participantSchema()),
    command('reorderMeeting', 'reorder_workflow_meeting', '调整当前信风会议参与节点的完整发言顺序。', orderSchema()),
    command('speakMeeting', 'speak_workflow_meeting', '在当前信风会议公开发言并等待本轮回复完成。', messageSchema()),
    command('messageMeetingChair', 'message_workflow_chair', '向当前信风会议会长私聊并等待回复。', messageSchema()),
  ];
}

export function tradewindMeetingHandlers(
  commands: TradewindMeetingCommands,
): Record<string, ModuleMethodHandler> {
  return {
    endMeeting: handler(parseIdentity, commands.end),
    joinMeeting: handler(parseParticipant, commands.join),
    leaveMeeting: handler(parseParticipant, commands.leave),
    reorderMeeting: handler(parseOrder, commands.reorder),
    speakMeeting: handler(parseMessage, commands.speak),
    messageMeetingChair: handler(parseMessage, commands.messageChair),
  };
}

function handler<T>(parse: (value: unknown) => T, invoke: (input: T) => Promise<unknown>): ModuleMethodHandler {
  return { parse, invoke: (_context, input) => invoke(input as T) };
}

function parseIdentity(value: unknown): MeetingIdentity {
  const record = exact(value, ['executionId', 'nodeId']);
  return { executionId: text(record.executionId), nodeId: text(record.nodeId) };
}

function parseParticipant(value: unknown): MeetingParticipantCommand {
  const record = exact(value, ['executionId', 'nodeId', 'participantNodeId']);
  return { executionId: text(record.executionId), nodeId: text(record.nodeId),
    participantNodeId: text(record.participantNodeId) };
}

function parseOrder(value: unknown): MeetingOrderCommand {
  const record = exact(value, ['executionId', 'nodeId', 'order']);
  if (!Array.isArray(record.order)) throw invalidInput();
  const order = record.order.map(text);
  if (new Set(order).size !== order.length) throw invalidInput();
  return { executionId: text(record.executionId), nodeId: text(record.nodeId), order };
}

function parseMessage(value: unknown): MeetingMessageCommand {
  const record = exact(value, ['executionId', 'nodeId', 'message']);
  const message = text(record.message);
  if (message.length > 50_000) throw invalidInput();
  return { executionId: text(record.executionId), nodeId: text(record.nodeId), message };
}

function command(id: string, name: string, description: string,
  inputSchema: Record<string, unknown>): ModuleMethodManifest {
  return { id, kind: 'command', permission: 'intervene',
    audiences: ['human', 'agent', 'internal'], agentTool: { name, description },
    inputSchema, output: { mode: 'inline' } };
}

function identitySchema() { return { type: 'object', additionalProperties: false,
  required: ['executionId', 'nodeId'], properties: {
    executionId: { type: 'string', minLength: 1 }, nodeId: { type: 'string', minLength: 1 },
  } }; }
function participantSchema() { return { ...identitySchema(),
  required: ['executionId', 'nodeId', 'participantNodeId'],
  properties: { ...identitySchema().properties,
    participantNodeId: { type: 'string', minLength: 1 } } }; }
function orderSchema() { return { ...identitySchema(),
  required: ['executionId', 'nodeId', 'order'],
  properties: { ...identitySchema().properties,
    order: { type: 'array', items: { type: 'string', minLength: 1 } } } }; }
function messageSchema() { return { ...identitySchema(),
  required: ['executionId', 'nodeId', 'message'],
  properties: { ...identitySchema().properties,
    message: { type: 'string', minLength: 1, maxLength: 50_000 } } }; }

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidInput();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw invalidInput();
  return record;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidInput();
  return value.trim();
}

function invalidInput() {
  return frameworkError({ code: 'TRADEWIND_MEETING_INPUT_INVALID', kind: 'validation',
    message: '会议信息无效', source: 'tradewind.meeting', retryable: false });
}
