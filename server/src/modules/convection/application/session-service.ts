import { frameworkError } from '../../../engine/shared/framework-error.js';
import path from 'node:path';
import {
  createSession,
  deleteSession,
  listSessions,
  loadSession,
  saveSession,
  sessionWorkspace,
  tryAcquireSessionLock,
  type ConvectionSessionData,
  type ConvectionSessionSummary,
} from '../infrastructure/session-store.js';
import { prepareCompactionArchive } from '../../../engine/shared/compaction-archive.js';
import { summarizeConvectionSession } from './manual-summary.js';
import { clearConvectionChairContext } from '../execution/chair-context.js';

export interface CreateConvectionSessionInput {
  chairAgentId: string;
  participantAgentIds: string[];
  topic?: string;
  title?: string;
}

export interface ResetConvectionContextResult {
  ok: true;
  mode: 'clean' | 'summary';
  archived: string;
  summary?: string;
  summaryFailed: boolean;
}

type SummarizeSession = (session: ConvectionSessionData) => Promise<string>;

export class ConvectionSessionService {
  constructor(
    private readonly dataDir: string,
    private readonly summarize: SummarizeSession = session =>
      summarizeConvectionSession(dataDir, session),
    private readonly hasAgent?: (agentId: string) => Promise<boolean>,
    private readonly onChange?: (sessionId: string) => void,
  ) {}

  list(): Promise<ConvectionSessionSummary[]> {
    return listSessions(this.dataDir);
  }

  async require(sessionId: string): Promise<ConvectionSessionData> {
    const session = await loadSession(this.dataDir, identifier(sessionId));
    if (!session) throw sessionNotFound(sessionId);
    return session;
  }

  async create(input: CreateConvectionSessionInput): Promise<ConvectionSessionData> {
    const chairAgentId = identifier(input.chairAgentId);
    const participantAgentIds = identifiers(input.participantAgentIds, false);
    if (participantAgentIds.includes(chairAgentId)) invalidInput('主席不能同时作为参与者');
    for (const agentId of [chairAgentId, ...participantAgentIds]) await this.assertAgent(agentId);
    const title = optionalText(input.title);
    const topic = optionalText(input.topic);
    const session = await createSession(this.dataDir, {
      chairAgentId, participantAgentIds, ...(title ? { title } : {}), ...(topic ? { topic } : {}),
    });
    this.onChange?.(session.id);
    return session;
  }

  async save(session: ConvectionSessionData): Promise<void> {
    await saveSession(this.dataDir, session);
    this.onChange?.(session.id);
  }

  async rename(sessionId: string, title: string): Promise<void> {
    await this.withMutationLock(sessionId, async () => {
      const session = await this.require(sessionId);
      session.title = text(title);
      await this.save(session);
    });
  }

  async join(sessionId: string, agentId: string): Promise<string[]> {
    return this.withMutationLock(sessionId, async () => {
      const session = await this.require(sessionId);
      const member = identifier(agentId);
      if (member === session.chairAgentId) invalidInput('主席不能作为参与者');
      await this.assertAgent(member);
      if (!session.participantAgentIds.includes(member)) {
        session.participantAgentIds.push(member);
        await this.save(session);
      }
      return [...session.participantAgentIds];
    });
  }

  async leave(sessionId: string, agentId: string): Promise<string[]> {
    return this.withMutationLock(sessionId, async () => {
      const session = await this.require(sessionId);
      const member = identifier(agentId);
      const next = session.participantAgentIds.filter(id => id !== member);
      if (next.length !== session.participantAgentIds.length) {
        if (next.length === 0) throw frameworkError({
          code: 'CONVECTION_LAST_PARTICIPANT', kind: 'conflict',
          message: '会议至少需要一名与会 Agent；请先请入其他成员',
          source: 'convection.sessions', retryable: false,
        });
        session.participantAgentIds = next;
        await this.save(session);
      }
      return [...session.participantAgentIds];
    });
  }

  async reorder(sessionId: string, order: string[]): Promise<string[]> {
    return this.withMutationLock(sessionId, async () => {
      const session = await this.require(sessionId);
      const next = identifiers(order, true);
      if (next.length === 0) invalidInput('会议至少需要一名与会 Agent');
      if (!sameMembers(next, session.participantAgentIds)) invalidInput('参与者顺序必须包含当前全部成员');
      session.participantAgentIds = next;
      await this.save(session);
      return [...next];
    });
  }

  async setChair(sessionId: string, agentId: string): Promise<string> {
    return this.withMutationLock(sessionId, async () => {
      const session = await this.require(sessionId);
      const chair = identifier(agentId);
      await this.assertAgent(chair);
      if (session.participantAgentIds.includes(chair)) invalidInput('主席不能同时作为参与者');
      session.chairAgentId = chair;
      await this.save(session);
      return chair;
    });
  }

  async remove(sessionId: string): Promise<void> {
    await this.withMutationLock(sessionId, async () => {
      await this.require(sessionId);
      await deleteSession(this.dataDir, identifier(sessionId));
      this.onChange?.(sessionId);
    });
  }

