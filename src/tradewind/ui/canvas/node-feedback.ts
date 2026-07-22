export type NodeTerminalOutcome = 'completed' | 'stopped' | 'error';
export type NodeFeedback = 'completed' | 'stopped' | 'error' | null;

export function feedbackFromNodeEvent(event: {
  nodeId?: string;
  type?: string;
  outcome?: NodeTerminalOutcome;
  message?: string;
}, nodeId: string): NodeFeedback {
  if (event.nodeId !== nodeId) return null;
  if (event.type === 'error') return 'error';
  if (event.type !== 'done') return null;
  return event.outcome ?? null;
}
