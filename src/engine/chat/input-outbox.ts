import type { InputDeliveryState, InputSubmission } from './input-submission';

export interface PendingInput { input: InputSubmission; state: InputDeliveryState; error?: string }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
const keyFor = (id: string) => `conversation.input.pending.${id}`;
const states = new Set(['sending', 'received', 'queued', 'included', 'continued', 'retained']);

export class InputOutbox {
  private readonly storage: Storage;
  constructor(storage: Storage) { this.storage = storage; }

  read(sessionId: string): PendingInput[] {
    const raw = this.storage.getItem(keyFor(sessionId));
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) throw new Error('Invalid saved inputs');
    return values.map(value => {
      if (!value || typeof value !== 'object' || !value.input || value.input.sessionId !== sessionId
        || !['agentId', 'runId', 'id', 'content'].every(key => typeof value.input[key] === 'string')
        || !states.has(value.state)) throw new Error('Invalid saved input');
      return value as PendingInput;
    });
  }

  put(value: PendingInput): void {
    const entries = this.read(value.input.sessionId).filter(entry => entry.input.id !== value.input.id);
    entries.push(value);
    this.storage.setItem(keyFor(value.input.sessionId), JSON.stringify(entries));
  }

  remove(sessionId: string, id: string): void {
    const entries = this.read(sessionId).filter(entry => entry.input.id !== id);
    if (entries.length) this.storage.setItem(keyFor(sessionId), JSON.stringify(entries));
    else this.storage.removeItem(keyFor(sessionId));
  }
}
