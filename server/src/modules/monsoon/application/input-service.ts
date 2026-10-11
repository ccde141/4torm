import { FrameworkError, frameworkError } from '../../../engine/shared/framework-error.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { MonsoonInputReceipt, MonsoonTurn } from '../runtime/turn-contract.js';

export interface MonsoonInputOwner {
  agentId: string;
  sessionId: string;
  runId: string;
}

export interface MonsoonHumanInput { id: string; content: string }

export interface MonsoonInputJournal {
  entries: MonsoonInputReceipt[];
  checkpoint?: { context: ContextMessage[]; includedIds: string[]; closed: boolean };
}

export interface MonsoonInputJournalPort {
  validate(value: unknown): MonsoonHumanInput;
  read(owner: MonsoonInputOwner): Promise<MonsoonInputJournal>;
}

type InputRunner = Pick<MonsoonTurn, 'isBusy' | 'getAgentId' | 'getInputRuntime'>;

export class MonsoonInputService {
  constructor(
    private readonly findRunner: (sessionId: string) => InputRunner | undefined,
    private readonly journal: MonsoonInputJournalPort,
  ) {}

  async submit(owner: MonsoonInputOwner, value: unknown) {
    const input = this.journal.validate(value);
    const runner = this.findRunner(owner.sessionId);
    const runtime = runner?.getInputRuntime();
    if (runner?.isBusy() && runner.getAgentId() === owner.agentId
      && runtime?.owner.runId === owner.runId) {
      try { return { receipt: await runtime.submit(input) }; }
      catch (error) {
        if (!(error instanceof FrameworkError) || error.data.code !== 'INPUT_RUN_CLOSED') throw error;
        return { disposition: 'next-turn' as const };
      }
    }
    const journal = await this.journal.read(owner);
    const receipt = journal.entries.find(entry => entry.id === input.id);
    if (receipt) {
      if (receipt.content !== input.content) {
        throw monsoonInputError('INPUT_ID_CONFLICT', 'conflict',
          '相同插话 ID 不能提交不同内容');
      }
      return { receipt };
    }
    if (journal.checkpoint?.closed) return { disposition: 'next-turn' as const };
    throw monsoonInputError('INPUT_RUN_MISMATCH', 'conflict',
      '执行不属于此会话或尚未就绪，消息未提交');
  }

  async inspect(owner: MonsoonInputOwner) {
    const journal = await this.journal.read(owner);
    const runner = this.findRunner(owner.sessionId);
    const active = runner?.isBusy() === true && runner.getAgentId() === owner.agentId
      && runner.getInputRuntime()?.owner.runId === owner.runId;
    return { ...journal, active };
  }
}

export function monsoonInputError(
  code: string,
  kind: 'validation' | 'conflict',
  message: string,
) {
  return frameworkError({
    code, kind, message: `${code}: ${message}`,
    source: 'conversation.input', retryable: false,
  });
}
