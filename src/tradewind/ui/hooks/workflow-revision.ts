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
  private active: Promise<boolean> | null = null;

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
    if (this.active) await this.active;
  }

  async observeAfterSave(workflowId: string, revision: string | null): Promise<RemoteDecision> {
    const epoch = this.epoch;
    try { await this.waitForSave(); } catch { /* 保存调用方报告原错误，仍需对账远端事实 */ }
    return this.epoch === epoch ? this.observe(workflowId, revision) : 'ignored';
  }

  async saveCopy<T extends { workflowId: string }>(
    draft: T,
    write: (input: T & { expectedRevision: null }) => Promise<{ revision: string }>,
    adopt: (revision: string) => void,
  ): Promise<{ saved: boolean; adopted: boolean }> {
    const epoch = this.epoch;
    const generation = this.generation;
    await this.waitForSave();
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
  }

  async save<T extends { workflowId: string }>(
    getDraft: () => T | null,
    write: (input: T & { expectedRevision: string | null }) => Promise<{ revision: string }>,
  ): Promise<boolean> {
    if (this.active) await this.active;
    if (this.state.conflict) throw new ClientFrameworkError({
      code: 'TRADEWIND_WORKFLOW_CHANGED', kind: 'conflict', message: 'Workflow changed remotely',
    });
    const draft = getDraft();
    if (!draft) return false;
    const expectedRevision = this.state.revision;
    const epoch = this.epoch;
    const generation = this.generation;
    const operation = this.write(draft, expectedRevision, write, epoch, generation);
    this.active = operation;
    try {
      return await operation;
    } finally {
      if (this.active === operation) this.active = null;
    }
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
