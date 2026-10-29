import type { ChatMessage, ToolStep } from '../../types';
import type { TokenUsage } from '../../store/chat-token';
import type { TaskBoard } from '../../utils/taskboard';
import { applyDelegateStreamEvent, finalizeStreamAnswer, isDelegateStreamEvent } from './delegate-stream-events';
import { applyInputEvent, type InputEvent } from './input-events';
import type { MonsoonBrowserEvent } from './sse-events';
import { appendToolStep, finishLatestToolStep } from './tool-step-events';
import { appendCompactionActivity, clearCompactionNotices, compactionCheckpoint } from './compaction-events';
import { appendActivityText, appendActivityTool, appendTeamActivity, parseTeamActivity } from './activity-sequence';

export interface ProjectionEffect {
  flush?: 'immediate' | 'throttled';
  firstOutput?: boolean;
  taskboard?: TaskBoard | null;
  usage?: TokenUsage | null;
  revision?: number;
}

export class MonsoonMessageProjection {
  private current: ChatMessage[];
  private streamContent = '';
  private readonly assistantId: string;
  private readonly agentId: string;
  private readonly generateMessageId: () => string;

  constructor(
    messages: ChatMessage[],
    assistantId: string,
    agentId: string,
    generateMessageId: () => string,
  ) {
    this.current = messages;
    this.assistantId = assistantId;
    this.agentId = agentId;
    this.generateMessageId = generateMessageId;
  }

  get messages(): ChatMessage[] { return this.current; }
  get content(): string { return this.streamContent; }

  acceptHumanInput(): void { this.current = clearCompactionNotices(this.current); }

  apply(event: MonsoonBrowserEvent): ProjectionEffect {
    if (event.type.startsWith('input-')) {
      if (event.type === 'input-received') this.acceptHumanInput();
      this.current = applyInputEvent(this.current, this.assistantId, event as InputEvent);
      return { flush: 'immediate' };
    }
    if (event.type === 'token' || event.type === 'reasoning') return this.output(event);
    if (event.type === 'tool-progress') {
      this.patch({ streamingPhase: 'tool-preparing', phaseElapsed: Math.round(Number(event.elapsed ?? 0) / 1000),
        streamingTool: typeof event.tool === 'string' ? event.tool : undefined,
        streamingArgumentChars: Number(event.argumentChars ?? 0), streamingStatus: undefined });
      return { flush: 'throttled', firstOutput: true };
    }
    if (event.type === 'team-activity') {
      const activity = parseTeamActivity(event);
      const message = this.find();
      if (activity && message) this.replace(appendTeamActivity(message, activity));
      return { flush: 'immediate' };
    }
    if (event.type === 'tool-call' || event.type === 'tool-result') return this.tool(event);
    const startsDelegate = event.type === 'delegate-start';
    if (isDelegateStreamEvent(event)) {
      const toolIndex = this.find()?.toolSteps?.length ?? 0;
      this.current = applyDelegateStreamEvent(this.current, this.assistantId, event);
      if (startsDelegate) {
        const message = this.find();
        if (message) this.replace(appendActivityTool(message, toolIndex));
      }
      return { flush: 'throttled' };
    }
    return this.lifecycle(event);
  }

  private output(event: MonsoonBrowserEvent): ProjectionEffect {
    const message = this.find();
    if (!message) return {};
    const content = requiredText(event.content, event.type);
    if (event.type === 'token') this.streamContent += content;
    const next: ChatMessage = {
      ...message,
      ...(event.type === 'token'
        ? { content: this.streamContent }
        : { reasoningContent: `${message.reasoningContent ?? ''}${content}` }),
      streamingPhase: 'model-output', phaseElapsed: 0,
      streamingStatus: undefined, streamingTool: undefined, streamingArgumentChars: undefined,
    };
    this.replace(event.type === 'token' ? appendActivityText(next, content) : next);
    return { flush: 'throttled', firstOutput: true };
  }

