export interface ProviderLease {
  release(): void;
}

interface Waiter {
  resolve: (lease: ProviderLease) => void;
  reject: (reason: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface ProviderState {
  active: number;
  limit: number;
  queue: Waiter[];
}

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`Provider concurrency limit must be a positive integer, received ${limit}`);
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('LLM request was aborted while waiting for provider capacity');
}

export class ProviderScheduler {
  private readonly states = new Map<string, ProviderState>();

  acquire(providerId: string, limit: number, signal?: AbortSignal): Promise<ProviderLease> {
    if (!providerId.trim()) throw new Error('Provider id is required for scheduling');
    validateLimit(limit);
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    const state = this.getState(providerId, limit);
    return new Promise<ProviderLease>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => this.abortWaiter(providerId, state, waiter);
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      state.queue.push(waiter);
      this.drain(providerId, state);
    });
  }

  async run<T>(
    providerId: string,
    limit: number,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const lease = await this.acquire(providerId, limit, signal);
    try {
      return await operation();
    } finally {
      lease.release();
    }
  }

  private getState(providerId: string, limit: number): ProviderState {
    const existing = this.states.get(providerId);
    if (existing) {
      existing.limit = limit;
      this.drain(providerId, existing);
      return existing;
    }
    const created: ProviderState = { active: 0, limit, queue: [] };
    this.states.set(providerId, created);
    return created;
  }

  private drain(providerId: string, state: ProviderState): void {
    while (state.active < state.limit && state.queue.length > 0) {
      const waiter = state.queue.shift();
      if (!waiter) break;
      this.detachAbort(waiter);
      if (waiter.signal?.aborted) {
        waiter.reject(abortReason(waiter.signal));
        continue;
      }
      state.active += 1;
      waiter.resolve(this.createLease(providerId, state));
    }
    this.cleanup(providerId, state);
  }

  private createLease(providerId: string, state: ProviderState): ProviderLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        state.active -= 1;
        this.drain(providerId, state);
      },
    };
  }

  private abortWaiter(providerId: string, state: ProviderState, waiter: Waiter): void {
    const index = state.queue.indexOf(waiter);
    if (index < 0) return;
    state.queue.splice(index, 1);
    this.detachAbort(waiter);
    waiter.reject(abortReason(waiter.signal as AbortSignal));
    this.cleanup(providerId, state);
  }

  private detachAbort(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
  }

  private cleanup(providerId: string, state: ProviderState): void {
    if (state.active === 0 && state.queue.length === 0) {
      this.states.delete(providerId);
    }
  }
}

export const providerScheduler = new ProviderScheduler();
