import { ConversationInputInbox, type InputReceipt } from './input-inbox.js';
import { appendConversationInput, saveInputCheckpoint, type InputCheckpoint, type InputOwner } from './input-journal.js';
import type { ContextMessage } from '../shared/types.js';
import type { ReActSteering } from '../shared/react/steering.js';

export type ConversationInputEvent =
  | { type: 'input-ready'; runId: string }
  | { type: 'input-received'; receipt: InputReceipt }
  | { type: 'input-context'; runId: string; checkpoint: InputCheckpoint }
  | { type: 'input-closed'; runId: string; retained: InputReceipt[] }
  | { type: 'input-skipped'; tool: string; reason: string };

/** One interactive run, never shared with Tide or another session/ask-resume execution. */
export class ConversationInputRuntime {
  private readonly inbox: ConversationInputInbox;
  private messages: ContextMessage[] = [];
  private start = 0;
  private dirty = false;
  private includedIds: string[] = [];
  private closing?: Promise<InputReceipt[]>;
  readonly steering: ReActSteering;

  constructor(private readonly dataDir: string, readonly owner: InputOwner,
    private readonly emit: (event: ConversationInputEvent) => void) {
    this.inbox = new ConversationInputInbox(owner.runId, receipt => appendConversationInput(dataDir, owner, receipt));
    this.steering = {
      hasPending: () => this.inbox.hasPending(),
      drain: () => {
        const batch = this.inbox.drain();
        this.includedIds.push(...batch.map(receipt => receipt.id));
        this.dirty ||= batch.length > 0;
        return batch.map(receipt => receipt.content);
      },
      onSkipped: (tool, reason) => emit({ type: 'input-skipped', tool, reason }),
    };
  }

  bind(messages: ContextMessage[]): void {
    this.messages = messages;
    this.start = messages.length;
    this.emit({ type: 'input-ready', runId: this.owner.runId });
  }

  async submit(value: unknown): Promise<InputReceipt> {
    const receipt = await this.inbox.submit(value);
    this.emit({ type: 'input-received', receipt });
    return receipt;
  }

  async beforeModel(): Promise<void> {
    if (!this.dirty) return;
    await this.checkpoint(false);
    this.dirty = false;
  }

  /** The owner saved the compacted prefix; future checkpoints contain only new work. */
  rebase(start: number): void {
    this.start = start;
  }

  stop(): void {
    this.closing ??= this.inbox.close();
    void this.closing.catch(() => {});
  }

  async finish(): Promise<void> {
    this.stop();
    const retained = await this.closing!;
    await this.checkpoint(true);
    this.emit({ type: 'input-closed', runId: this.owner.runId, retained });
  }

  private async checkpoint(closed: boolean): Promise<void> {
    const checkpoint: InputCheckpoint = {
      context: snapshotContext(this.messages.slice(this.start)),
      includedIds: [...this.includedIds], closed,
    };
    await saveInputCheckpoint(this.dataDir, this.owner, checkpoint);
    this.emit({ type: 'input-context', runId: this.owner.runId, checkpoint });
  }
}

/** Snapshot-only completion: a suspended/aborted tool must not become an orphan on reload. */
export function snapshotContext(messages: ContextMessage[]): ContextMessage[] {
  const context = structuredClone(messages);
  for (let index = 0; index < context.length; index++) {
    const calls = context[index].toolCalls;
    if (!calls?.length) continue;
    let end = index + 1;
    while (context[end]?.role === 'tool') end++;
    const completed = new Set(context.slice(index + 1, end).map(message => message.toolCallId));
    const missing = calls.filter(call => !completed.has(call.id)).map(call => ({
      role: 'tool' as const, toolCallId: call.id,
      content: '[Not completed in this execution segment; await explicit human continuation.]',
    }));
    context.splice(end, 0, ...missing);
    index = end + missing.length - 1;
  }
  return context;
}
