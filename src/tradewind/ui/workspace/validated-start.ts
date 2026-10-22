import type { WorkflowGraph, WorkflowMode } from '../../types';
import type { WorkflowValidation } from './validation-client';

export interface StartDraft { workflowId: string; graph: WorkflowGraph }
export const draftSignature = (draft: StartDraft) => JSON.stringify(draft);

/** Validation and save must refer to the same draft, even when the user navigates meanwhile. */
export async function prepareValidatedStart(deps: {
  current: () => StartDraft;
  validate: (graph: WorkflowGraph, mode: WorkflowMode) => Promise<WorkflowValidation>;
  save: () => Promise<boolean>;
  mode: WorkflowMode;
  changedMessage: string;
  emptyMessage: string;
}) {
  const draft = structuredClone(deps.current());
  const signature = draftSignature(draft);
  const assertCurrent = () => {
    if (draftSignature(deps.current()) !== signature) throw new Error(deps.changedMessage);
  };
  const validation = await deps.validate(draft.graph, deps.mode);
  assertCurrent();
  if (!validation.valid) return { ready: false as const, validation, signature, workflowId: draft.workflowId };
  if (!await deps.save()) throw new Error(deps.emptyMessage);
  assertCurrent();
  return { ready: true as const, validation, signature, workflowId: draft.workflowId, graph: draft.graph };
}
