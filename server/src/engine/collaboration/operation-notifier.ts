import type { OperationIdentity } from './contracts.js';

export class OperationNotifier {
  private readonly listeners = new Map<string, Set<() => void>>();

  subscribe(identity: OperationIdentity, listener: () => void): () => void {
    const key = identityKey(identity);
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(key);
    };
  }

  publish(identity: OperationIdentity): void {
    for (const listener of [...(this.listeners.get(identityKey(identity)) ?? [])]) listener();
  }
}

function identityKey(identity: OperationIdentity): string {
  return `${identity.operationId.length}:${identity.operationId}${identity.runId}`;
}
