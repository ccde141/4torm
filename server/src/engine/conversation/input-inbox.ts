import { FrameworkError, type FrameworkErrorKind } from '../shared/framework-error.js';

export interface HumanInput {
  id: string;
  content: string;
}

/** Receipt means durably received, not model delivery or successful execution. */
export interface InputReceipt extends HumanInput {
  runId: string;
  sequence: number;
  receivedAt: string;
}

export function inputError(code: string, kind: FrameworkErrorKind, message: string): FrameworkError {
  return new FrameworkError({ code, kind, message: `${code}: ${message}`,
    source: 'conversation.input', retryable: false });
}

export function validateHumanInput(value: unknown): HumanInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw inputError('INPUT_INVALID', 'validation', '插话必须是消息对象');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'id' && key !== 'content')
    || typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)
    || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 32_000) {
    throw inputError('INPUT_INVALID', 'validation', '插话标识或正文无效（正文上限 32000 字符）');
  }
  return { id: input.id, content: input.content };
}

/** One execution owns one inbox. No polling, model calls, history writes or automatic replay. */
export class ConversationInputInbox {
  private accepting = true;
  private sequence = 0;
  private reserved = 0;
  private pending: InputReceipt[] = [];
  private readonly submissions = new Map<string, { content: string; result: Promise<InputReceipt> }>();
  private writes: Promise<void> = Promise.resolve();
  private closing?: Promise<InputReceipt[]>;

  constructor(
    readonly runId: string,
    private readonly persist: (receipt: InputReceipt) => Promise<void>,
    private readonly limits = { pending: 32, total: 512 },
  ) {}

  async submit(value: unknown): Promise<InputReceipt> {
    const input = validateHumanInput(value);
    const previous = this.submissions.get(input.id);
    if (previous) {
      if (previous.content !== input.content) {
        throw inputError('INPUT_ID_CONFLICT', 'conflict', '相同插话 ID 不能提交不同内容');
      }
      return { ...await previous.result };
    }
    this.assertCapacity();
    this.reserved++;
    const receipt: InputReceipt = { ...input, runId: this.runId,
      sequence: ++this.sequence, receivedAt: new Date().toISOString() };
    const result = this.writes.then(async () => {
      await this.persist({ ...receipt });
      this.pending.push(receipt);
      return receipt;
    });
    // A persistence failure fences later writes too; it must never become a successful acknowledgement.
    this.writes = result.then(() => {});
    void this.writes.catch(() => {}); // callers/close receive the original rejection, no unhandled tail
    this.submissions.set(input.id, { content: input.content, result });
    return { ...await result };
  }

  private assertCapacity(): void {
    if (!this.accepting) throw inputError('INPUT_RUN_CLOSED', 'conflict', '当前执行已停止接收插话');
    if (this.reserved >= this.limits.pending) {
      throw inputError('INPUT_QUEUE_FULL', 'conflict', '待处理插话已达到上限');
    }
    if (this.sequence >= this.limits.total) {
      throw inputError('INPUT_RUN_LIMIT', 'conflict', '本次执行接收的插话已达到上限');
    }
  }

  hasPending(): boolean { return this.accepting && this.pending.length > 0; }

  /** Sole loop writer takes an ordered batch. Caller owns its context/checkpoint acknowledgement. */
  drain(): InputReceipt[] {
    if (!this.accepting) return [];
    const batch = this.pending.splice(0);
    this.reserved -= batch.length;
    return batch.map(receipt => ({ ...receipt }));
  }

  /** Fence synchronously; return unconsumed messages after in-flight acceptance finishes. */
  async close(): Promise<InputReceipt[]> {
    this.accepting = false;
    this.closing ??= this.writes.then(() => this.pending.map(receipt => ({ ...receipt })));
    return (await this.closing).map(receipt => ({ ...receipt }));
  }
}
