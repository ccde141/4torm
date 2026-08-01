import type { ChatMessage, ToolStep } from '../../types';

export function appendToolStep(messages: ChatMessage[], messageId: string, tool: string, args: Record<string, string>): ChatMessage[] {
  return messages.map(message => message.id === messageId
    ? { ...message, toolSteps: [...(message.toolSteps || []), { tool, args, status: 'running' }] }
    : message);
}

export function finishLatestToolStep(
  messages: ChatMessage[],
  messageId: string,
  result: string,
  ok: boolean,
  meta?: { before?: string; pendingAutomation?: ToolStep['pendingAutomation']; workflowExecution?: ToolStep['workflowExecution'] },
): ChatMessage[] {
  return messages.map(message => {
    if (message.id !== messageId || !message.toolSteps) return message;
    const steps = [...message.toolSteps];
    const index = steps.findLastIndex(step => step.status === 'running');
    if (index < 0) return message;
    steps[index] = {
      ...steps[index], result, status: ok ? 'done' : 'error',
      ...(typeof meta?.before === 'string' ? { diff: { before: meta.before } } : {}),
      ...(meta?.pendingAutomation ? { pendingAutomation: meta.pendingAutomation } : {}),
      ...(meta?.workflowExecution ? { workflowExecution: meta.workflowExecution } : {}),
    };
    return { ...message, toolSteps: steps };
  });
}
