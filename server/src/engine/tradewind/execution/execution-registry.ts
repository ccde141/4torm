import { frameworkError } from '../../shared/framework-error.js';

/** Node IDs are graph-local. A legacy lookup is safe only when it has one match. */
export class ExecutionRegistry<T> {
  private readonly scopes = new Map<string, Map<string, T>>();
  constructor(private readonly identify: (value: T) => string) {}

  set(nodeId: string, value: T, executionId = this.identify(value)): this {
    const entries = this.scopes.get(executionId) ?? new Map<string, T>();
    entries.set(nodeId, value);
    this.scopes.set(executionId, entries);
    return this;
  }

  get(nodeId: string, executionId?: string): T | undefined {
    if (executionId !== undefined) return this.scopes.get(executionId)?.get(nodeId);
    const matches = [...this.scopes.values()].filter(entries => entries.has(nodeId));
    if (matches.length > 1) throw executionIdentityRequired();
    return matches[0]?.get(nodeId);
  }

  delete(nodeId: string, executionId?: string): boolean {
    const value = this.get(nodeId, executionId);
    if (!value) return false;
    const scope = executionId ?? this.identify(value);
    const entries = this.scopes.get(scope)!;
    const deleted = entries.delete(nodeId);
    if (!entries.size) this.scopes.delete(scope);
    return deleted;
  }

  has(nodeId: string, executionId?: string): boolean { return this.get(nodeId, executionId) !== undefined; }
  clear(executionId?: string): void {
    if (executionId === undefined) this.scopes.clear();
    else this.scopes.delete(executionId);
  }
  get size(): number { return [...this.scopes.values()].reduce((sum, entries) => sum + entries.size, 0); }
  *entries(executionId?: string): IterableIterator<[string, T]> {
    if (executionId !== undefined) { yield* this.scopes.get(executionId)?.entries() ?? []; return; }
    for (const entries of this.scopes.values()) yield* entries;
  }
  *values(executionId?: string): IterableIterator<T> { for (const [, value] of this.entries(executionId)) yield value; }
  *keys(executionId?: string): IterableIterator<string> { for (const [key] of this.entries(executionId)) yield key; }
  [Symbol.iterator](): IterableIterator<[string, T]> { return this.entries(); }
}

export function executionIdentityRequired() {
  return frameworkError({ code: 'TRADEWIND_EXECUTION_REQUIRED', kind: 'conflict',
    message: '多个信风执行同时存在，请指定 executionId 后重试',
    source: 'tradewind.execution', retryable: false });
}
