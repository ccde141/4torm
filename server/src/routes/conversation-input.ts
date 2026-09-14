import type { FastifyInstance } from 'fastify';
import type { SessionRunner } from '../engine/conversation/session-runner.js';
import { inputError, validateHumanInput } from '../engine/conversation/input-inbox.js';
import { readInputJournal, type InputOwner } from '../engine/conversation/input-journal.js';
import { FrameworkError } from '../engine/shared/framework-error.js';

export function validateInputRunId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw inputError('INPUT_INVALID', 'validation', '执行标识无效');
  }
  return value;
}

function ownerFrom(value: unknown): InputOwner {
  if (!value || typeof value !== 'object') throw inputError('INPUT_INVALID', 'validation', '缺少会话标识');
  const data = value as Record<string, unknown>;
  for (const field of ['agentId', 'sessionId', 'runId']) {
    if (typeof data[field] !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(data[field])) {
      throw inputError('INPUT_INVALID', 'validation', '会话或执行标识无效');
    }
  }
  return { agentId: data.agentId as string, sessionId: data.sessionId as string, runId: data.runId as string };
}

export function registerConversationInput(
  app: FastifyInstance, dataDir: string,
  findRunner: (sessionId: string) => Pick<SessionRunner, 'isBusy' | 'getAgentId' | 'getInputRuntime'> | undefined,
): void {
  app.post('/input', async request => {
    const owner = ownerFrom(request.body);
    const body = request.body as Record<string, unknown>;
    if (Object.keys(body).some(key => !['agentId', 'sessionId', 'runId', 'id', 'content'].includes(key))) {
      throw inputError('INPUT_INVALID', 'validation', '插话不能携带额外字段');
    }
    const input = validateHumanInput({ id: body.id, content: body.content });
    const runner = findRunner(owner.sessionId);
    const runtime = runner?.getInputRuntime();
    if (runner?.isBusy() && runner.getAgentId() === owner.agentId && runtime?.owner.runId === owner.runId) {
      try { return { receipt: await runtime.submit(input) }; }
      catch (error) {
        if (!(error instanceof FrameworkError) || error.data.code !== 'INPUT_RUN_CLOSED') throw error;
        return { disposition: 'next-turn' };
      }
    }
    const journal = await readInputJournal(dataDir, owner);
    const receipt = journal.entries.find(entry => entry.id === input.id);
    if (receipt) {
      if (receipt.content !== input.content) throw inputError('INPUT_ID_CONFLICT', 'conflict', '相同插话 ID 不能提交不同内容');
      return { receipt };
    }
    if (journal.checkpoint?.closed) return { disposition: 'next-turn' };
    throw inputError('INPUT_RUN_MISMATCH', 'conflict', '执行不属于此会话或尚未就绪，消息未提交');
  });
  app.get('/input', async request => {
    const owner = ownerFrom(request.query);
    const journal = await readInputJournal(dataDir, owner);
    const runner = findRunner(owner.sessionId);
    const active = runner?.isBusy() === true && runner.getAgentId() === owner.agentId
      && runner.getInputRuntime()?.owner.runId === owner.runId;
    return { ...journal, active };
  });
}
