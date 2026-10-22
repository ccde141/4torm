import { ClientFrameworkError } from '../../../api/error-contract';

export interface WorkflowRevisionState {
  workflowId: string;
  revision: string | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
}

export type RemoteDecision = 'ignored' | 'unchanged' | 'reload' | 'conflict';

export class WorkflowRevisionTracker {
  private readonly onChange: (state: WorkflowRevisionState) => void;
  state: WorkflowRevisionState = {
    workflowId: 'untitled', revision: null, dirty: false, saving: false, conflict: false,
  };
  private generation = 0;
  private epoch = 0;
  private active: Promise<unknown> | null = null;
  private readonly acknowledgedRevisions = new Set<string>();

  constructor(onChange: (state: WorkflowRevisionState) => void = () => {}) {
    this.onChange = onChange;
  }

  private update(patch: Partial<WorkflowRevisionState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  load(workflowId: string, revision: string | null): void {
    this.epoch += 1;
    this.generation += 1;
    this.acknowledgedRevisions.clear();
    this.update({ workflowId, revision, dirty: false, saving: false, conflict: false });
  }

  edit(): void {
    this.generation += 1;
    if (!this.state.dirty) this.update({ dirty: true });
  }

  observe(workflowId: string, revision: string | null): RemoteDecision {
    if (workflowId !== this.state.workflowId) return 'ignored';
    if (revision === this.state.revision) return 'unchanged';
    if (revision === null || this.state.dirty) {
      this.update({ conflict: true });
      return 'conflict';
    }
    return 'reload';
  }

  conflict(): void {
    this.update({ conflict: true });
  }

  canAutoSave(): boolean {
    return this.state.dirty && !this.state.saving && !this.state.conflict;
  }

  async waitForSave(): Promise<void> {
    for (let pending = this.active; pending; pending = this.active) await pending;
  }

  async observeAfterSave(workflowId: string, revision: string | null): Promise<RemoteDecision> {
    const epoch = this.epoch;
    try { await this.waitForSave(); } catch { /* 保存调用方报告原错误，仍需对账远端事实 */ }
    if (this.epoch !== epoch) return 'ignored';
    // 同一批保存的较早通知可能晚于后续回执；它仍是已经确认的自身写入。
    if (workflowId === this.state.workflowId && revision !== null
      && this.acknowledgedRevisions.has(revision)) return 'unchanged';
    return this.observe(workflowId, revision);
  }

  async saveCopy<T extends { workflowId: string }>(
    draft: T,
    write: (input: T & { expectedRevision: null }) => Promise<{ revision: string }>,
    adopt: (revision: string) => void,
  ): Promise<{ saved: boolean; adopted: boolean }> {
    const epoch = this.epoch;
    const generation = this.generation;
    return this.enqueue(async () => {
      if (this.epoch !== epoch || this.generation !== generation) return { saved: false, adopted: false };
      this.update({ saving: true });
      try {
        const result = await write({ ...draft, expectedRevision: null });
        const adopted = this.epoch === epoch && this.generation === generation;
        if (adopted) adopt(result.revision);
        return { saved: true, adopted };
      } finally {
        if (this.epoch === epoch) this.update({ saving: false });
      }
    });
  }

  async save<T extends { workflowId: string }>(
    getDraft: () => T | null,
    write: (input: T & { expectedRevision: string | null }) => Promise<{ revision: string }>,
  ): Promise<boolean> {
    const epoch = this.epoch;
    return this.enqueue(async () => {
      if (this.epoch !== epoch) return false;
      if (this.state.conflict) throw new ClientFrameworkError({
        code: 'TRADEWIND_WORKFLOW_CHANGED', kind: 'conflict', message: 'Workflow changed remotely',
      });
      const draft = getDraft();
      if (!draft) return false;
      return this.write(draft, this.state.revision, write, epoch, this.generation);
    });
  }

  /** 入队即登记队尾；旧写入失败时，不重放此前已排队的请求。 */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.active ? this.active.then(work) : work();
    this.active = operation;
    const clear = () => { if (this.active === operation) this.active = null; };
    void operation.then(clear, clear);
    return operation;
  }

  private async write<T extends { workflowId: string }>(
    draft: T, expectedRevision: string | null,
    write: (input: T & { expectedRevision: string | null }) => Promise<{ revision: string }>,
    epoch: number, generation: number,
  ): Promise<boolean> {
    this.update({ saving: true });
    try {
      const result = await write({ ...draft, expectedRevision });
      if (this.epoch === epoch && this.state.workflowId === draft.workflowId) {
        this.acknowledgedRevisions.add(result.revision);
        this.update({ revision: result.revision, dirty: this.generation !== generation });
      }
      return true;
    } catch (error) {
      if (this.epoch === epoch && isWorkflowConflict(error)) this.conflict();
      throw error;
    } finally {
      if (this.epoch === epoch) this.update({ saving: false });
    }
  }
}

export function isWorkflowConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'TRADEWIND_WORKFLOW_CHANGED';
}
