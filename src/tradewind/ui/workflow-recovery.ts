const LAST_WORKFLOW_KEY = 'tw-last-workflow';

interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readPersistedWorkflow(storage: RecoveryStorage): string | null {
  const workflowId = storage.getItem(LAST_WORKFLOW_KEY);
  return workflowId && workflowId !== 'untitled' ? workflowId : null;
}

export function rememberPersistedWorkflow(storage: RecoveryStorage, workflowId: string): void {
  if (!workflowId || workflowId === 'untitled') return;
  storage.setItem(LAST_WORKFLOW_KEY, workflowId);
}

export function forgetPersistedWorkflow(storage: RecoveryStorage, workflowId: string): void {
  if (storage.getItem(LAST_WORKFLOW_KEY) === workflowId) {
    storage.removeItem(LAST_WORKFLOW_KEY);
  }
}
