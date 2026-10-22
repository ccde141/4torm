import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { MonsoonExternalMessage, MonsoonExternalSessionPort } from '../application/external-session-port.js';
import { MonsoonContextPort } from '../application/context-port.js';
import { persistMonsoonContext } from '../application/context-images.js';
import type { MonsoonMessage, MonsoonSession, MonsoonTokenUsage } from '../domain/session.js';
import { FileMonsoonSessionRepository, SessionRevisionConflictError } from '../infrastructure/session-repository.js';
import { FileMonsoonTurnJournal } from '../infrastructure/turn-journal.js';
import { acquireMonsoonSessionLease } from './session-lease-adapter.js';
import type { CompactionCommit, CompactionReason } from '../../../engine/shared/compaction/index.js';

export function createMonsoonExternalSessionPort(dataDir: string): MonsoonExternalSessionPort {
  return new ExternalSessionAdapter(new FileMonsoonSessionRepository(dataDir),
    new FileMonsoonTurnJournal(dataDir), new MonsoonContextPort(dataDir));
}

class ExternalSessionAdapter implements MonsoonExternalSessionPort {
  readonly acquire = acquireMonsoonSessionLease;
  constructor(private readonly sessions: FileMonsoonSessionRepository,
    private readonly journal: FileMonsoonTurnJournal, private readonly context: MonsoonContextPort) {}

  read(agentId: string, sessionId: string) { return this.sessions.get(agentId, sessionId); }
  activeContext(session: MonsoonSession) { return this.context.modelContext(session); }
  archive(agentId: string, sessionId: string, context: ContextMessage[], reason: CompactionReason) {
    return this.context.archive(agentId, sessionId, context, reason);
  }

  async commitCompaction(agentId: string, sessionId: string, expectedRevision: number,
    plan: CompactionCommit, signal?: AbortSignal): Promise<MonsoonSession> {
    await this.requireWritable(agentId, sessionId, expectedRevision);
    return translateConflict(() => this.context.commit(agentId, sessionId, expectedRevision, plan, 1, signal));
  }

  async list(agentId: string) {
    return (await this.sessions.list(agentId)).map(({ id, title, updatedAt, revision }) =>
      ({ id, agentId, title, updatedAt, revision }));
  }

  async append(agentId: string, sessionId: string, expectedRevision: number,
    user: MonsoonExternalMessage, assistant: MonsoonExternalMessage,
    activeContext?: ContextMessage[]): Promise<void> {
    const current = await this.requireWritable(agentId, sessionId, expectedRevision);
    const messages = activeContext ? current.messages.map(message => message.type === 'compact-marker'
      ? { ...message, contextOmitted: true } : message) : current.messages;
    const userMessage = externalMessage(user, 'user');
    const assistantMessage = externalMessage(assistant, 'assistant');
    if (activeContext) {
      userMessage.contextOmitted = true;
      assistantMessage.contextExact = true;
      assistantMessage.nativeContext = persistMonsoonContext(activeContext);
    }
    await translateConflict(() => this.sessions.replace({ ...current,
      messages: [...messages, userMessage, assistantMessage] }, expectedRevision, 'content'));
  }

  async recordUsage(agentId: string, sessionId: string, expectedRevision: number,
    usage: MonsoonTokenUsage | null): Promise<MonsoonSession> {
    await this.requireWritable(agentId, sessionId, expectedRevision);
    return translateConflict(() => this.sessions.updateTokenUsage(agentId, sessionId, usage, expectedRevision));
  }

  private async requireWritable(agentId: string, sessionId: string, revision: number) {
    const current = await this.sessions.get(agentId, sessionId);
    if (!current) throw portError('MONSOON_EXTERNAL_SESSION_NOT_FOUND', 'not_found', '指定季风会话不存在');
    if (current.revision !== revision) throw changed();
    if (await this.journal.hasUnabsorbed(agentId, sessionId, current.messages)) {
      throw portError('MONSOON_EXTERNAL_SESSION_UNCOMMITTED_RUN', 'conflict',
        '指定季风会话仍有未保存的回复，本次未写入');
    }
    return current;
  }
}

function externalMessage(message: MonsoonExternalMessage, role: 'user' | 'assistant'): MonsoonMessage {
  if (typeof message.timestamp !== 'string') throw new Error('追加季风消息缺少时间戳');
  return { ...message, role, timestamp: message.timestamp,
    ...(message.nativeContext ? { nativeContext: persistMonsoonContext(message.nativeContext) } : {}) };
}

async function translateConflict<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { if (error instanceof SessionRevisionConflictError) throw changed(); throw error; }
}

function changed() {
  return portError('MONSOON_EXTERNAL_SESSION_CHANGED', 'conflict', '指定季风会话已发生变化，本次未写入');
}

function portError(code: string, kind: 'not_found' | 'conflict', message: string) {
  return frameworkError({ code, kind, message, source: 'monsoon.external-session', retryable: false });
}