  private async withMutationLock<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    const release = tryAcquireSessionLock(identifier(sessionId));
    if (!release) throw frameworkError({ code: 'CONVECTION_SESSION_BUSY', kind: 'conflict',
      message: '对流会议正在执行，暂不能修改会话',
      source: 'convection.sessions', retryable: false });
    try { return await run(); } finally { release(); }
  }

  private async assertAgent(agentId: string): Promise<void> {
    if (this.hasAgent && !await this.hasAgent(agentId)) invalidInput('Agent 不存在');
  }

  async editMessage(sessionId: string, index: number, content: string): Promise<void> {
    await this.withMutationLock(sessionId, async () => {
      const session = await this.require(sessionId);
      const message = session.publicMessages[messageIndex(index)];
      if (!message) throw messageNotFound(index);
      message.content = typeof content === 'string' ? content : invalidInput('消息内容必须是字符串');
      clearConvectionChairContext(session);
      session.chairTokenUsage = undefined;
      await this.save(session);
    });
  }

  async deleteMessage(sessionId: string, index: number): Promise<void> {
    await this.withMutationLock(sessionId, async () => {
      const session = await this.require(sessionId);
      const position = messageIndex(index);
      if (!session.publicMessages[position]) throw messageNotFound(index);
      session.publicMessages.splice(position, 1);
      clearConvectionChairContext(session);
      session.chairTokenUsage = undefined;
      await this.save(session);
    });
  }

  async changeChairContext(sessionId: string, mode: 'clean' | 'summary') {
    return this.withMutationLock(sessionId, async () => {
      const { changeConvectionChairContext } = await import('./chair-context.js');
      return changeConvectionChairContext(this.dataDir, await this.require(sessionId),
        mode, next => this.save(next));
    });
  }

  async resetContext(
    sessionId: string,
    mode: 'clean' | 'summary',
  ): Promise<ResetConvectionContextResult> {
    return this.withMutationLock(sessionId, () => this.resetLocked(sessionId, mode));
  }

  private async resetLocked(sessionId: string, mode: 'clean' | 'summary'):
    Promise<ResetConvectionContextResult> {
    const session = await this.require(sessionId);
    const state = session.compactState ?? { disabled: false, archiveSeq: 0 };
    const archive = await prepareCompactionArchive(state, {
      archiveDir: path.join(sessionWorkspace(this.dataDir, session.id), 'bak'),
      fileName: sequence => `${String(sequence).padStart(3, '0')}.json`,
      payload: {
        publicMessages: session.publicMessages,
        chairMessages: session.chairMessages,
        chairActiveContext: session.chairActiveContext,
      },
    });
    if (!archive.ok) throw archiveFailed(archive.error);
    // Archive may already exist when summarization fails. Persist its sequence while
    // retaining both active histories so another attempt cannot overwrite the archive.
    session.compactState = state;
    await this.save(session);
    const summary = mode === 'summary' ? (await this.summarize(session)).trim() : undefined;
    if (mode === 'summary' && !summary) throw new Error('会议压缩摘要为空，已保留原会话');
    session.publicMessages = summary ? [{
      speaker: '系统', content: `[会话归档摘要]\n\n${summary}`, timestamp: Date.now(),
    }] : [];
    if (mode === 'clean') session.chairMessages = [];
    clearConvectionChairContext(session);
    session.tokenUsage = undefined;
    session.publicLatestTokenUsage = undefined;
    session.publicUsageIncomplete = undefined;
    session.chairTokenUsage = undefined;
    session.compactState = state;
    await this.save(session);
    return {
      ok: true, mode, archived: `${String(archive.sequence).padStart(3, '0')}.json`,
      ...(summary ? { summary } : {}),
      summaryFailed: false,
    };
  }
}

function identifiers(value: unknown, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw invalidInput('参与者列表无效');
  }
  const result = value.map(identifier);
  if (new Set(result).size !== result.length) throw invalidInput('参与者不能重复');
  return result;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw invalidInput('标识无效');
  }
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw invalidInput('文本无效');
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}

function messageIndex(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw invalidInput('消息索引无效');
  return value as number;
}

function sameMembers(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every(id => right.includes(id));
}

function invalidInput(message: string): never {
  throw frameworkError({ code: 'CONVECTION_SESSION_INPUT_INVALID', kind: 'validation', message,
    source: 'convection.sessions', retryable: false });
}

function sessionNotFound(sessionId: string) {
  return frameworkError({ code: 'CONVECTION_SESSION_NOT_FOUND', kind: 'not_found',
    message: '对流会话不存在', source: 'convection.sessions', retryable: false,
    details: { sessionId } });
}

function messageNotFound(index: number) {
  return frameworkError({ code: 'CONVECTION_MESSAGE_NOT_FOUND', kind: 'not_found',
    message: '对流消息不存在', source: 'convection.sessions', retryable: false,
    details: { index } });
}

function archiveFailed(cause: Error) {
  return frameworkError({ code: 'CONVECTION_ARCHIVE_FAILED', kind: 'io',
    message: '对流会话归档失败，重置已中止', source: 'convection.sessions', retryable: false,
  }, { cause });
}
