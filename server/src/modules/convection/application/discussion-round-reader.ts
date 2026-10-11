import fs from 'node:fs/promises';
import path from 'node:path';
import { sessionWorkspace, type ConvectionSessionData } from '../infrastructure/session-store.js';

export type DiscussionScope = 'public' | 'chair';
export interface RoundMessage {
  speaker: string;
  content: string;
  timestamp?: number;
  complete?: boolean;
}
export interface DiscussionRound {
  roundId: string;
  scope: DiscussionScope;
  preciseIdentity: boolean;
  archived: boolean;
  messages: RoundMessage[];
}

interface StoredMessage {
  runId?: string;
  speaker?: string;
  role?: string;
  content: string;
  timestamp?: number;
}
interface Source {
  id: string;
  archived: boolean;
  messages: StoredMessage[];
}

export async function readDiscussionRounds(
  dataDir: string, session: ConvectionSessionData, scope: DiscussionScope,
): Promise<DiscussionRound[]> {
  const sources = await archivedSources(dataDir, session.id, scope);
  sources.push({ id: 'current', archived: false,
    messages: scope === 'public' ? session.publicMessages : session.chairMessages });
  const result = sources.flatMap(source => groupSource(source, scope));
  const unique = new Map<string, DiscussionRound>();
  for (const round of result) unique.set(round.roundId, round);
  return [...unique.values()];
}

function groupSource(source: Source, scope: DiscussionScope): DiscussionRound[] {
  const result: DiscussionRound[] = [];
  let current: DiscussionRound | undefined;
  for (const [index, message] of source.messages.entries()) {
    if (isSummary(message)) continue;
    const first = scope === 'public' ? message.speaker === '人类' : message.role === 'user';
    if (first || !current || (message.runId !== undefined && message.runId !== current.roundId)) {
      current = { roundId: message.runId ?? `legacy-${scope}-${source.id}-${index}`,
        scope, preciseIdentity: Boolean(message.runId), archived: source.archived, messages: [] };
      result.push(current);
    }
    current.messages.push({ speaker: message.speaker ?? message.role ?? '未知',
      content: message.content,
      ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}) });
  }
  return result;
}

function isSummary(message: StoredMessage): boolean {
  return message.speaker === '系统' && (message.content.startsWith('[对话历史摘要]')
    || message.content.startsWith('[会话归档摘要]'));
}

async function archivedSources(
  dataDir: string, sessionId: string, scope: DiscussionScope,
): Promise<Source[]> {
  const dir = path.join(sessionWorkspace(dataDir, sessionId), 'bak');
  let names: string[];
  try { names = await fs.readdir(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(names.filter(name => /^\d+\.json$/.test(name)).sort()
    .map(async name => {
      const raw = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as unknown;
      const value = Array.isArray(raw) ? (scope === 'public' ? raw : [])
        : isRecord(raw) ? raw[scope === 'public' ? 'publicMessages' : 'chairMessages'] : null;
      if (!Array.isArray(value) || !value.every(isStoredMessage)) {
        throw new Error(`对流归档格式无效：${name}`);
      }
      return { id: name.slice(0, -5), archived: true, messages: value };
    }));
}

function isStoredMessage(value: unknown): value is StoredMessage {
  if (!isRecord(value) || typeof value.content !== 'string') return false;
  if (value.runId !== undefined && typeof value.runId !== 'string') return false;
  return typeof value.speaker === 'string' || typeof value.role === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
