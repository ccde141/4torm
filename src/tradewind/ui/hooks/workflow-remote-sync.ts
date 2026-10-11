import { ClientFrameworkError } from '../../../api/error-contract';
import type { WorkflowChangeEvent, WorkflowDefinition } from '../workflow-client';
import { handleRemoteWorkflowDelete } from './workflow-remote-delete';
import type { WorkflowLoadGate } from './workflow-load-gate';
import type { WorkflowRevisionTracker } from './workflow-revision';

type RecoveryStorage = Parameters<typeof handleRemoteWorkflowDelete>[2];

export async function reconcileWorkflowRemote(
  tracker: WorkflowRevisionTracker, gate: WorkflowLoadGate,
  change: WorkflowChangeEvent | undefined,
  read: (workflowId: string) => Promise<WorkflowDefinition>,
  apply: (value: WorkflowDefinition) => void,
  openBlank: () => void, storage: RecoveryStorage,
): Promise<void> {
  const id = tracker.state.workflowId;
  if (change && change.workflowId !== id) return;
  if (!change && tracker.state.revision === null) return;
  for (let pending = gate.pendingRun(); pending; pending = gate.pendingRun()) {
    try { await pending; } catch { /* 显式加载调用方报告原错误 */ }
  }
  if (tracker.state.workflowId !== id) return;
  const sequence = gate.next();
  const valid = () => gate.isCurrent(sequence) && tracker.state.workflowId === id;
  if (change?.change === 'deleted') {
    try { await tracker.waitForSave(); } catch { /* 原保存调用方报告失败 */ }
    if (valid()) handleRemoteWorkflowDelete(tracker, id, storage, openBlank);
    return;
  }
  if (change) {
    const decision = await tracker.observeAfterSave(id, change.revision);
    if (!valid() || decision !== 'reload') return;
  } else {
    try { await tracker.waitForSave(); } catch { /* 继续核对服务端事实 */ }
    if (!valid()) return;
  }
  let data: WorkflowDefinition;
  try { data = await read(id); }
  catch (error) {
    if (valid() && error instanceof ClientFrameworkError && error.kind === 'not_found') {
      handleRemoteWorkflowDelete(tracker, id, storage, openBlank);
      return;
    }
    throw error;
  }
  if (valid() && tracker.observe(id, data.revision) === 'reload') apply(data);
}
