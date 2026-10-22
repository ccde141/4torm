import type { ModuleMethodHandler, ModuleMethodManifest } from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneAgentExecutionService } from '../application/agent-execution.js';

const id = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$' };
const message = { type: 'string', minLength: 1, maxLength: 20_000 };

export function cycloneAgentExecutionManifests(): ModuleMethodManifest[] {
  return [method('startCollaborationSeatChat', 'start_collaboration_seat_chat',
    '向气旋工位发起一轮普通私聊并返回运行句柄，交办内容填写 text；挂起提问需要人类处理。',
    'seatId', 'text'),
  method('startCollaborationChairChat', 'start_collaboration_chair_chat',
    '向气旋房间会长发起一轮私聊并返回运行句柄，私聊内容填写 message。', 'roomId', 'message')];
}

export function cycloneAgentExecutionHandlers(
  service: CycloneAgentExecutionService,
): Record<string, ModuleMethodHandler> {
  return {
    startCollaborationSeatChat: { parse: value => parse(value, 'seatId', 'text'),
      invoke: (_context, input) => {
        const item = input as { workshopId: string; seatId: string; text: string };
        return service.startSeat(item.workshopId, item.seatId, item.text);
      } },
    startCollaborationChairChat: { parse: value => parse(value, 'roomId', 'message'),
      invoke: (_context, input) => {
        const item = input as { workshopId: string; roomId: string; message: string };
        return service.startChair(item.workshopId, item.roomId, item.message);
      } },
  };
}

function method(methodId: string, toolName: string, description: string,
  targetKey: 'seatId' | 'roomId', textKey: 'text' | 'message'): ModuleMethodManifest {
  return { id: methodId, kind: 'command', permission: 'execute',
    audiences: ['agent', 'internal'], agentTool: { name: toolName, description },
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['workshopId', targetKey, textKey],
      properties: { workshopId: id, [targetKey]: id, [textKey]: message } },
    output: { mode: 'operation' } };
}

function parse(value: unknown, targetKey: 'seatId' | 'roomId',
  textKey: 'text' | 'message'): Record<string, string> {
  const keys = ['workshopId', targetKey, textKey];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`参数必须为包含 ${keys.join('、')} 的对象，交办内容填写 ${textKey}`);
  }
  const item = value as Record<string, unknown>;
  const extra = Object.keys(item).find(key => !keys.includes(key));
  if (extra !== undefined) {
    throw invalid(`不支持字段 ${extra.slice(0, 80)}；请填写 ${keys.join('、')}，交办内容使用 ${textKey}`);
  }
  return { workshopId: identifier(item.workshopId, 'workshopId'),
    [targetKey]: identifier(item[targetKey], targetKey), [textKey]: nonempty(item[textKey], textKey) };
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalid(`${field} 缺失或无效，请填写完整 ID`);
  }
  return value;
}

function nonempty(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000) {
    throw invalid(`${field} 缺失或无效，请在 ${field} 填写 1 至 20000 字符的非空交办内容`);
  }
  return value.trim();
}

function invalid(message: string): never {
  throw frameworkError({ code: 'CYCLONE_AGENT_EXECUTION_INPUT_INVALID', kind: 'validation',
    message, source: 'cyclone.agent-execution', retryable: false });
}
