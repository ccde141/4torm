import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { MonsoonEvent, MonsoonTurn } from '../runtime/turn-contract.js';
import type { TokenUsage } from '../../../engine/shared/llm-bridge.js';
import type { ModelRequestUsage } from '../../../engine/shared/model-request-usage.js';
import type {
  MonsoonChatInput, MonsoonChatPreparation, PreparedMonsoonChat,
} from './chat-preparation.js';

interface TurnRuntimePort {
  trackPreparation<T>(work: () => Promise<T>): Promise<T>;
  get(sessionId: string): MonsoonTurn | undefined;
  getWaitingRunId(sessionId: string, runner: MonsoonTurn): string | undefined;
  claimResume(sessionId: string, runner: MonsoonTurn): boolean;
  fail(sessionId: string, runner: MonsoonTurn, runId?: string,
    failure?: { code?: string; message?: string }): void | Promise<void>;
}

interface TurnSessionPort {
  get(agentId: string, sessionId: string): Promise<{ messageRevision: number } | null>;
  updateTokenUsage(agentId: string, sessionId: string, usage: TokenUsage | null): Promise<unknown>;
  updateModelUsage?(agentId: string, sessionId: string, request: ModelRequestUsage): Promise<unknown>;
}

interface TurnJournalPort {
  begin(agentId: string, sessionId: string, runId: string, revision: number): Promise<{
    append(event: unknown): Promise<void>;
  }>;
}

export interface MonsoonTurnServicePorts {
  chat: Pick<MonsoonChatPreparation, 'prepare'>;
  runtime: TurnRuntimePort;
  sessions: TurnSessionPort;
  journal: TurnJournalPort;
}

export interface MonsoonTurnExecution {
  sessionId: string;
  runId: string;
  agentId: string;
  runner: MonsoonTurn;
  record(event: MonsoonEvent): Promise<void>;
  execute(emit: (event: MonsoonEvent) => void): Promise<unknown>;
  replyAcceptance?: Extract<MonsoonEvent, { type: 'reply-accepted' }>;
  description?: { agentName: string; model: string; native: boolean };
}

export class MonsoonTurnService {
  constructor(private readonly ports: MonsoonTurnServicePorts) {}

  start(input: MonsoonChatInput & { inputRunId: string }): Promise<MonsoonTurnExecution> {
    return this.ports.runtime.trackPreparation(() => this.prepareStart(input));
  }

  private async prepareStart(input: MonsoonChatInput & { inputRunId: string }): Promise<MonsoonTurnExecution> {
    const prepared = await this.ports.chat.prepare(input);
    const execution = await this.begin(prepared.agentId, input.sessionId, input.inputRunId,
      prepared.runner);
    return {
      ...execution,
      description: {
        agentName: prepared.agentName, model: prepared.effectiveModel, native: prepared.native,
      },
      execute: emit => prepared.runner.chat(
        prepared.systemPrompt, prepared.chatMessages, emit, input.inputRunId,
      ),
    };
  }

  resume(
    sessionId: string, runId: string, answer: string, expectedWaitingRunId: string,
  ): Promise<MonsoonTurnExecution> {
    return this.ports.runtime.trackPreparation(() =>
      this.prepareResume(sessionId, runId, answer, expectedWaitingRunId));
  }

  private async prepareResume(
    sessionId: string, runId: string, answer: string, expectedWaitingRunId: string,
  ): Promise<MonsoonTurnExecution> {
    const runner = this.ports.runtime.get(sessionId);
    if (!runner) throw turnError('MONSOON_SESSION_NOT_ACTIVE', 'not_found', '会话不存在或已结束');
    if (!runner.isSuspended()) {
      throw turnError('MONSOON_SESSION_NOT_SUSPENDED', 'conflict', '会话未处于挂起状态');
    }
    if (!expectedWaitingRunId
      || this.ports.runtime.getWaitingRunId(sessionId, runner) !== expectedWaitingRunId) {
      throw turnError('MONSOON_RUN_MISMATCH', 'conflict', '目标提问已经被更新');
    }
    if (!this.ports.runtime.claimResume(sessionId, runner)) {
      throw turnError('MONSOON_SESSION_BUSY', 'conflict', '会话正在执行中');
    }
    const execution = await this.begin(runner.getAgentId(), sessionId, runId, runner);
    return { ...execution,
      replyAcceptance: { type: 'reply-accepted', waitingRunId: expectedWaitingRunId, answer },
      execute: emit => runner.resume(answer, emit, runId) };
  }

  private async begin(
    agentId: string,
    sessionId: string,
    runId: string,
    runner: MonsoonTurn,
  ): Promise<Omit<MonsoonTurnExecution, 'execute'>> {
    try {
      const session = await this.ports.sessions.get(agentId, sessionId);
      if (!session) throw new Error('会话不存在');
      const writer = await this.ports.journal.begin(
        agentId, sessionId, runId, session.messageRevision,
      );
      return { agentId, sessionId, runId, runner, record: async event => {
        if (event.type === 'model-request') {
          await this.ports.sessions.updateModelUsage?.(agentId, sessionId, event.request);
        } else if (event.type === 'usage') {
          await this.ports.sessions.updateTokenUsage(agentId, sessionId, event.usage);
        }
        await writer.append(event);
      } };
    } catch (error) {
      await this.ports.runtime.fail(sessionId, runner, runId, {
        code: 'MONSOON_JOURNAL_START_FAILED', message: (error as Error).message,
      });
      throw error;
    }
  }
}

function turnError(
  code: string,
  kind: 'not_found' | 'conflict',
  message: string,
) {
  return frameworkError({ code, kind, message, source: 'monsoon.turn', retryable: false });
}
