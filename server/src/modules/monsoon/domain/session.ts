import { parseModelUsageProgress, type ModelUsageProgress } from '../../../engine/shared/model-request-usage.js';

export interface MonsoonTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface MonsoonMessage extends Record<string, unknown> {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface MonsoonSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  titleManual?: boolean;
  titleState?: 'pending' | 'attempted' | 'generated';
  messages: MonsoonMessage[];
  model: string;
  systemPrompt: string;
  masterPrompt?: string;
  rolePrompt?: string;
  lastReadAt?: string;
  tokenUsage?: MonsoonTokenUsage;
  modelUsage?: ModelUsageProgress;
  createdAt: string;
  updatedAt: string;
  unreadCount?: number;
  revision: number;
  messageRevision: number;
}

export type SessionWriteMode = 'content' | 'rename' | 'read';

export function parseMonsoonSession(
  value: unknown,
  expected?: { agentId?: string; sessionId?: string },
): MonsoonSession {
  if (!record(value)) throw new Error('会话数据无效');
  const session: MonsoonSession = {
    id: identifier(value.id, 'sessionId'),
    agentId: identifier(value.agentId, 'agentId'),
    agentName: text(value.agentName, 'agentName', 200, true),
    title: text(value.title, 'title', 500),
    messages: messages(value.messages),
    model: text(value.model, 'model', 500, true),
    systemPrompt: text(value.systemPrompt, 'systemPrompt', 200_000, true),
    createdAt: timestamp(value.createdAt, 'createdAt'),
    updatedAt: timestamp(value.updatedAt, 'updatedAt'),
    revision: revision(value.revision),
    messageRevision: revision(value.messageRevision),
  };
  optionalFields(value, session);
  if (expected?.agentId && session.agentId !== expected.agentId) throw new Error('会话归属不一致');
  if (expected?.sessionId && session.id !== expected.sessionId) throw new Error('会话标识不一致');
  return session;
}

export function sessionUnread(session: MonsoonSession): number {
  const lastAssistant = findLast(session.messages, message => message.role === 'assistant');
  if (lastAssistant < 0 || !session.lastReadAt) return 0;
  const lastRead = findLast(session.messages, message => message.timestamp <= session.lastReadAt!);
  return lastAssistant > lastRead ? session.messages.length - lastRead - 1 : 0;
}

function findLast(values: MonsoonMessage[], predicate: (value: MonsoonMessage) => boolean): number {
  for (let index = values.length - 1; index >= 0; index--) {
    if (predicate(values[index]!)) return index;
  }
  return -1;
}

function optionalFields(value: Record<string, unknown>, session: MonsoonSession): void {
  if (typeof value.titleManual === 'boolean') session.titleManual = value.titleManual;
  if (['pending', 'attempted', 'generated'].includes(String(value.titleState))) {
    session.titleState = value.titleState as MonsoonSession['titleState'];
  }
  for (const field of ['masterPrompt', 'rolePrompt', 'lastReadAt'] as const) {
    if (typeof value[field] === 'string') session[field] = value[field];
  }
  if (value.tokenUsage !== undefined) session.tokenUsage = tokenUsage(value.tokenUsage);
  if (value.modelUsage !== undefined) session.modelUsage = parseModelUsageProgress(value.modelUsage);
  if (Number.isInteger(value.unreadCount) && Number(value.unreadCount) >= 0) {
    session.unreadCount = Number(value.unreadCount);
  }
}

function messages(value: unknown): MonsoonMessage[] {
  if (!Array.isArray(value)) throw new Error('会话消息无效');
  return value.map((item, index) => {
    if (!record(item) || !['user', 'assistant', 'system'].includes(String(item.role))) {
      throw new Error(`会话消息无效：${index}`);
    }
    return {
      ...structuredClone(item), id: text(item.id, 'message.id', 200),
      role: item.role as MonsoonMessage['role'],
      content: text(item.content, 'message.content', 2_000_000, true),
      timestamp: timestamp(item.timestamp, 'message.timestamp'),
    };
  });
}

function tokenUsage(value: unknown): MonsoonTokenUsage {
  if (!record(value)) throw new Error('tokenUsage 无效');
  const fields = ['promptTokens', 'completionTokens', 'totalTokens'] as const;
  const result = {} as MonsoonTokenUsage;
  for (const field of fields) {
    const count = Number(value[field]);
    if (!Number.isFinite(count) || count < 0) throw new Error('tokenUsage 无效');
    result[field] = count;
  }
  return result;
}

function identifier(value: unknown, name: string): string {
  const result = text(value, name, 160);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(result)) throw new Error(`${name} 无效`);
  return result;
}

function timestamp(value: unknown, name: string): string {
  const result = text(value, name, 40);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${name} 无效`);
  return result;
}

function revision(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error('revision 无效');
  return Number(value);
}

function text(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max) {
    throw new Error(`${name} 无效`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
