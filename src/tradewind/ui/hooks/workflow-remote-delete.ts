import { forgetPersistedWorkflow } from '../workflow-recovery';
import type { WorkflowRevisionTracker } from './workflow-revision';

type RecoveryStorage = Parameters<typeof forgetPersistedWorkflow>[0];

export function handleRemoteWorkflowDelete(
  tracker: WorkflowRevisionTracker, workflowId: string,
  storage: RecoveryStorage, openBlank: () => void,
): void {
  if (tracker.state.workflowId !== workflowId) return;
  forgetPersistedWorkflow(storage, workflowId);
  if (tracker.state.dirty) tracker.observe(workflowId, null);
  else openBlank();
}
