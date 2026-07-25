import type { ChatMessage, NativeContextMessage, ToolStep } from '../../types';
import { normalizeDelegateProgressAtToolBoundary } from './delegate-progress';

type DelegateEvent =
  | { type: 'delegate-start'; delegateId: string; task: string }
  | { type: 'delegate-token'; delegateId: string; content: string }
  | { type: 'delegate-tool-call'; delegateId: string; tool: string; args?: Record<string, string> }
  | { type: 'delegate-tool-result'; delegateId: string; tool: string; result: string; ok?: boolean }
  | { type: 'delegate-done'; delegateId: string; summary: string; status: string };

type AnswerEvent = {
  content: string;
  rawContent?: string;
  nativeContext?: NativeContextMessage[];
  native?: boolean;
};

export function isDelegateStreamEvent(event: { type?: string }): event is DelegateEvent {
  return event.type === 'delegate-start'
    || event.type === 'delegate-token'
    || event.type === 'delegate-tool-call'
    || event.type === 'delegate-tool-result'
    || event.type === 'delegate-done';
}

export function applyDelegateStreamEvent(
  messages: ChatMessage[],
  assistantId: string,
  event: DelegateEvent,
): ChatMessage[] {
  return messages.map(message => {
    if (message.id !== assistantId) return message;
    if (event.type === 'delegate-start') return startDelegate(message, event);
    return updateDelegate(message, event);
  });
}

export function finalizeStreamAnswer(
  messages: ChatMessage[],
  assistantId: string,
  event: AnswerEvent,
  agentId: string,
): ChatMessage[] {
  return messages.map(message => message.id === assistantId ? {
    id: assistantId,
    role: 'assistant',
    content: event.rawContent || event.content,
    timestamp: new Date().toISOString(),
    agentId,
    toolSteps: message.toolSteps,
    reasoningContent: message.reasoningContent,
    nativeContext: Array.isArray(event.nativeContext) ? event.nativeContext : message.nativeContext,
    native: event.native,
  } : message);
}

function startDelegate(message: ChatMessage, event: Extract<DelegateEvent, { type: 'delegate-start' }>): ChatMessage {
  const step: ToolStep = {
    tool: 'delegate',
    args: { task: event.task },
    status: 'running',
    delegate: {
      delegateId: event.delegateId,
      task: event.task,
      content: '',
      steps: [],
      status: 'running',
    },
  };
  return {
    ...message,
    toolSteps: [...(message.toolSteps || []), step],
    streamingPhase: 'tool-exec',
    phaseElapsed: 0,
    streamingStatus: undefined,
    streamingTool: 'delegate',
    streamingArgumentChars: undefined,
  };
}

function updateDelegate(message: ChatMessage, event: Exclude<DelegateEvent, { type: 'delegate-start' }>): ChatMessage {
  const steps = message.toolSteps?.map(step => {
    if (step.delegate?.delegateId !== event.delegateId) return step;
    return updateDelegateStep(step, event);
  });
  return steps ? { ...message, toolSteps: steps } : message;
}

function updateDelegateStep(step: ToolStep, event: Exclude<DelegateEvent, { type: 'delegate-start' }>): ToolStep {
  const delegate = step.delegate!;
  if (event.type === 'delegate-token') {
    return { ...step, delegate: { ...delegate, content: delegate.content + event.content } };
  }
  if (event.type === 'delegate-tool-call') {
    return { ...step, delegate: {
      ...delegate,
      content: normalizeDelegateProgressAtToolBoundary(delegate.content),
      steps: [...delegate.steps, { type: 'tool', tool: event.tool, args: event.args }],
    } };
  }
  if (event.type === 'delegate-tool-result') {
    const subSteps = delegate.steps.map((subStep, index, all) => {
      const isLastPending = subStep.tool === event.tool
        && subStep.result == null
        && !all.slice(index + 1).some(later => later.tool === event.tool && later.result == null);
      return isLastPending ? { ...subStep, result: event.result, ok: event.ok } : subStep;
    });
    return { ...step, delegate: { ...delegate, steps: subSteps } };
  }
  const success = event.status === 'success';
  return {
    ...step,
    result: event.summary,
    status: success ? 'done' : 'error',
    delegate: {
      ...delegate,
      content: normalizeDelegateProgressAtToolBoundary(delegate.content),
      summary: event.summary,
      status: success ? 'success' : 'error',
    },
  };
}

