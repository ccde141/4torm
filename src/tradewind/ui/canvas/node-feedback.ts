export type NodeTerminalOutcome = 'completed' | 'stopped' | 'error';
export type NodeFeedback = 'completed' | 'stopped' | 'error' | null;
import { belongsToExecution, type ExecutionIdentity } from '../hooks/execution-visibility';

export function feedbackFromNodeEvent(event: {
  nodeId?: string;
  type?: string;
  outcome?: NodeTerminalOutcome;
  message?: string;
  workflowId?: string;
  executionId?: string;
}, nodeId: string, identity?: ExecutionIdentity): NodeFeedback {
  if (event.nodeId !== nodeId) return null;
  if (identity && !belongsToExecution(event, identity)) return null;
  if (event.type === 'error') return 'error';
  if (event.type !== 'done') return null;
  return event.outcome ?? null;
}
