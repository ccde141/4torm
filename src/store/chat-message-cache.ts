import type { ChatMessage } from '../types';

interface CacheBudget {
  maxEntries: number;
  maxBytes: number;
  maxEntryBytes: number;
}

const DEFAULT_BUDGET: CacheBudget = {
  maxEntries: 8, maxBytes: 16 * 1024 * 1024, maxEntryBytes: 4 * 1024 * 1024,
};

/** Reloadable message snapshots only; active executions and persisted history have other owners. */
export class ChatMessageCache {
  private readonly entries = new Map<string, { messages: ChatMessage[]; bytes: number }>();
  private readonly budget: CacheBudget;
  private bytes = 0;

  constructor(budget: Partial<CacheBudget> = {}) {
    this.budget = { ...DEFAULT_BUDGET, ...budget };
  }

  get(sessionId: string): ChatMessage[] | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) return undefined;
    this.entries.delete(sessionId);
    this.entries.set(sessionId, entry);
    return structuredClone(entry.messages);
  }

  set(sessionId: string, messages: ChatMessage[]): void {
    this.delete(sessionId);
    if (!messages.length) return;
    const ceiling = Math.min(this.budget.maxEntryBytes, this.budget.maxBytes);
    const bytes = snapshotBytes(messages, ceiling);
    if (bytes > ceiling) return;
    while (this.entries.size >= this.budget.maxEntries || this.bytes + bytes > this.budget.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.delete(oldest);
    }
    this.entries.set(sessionId, { messages: structuredClone(messages), bytes });
    this.bytes += bytes;
  }

  delete(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(sessionId);
  }
}

/** Stop sizing at the admission limit without allocating another serialized copy of large histories. */
function snapshotBytes(value: unknown, ceiling: number): number {
  const seen = new WeakSet<object>();
  const pending: unknown[] = [value];
  let bytes = 0;
  while (pending.length && bytes <= ceiling) {
    const current = pending.pop();
    if (typeof current === 'string') { bytes += current.length * 2 + 24; continue; }
    if (!current || typeof current !== 'object') { bytes += 8; continue; }
    if (seen.has(current)) continue;
    seen.add(current);
    bytes += 64;
    for (const key of Object.keys(current)) {
      bytes += key.length * 2 + 16;
      if (bytes > ceiling) break;
      pending.push((current as Record<string, unknown>)[key]);
    }
  }
  return bytes;
}
