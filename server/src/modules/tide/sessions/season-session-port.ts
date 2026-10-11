import { frameworkError } from '../../../engine/shared/framework-error.js';
import { FileMonsoonSessionRepository,
  SessionRevisionConflictError } from '../../monsoon/infrastructure/session-repository.js';
import { FileMonsoonTurnJournal } from '../../monsoon/infrastructure/turn-journal.js';
import type { TideMessage, TideSession } from './session-types.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import { MonsoonContextPort, persistMonsoonContext } from '../../monsoon/public.js';
import type { ContextMessage } from '../../../engine/shared/types.js';

/** The sole Tide-to-Monsoon persistence adapter. Other Tide code uses this narrow port. */
export class SeasonSessionPort {
  private readonly sessions: FileMonsoonSessionRepository;
  private readonly journal: FileMonsoonTurnJournal;
  private readonly context: MonsoonContextPort;
  constructor(dataDir: string) {
    this.sessions = new FileMonsoonSessionRepository(dataDir);
    this.journal = new FileMonsoonTurnJournal(dataDir);
    this.context = new MonsoonContextPort(dataDir);
  }

  read(agentId: string, sessionId: string): Promise<TideSession | null> {
    return this.sessions.get(agentId, sessionId);
  }

  activeContext(session: TideSession): Promise<ContextMessage[]> {
    const messages = session.messages.map(message => {
      if (typeof message.timestamp !== 'string') throw new Error('指定季风会话缺少消息时间戳');
      return { ...message, role: seasonRole(message.role), timestamp: message.timestamp };
    });
    return this.context.modelContext({ id: session.id, agentId: session.agentId, messages });
  }

  async list(agentId: string) {
    const all = await this.sessions.list(agentId);
    return all.map(session => ({ id: session.id, agentId: session.agentId,
      title: session.title, updatedAt: session.updatedAt, revision: session.revision }));
  }

  async append(
    agentId: string, sessionId: string, expectedRevision: number,
    user: TideMessage, assistant: TideMessage,
    activeContext?: ContextMessage[],
  ): Promise<void> {
    const current = await this.sessions.get(agentId, sessionId);
    if (!current) throw portError('TIDE_TARGET_SESSION_NOT_FOUND', 'not_found',
      '指定季风会话不存在');
    if (current.revision !== expectedRevision) throw portError(
      'TIDE_TARGET_SESSION_CHANGED', 'conflict', '指定季风会话已发生变化，本次未追加');
    if (await this.journal.hasUnabsorbed(agentId, sessionId, current.messages)) {
      throw portError('TIDE_TARGET_SESSION_UNCOMMITTED_RUN', 'conflict',
        '指定季风会话仍有未保存的回复，本次未追加');
    }
    try {
      const messages = activeContext ? current.messages.map(message => message.type === 'compact-marker'
        ? { ...message, contextOmitted: true } : message) : current.messages;
      await this.sessions.replace({ ...current, messages: [...messages,
        { ...user, role: 'user', ...(activeContext ? { contextOmitted: true } : {}) },
        { ...assistant, role: 'assistant', ...(activeContext ? { contextExact: true,
          nativeContext: persistMonsoonContext(activeContext) } : {}) }] },
      expectedRevision, 'content');
    } catch (error) {
      if (error instanceof SessionRevisionConflictError) throw portError(
        'TIDE_TARGET_SESSION_CHANGED', 'conflict', '指定季风会话已发生变化，本次未追加');
      throw error;
    }
  }

  async recordUsage(
    agentId: string, sessionId: string, expectedRevision: number,
    usage: TokenUsage | null,
  ): Promise<TideSession> {
    const current = await this.sessions.get(agentId, sessionId);
    if (!current) throw portError('TIDE_TARGET_SESSION_NOT_FOUND', 'not_found',
      '指定季风会话不存在');
    if (current.revision !== expectedRevision) throw portError(
      'TIDE_TARGET_SESSION_CHANGED', 'conflict', '指定季风会话已发生变化，本次未更新用量');
    if (await this.journal.hasUnabsorbed(agentId, sessionId, current.messages)) {
      throw portError('TIDE_TARGET_SESSION_UNCOMMITTED_RUN', 'conflict',
        '指定季风会话仍有未保存的回复，本次未更新用量');
    }
    try {
      return await this.sessions.updateTokenUsage(agentId, sessionId, usage, expectedRevision);
    } catch (error) {
      if (error instanceof SessionRevisionConflictError) throw portError(
        'TIDE_TARGET_SESSION_CHANGED', 'conflict', '指定季风会话已发生变化，本次未更新用量');
      throw error;
    }
  }
}

function seasonRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  throw new Error('指定季风会话包含无效消息类型');
}

function portError(code: string, kind: 'not_found' | 'conflict', message: string) {
  return frameworkError({ code, kind, message,
    source: 'tide.season-session-port', retryable: false });
}