  private tool(event: MonsoonBrowserEvent): ProjectionEffect {
    const message = this.find();
    if (!message) return {};
    if (event.type === 'tool-call') {
      this.current = appendToolStep(this.current, this.assistantId,
        requiredText(event.tool, 'tool'), isRecord(event.args) ? event.args : {});
      const next = this.find();
      if (next) this.replace(appendActivityTool(next, (next.toolSteps?.length ?? 1) - 1));
      this.patch({ streamingPhase: 'tool-exec', phaseElapsed: 0,
        streamingTool: event.tool, streamingArgumentChars: undefined });
      return { flush: 'immediate' };
    }
    const meta = isRecord(event.meta) ? event.meta : {};
    if (message.toolSteps) {
      this.current = finishLatestToolStep(this.current, this.assistantId,
        requiredText(event.result, 'result'), event.ok !== false, {
          before: typeof meta.before === 'string' ? meta.before : undefined,
          pendingAutomation: meta.pendingAutomation as ToolStep['pendingAutomation'],
          workflowExecution: meta.workflowExecution as ToolStep['workflowExecution'],
          toolImages: event.toolImages as ToolStep['toolImages'],
        });
      this.patch({ streamingPhase: 'llm-waiting', phaseElapsed: 0,
        streamingTool: undefined, streamingArgumentChars: undefined });
    }
    return { flush: 'immediate',
      ...('taskboard' in meta ? { taskboard: meta.taskboard as TaskBoard | null } : {}) };
  }

  private lifecycle(event: MonsoonBrowserEvent): ProjectionEffect {
    if (event.type === 'compaction-notice') {
      this.patch({ compactionNotice: requiredText(event.message, 'message') });
      return { flush: 'immediate' };
    }
    if (event.type === 'context-compacted') {
      const { marker, revision } = compactionCheckpoint(event);
      const current = [...this.current];
      const existing = current.some(message => message.id === marker.id);
      if (!existing) {
        const index = current.findIndex(message => message.id === this.assistantId);
        current.splice(index < 0 ? current.length : index, 0, marker);
      }
      this.current = current.map(message => message.id === this.assistantId ? appendCompactionActivity(message, marker) : message);
      return { flush: 'immediate', revision, ...(!existing ? { usage: null } : {}) };
    }
    if (event.type === 'answer') {
      this.current = finalizeStreamAnswer(this.current, this.assistantId,
        event as Parameters<typeof finalizeStreamAnswer>[2], this.agentId);
      return { flush: 'immediate' };
    }
    if (event.type === 'ask') return this.ask(event);
    if (event.type === 'notice') {
      const message = this.find();
      if (message) this.replace({ ...message,
        streamingPhase: typeof event.message === 'string' && event.message.includes('排队')
          ? 'queued' : message.streamingPhase,
        streamingStatus: typeof event.message === 'string' ? event.message : undefined });
      return { flush: 'immediate' };
    }
    if (event.type === 'heartbeat') {
      this.patch({ streamingPhase: event.phase === 'team-waiting' ? 'team-waiting'
        : event.phase === 'tool-exec' ? 'tool-exec' : 'llm-waiting',
        ...(event.phase === 'team-waiting' ? { streamingTool: Array.isArray(event.members)
          ? event.members.filter((value): value is string => typeof value === 'string').join('、') : undefined,
          streamingStatus: undefined } : {}),
        phaseElapsed: Math.round(Number(event.elapsed ?? 0) / 1000) });
      return { flush: 'throttled' };
    }
    if (event.type === 'usage') return { usage: event.usage === null ? null : usage(event.usage) };
    return {};
  }

  private ask(event: MonsoonBrowserEvent): ProjectionEffect {
    const question = requiredText(event.question, 'question');
    const clean = this.streamContent.trim();
    if (clean) this.patch({ content: clean });
    const ask: ChatMessage = {
      id: this.generateMessageId(), role: 'assistant', content: question,
      timestamp: new Date().toISOString(), agentId: this.agentId,
      ask: { question, options: Array.isArray(event.options)
        ? event.options.filter((item): item is string => typeof item === 'string') : undefined,
        answered: false, sourceRunId: this.assistantId },
    };
    this.current = [...this.current, ask];
    return { flush: 'immediate' };
  }

  private find(): ChatMessage | undefined {
    return this.current.find(message => message.id === this.assistantId);
  }

  private replace(next: ChatMessage): void {
    this.current = this.current.map(message => message.id === this.assistantId ? next : message);
  }

  private patch(patch: Partial<ChatMessage>): void {
    const message = this.find();
    if (message) this.replace({ ...message, ...patch });
  }
}

function usage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const promptTokens = Number(value.promptTokens);
  const completionTokens = Number(value.completionTokens);
  const totalTokens = Number(value.totalTokens ?? promptTokens + completionTokens);
  if (![promptTokens, completionTokens, totalTokens].every(Number.isFinite)) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`季风事件缺少 ${field}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
