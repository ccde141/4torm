import { invokeFeature } from '../../../api/collaboration.js';

export interface CycloneAbortReceipt {
  stopped: true;
  operationId: string;
  runId: string;
}

export function abortCycloneExecution(
  operationId: string,
  runId: string,
): Promise<CycloneAbortReceipt> {
  return invokeFeature('cyclone', 'abortExecution', { operationId, runId });
}
