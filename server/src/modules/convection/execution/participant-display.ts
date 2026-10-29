import { randomUUID } from 'node:crypto';
import { frameworkTransportErrorFromUnknown } from '../../../engine/shared/framework-error-transport.js';
import { saveSession, type ConvectionMessage, type ConvectionSessionData } from '../infrastructure/session-store.js';
import type { ConvectionReActEvent } from './convection-react-adapter.js';

/** Display evidence is independent from the public answers offered to other participants. */
export class ConvectionParticipantDisplay {
  readonly compactions: NonNullable<ConvectionMessage['compactions']> = [];
  reasoning = '';
  content = '';
  private readonly recordId = randomUUID();
  private readonly timestamp = Date.now();
  private readonly tools: NonNullable<ConvectionMessage['toolCalls']> = [];

  constructor(private readonly agent: { id: string; name: string }, private readonly runId?: string) {}

  receive(event: ConvectionReActEvent): void {
    if (event.type === 'reasoning') this.reasoning += event.chunk ?? '';
    if (event.type === 'token') this.content += event.chunk ?? '';
    if (event.type === 'tool-call') this.tools.push({ tool: event.tool!, args: event.args!, result: '', completed: false });
    if (event.type === 'tool-result') {
      const tool = [...this.tools].reverse().find(item => item.tool === event.tool && !item.completed);
      if (tool) Object.assign(tool, { result: event.result ?? '', completed: true,
        ...(event.ok !== undefined ? { ok: event.ok } : {}),
        ...(event.toolImages?.length ? { toolImages: event.toolImages } : {}) });
    }
  }

  boundary(compaction: { id: string; summary: string }) {
    return { ...compaction, toolOffset: this.tools.length, textOffset: this.content.length,
      reasoningOffset: this.reasoning.length };
  }

  snapshot(compaction?: { id: string; summary: string }): ConvectionMessage {
    const compactions = compaction && !this.compactions.some(item => item.id === compaction.id)
      ? [...this.compactions, this.boundary(compaction)] : this.compactions;
    return { recordId: this.recordId, agentId: this.agent.id, speaker: this.agent.name,
      content: this.content, displayContent: this.content, reasoning: this.reasoning,
      timestamp: this.timestamp, ...(this.runId ? { runId: this.runId } : {}),
      toolCalls: structuredClone(this.tools),
      ...(compactions.length ? { compactions: structuredClone(compactions) } : {}), execution: { status: 'running' } };
  }

  async preserve(dataDir: string, session: ConvectionSessionData, error?: unknown, stopped = false): Promise<void> {
    if (!this.content && !this.reasoning && !this.tools.length && !this.compactions.length) return;
    const draft = this.snapshot();
    draft.execution = { status: stopped ? 'stopped' : 'failed',
      ...(error !== undefined ? { message: frameworkTransportErrorFromUnknown(error, 'convection.participant').message } : {}) };
    const next = { ...session, publicExecutionDraft: undefined,
      publicMessages: [...session.publicMessages, draft] };
    await saveSession(dataDir, next);
    Object.assign(session, next);
  }
}
