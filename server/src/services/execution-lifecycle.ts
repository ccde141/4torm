import type { ObservationScope } from './execution-observation-contract.js';

type ExecutionOwner = {
  id: string;
  scope: ObservationScope;
  ownerId: string;
};

type TerminationHandler = () => void | Promise<void>;

/** Holds cancellable runtime work without coupling it to persisted observations. */
export class ExecutionLifecycle {
  private readonly handlers = new Map<string, { owner: ExecutionOwner; terminate: TerminationHandler }>();

  register(owner: ExecutionOwner, terminate: TerminationHandler): () => void {
    const current = { owner, terminate };
    this.handlers.set(owner.id, current);
    return () => {
      if (this.handlers.get(owner.id) === current) this.handlers.delete(owner.id);
    };
  }

  async terminate(id: string, scope: ObservationScope, ownerId: string): Promise<boolean> {
    const current = this.handlers.get(id);
    if (!current || current.owner.scope !== scope || current.owner.ownerId !== ownerId) return false;
    this.handlers.delete(id);
    await current.terminate();
    return true;
  }
}

export const executionLifecycle = new ExecutionLifecycle();
