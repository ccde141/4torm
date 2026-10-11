import type { ConvectionRoundExecutionPort, ConvectionRoundKind } from '../domain/session-snapshot.js';
import type { ConvectionEventSink, ConvectionRoundExecutor } from './round-executor.js';
import type { ConvectionCommands, BeginConvectionRoundReceipt } from './round-commands.js';
import type { ConvectionSessionService } from './session-service.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { LiveDiscussionView } from './discussion-service.js';
import type { ConvectionStreamEvent } from '../execution/stream-events.js';
import type { ConvectionConferenceFeed } from './conference-feed.js';
import { ConvectionPreparedRound, type PreparedConvectionRound } from './prepared-round.js';
export type { PreparedConvectionRound } from './prepared-round.js';

export interface StartDiscussionRoundInput {
  sessionId: string;
  round: ConvectionRoundKind;
  message: string;
}

export class ConvectionRoundService {
  private readonly active = new Map<string, ConvectionPreparedRound>();
  private readonly preparing = new Set<Promise<PreparedConvectionRound>>();
  private closing = false;
  private terminalFailure: unknown;
  private readonly live = new Map<string, LiveDiscussionView>();

  constructor(
    private readonly sessions: ConvectionSessionService,
    private readonly commands: ConvectionCommands,
    private readonly rounds: ConvectionRoundExecutionPort,
    private readonly executor: ConvectionRoundExecutor,
    private readonly feed?: ConvectionConferenceFeed,
  ) {}

  async start(input: StartDiscussionRoundInput): Promise<BeginConvectionRoundReceipt> {
    const prepared = await this.prepare(input);
    if (this.closing) { await prepared.dispose(); this.assertOpen(); }
    void prepared.run().catch(() => undefined);
    return prepared.receipt;
  }

  liveSnapshot(sessionId: string): LiveDiscussionView | null {
    return this.live.get(sessionId) ?? null;
  }

  async prepare(input: StartDiscussionRoundInput): Promise<PreparedConvectionRound> {
    this.assertOpen();
    const pending = this.prepareRound(input);
    this.preparing.add(pending);
    try { return await pending; } finally { this.preparing.delete(pending); }
  }

  private async prepareRound(input: StartDiscussionRoundInput): Promise<PreparedConvectionRound> {
    const existing = await this.sessions.require(input.sessionId);
    if (input.round === 'public' && existing.participantAgentIds.length === 0) {
      throw frameworkError({ code: 'CONVECTION_NO_PARTICIPANTS', kind: 'conflict',
        message: '会议没有与会 Agent；请先请入成员再发起公开轮次',
        source: 'convection.round-service', retryable: false });
    }
    this.assertOpen();
    const receipt = await this.commands.begin({ sessionId: input.sessionId, round: input.round });
    let session = existing;
    const key = `${receipt.sessionId}:${receipt.runId}`;
    const prepared: ConvectionPreparedRound = new ConvectionPreparedRound(receipt,
      onEvent => this.perform(session, input.message, receipt, onEvent,
        commit => this.settleRound(prepared, commit)),
      cause => this.finishPrepared(receipt, cause),
      () => this.commands.abort(receipt),
      () => {
        if (this.active.get(key) === prepared) this.active.delete(key);
        if (this.live.get(receipt.sessionId)?.runId === receipt.runId) this.live.delete(receipt.sessionId);
      }, () => this.assertOpen());
    this.active.set(key, prepared);
    try {
      session = await this.sessions.require(input.sessionId);
      if (this.closing) { await prepared.dispose(); this.assertOpen(); }
      return prepared;
    } catch (error) { await prepared.dispose(error); throw error; }
  }

  private async finishPrepared(receipt: BeginConvectionRoundReceipt, cause?: unknown): Promise<void> {
    const status = cause === undefined ? 'aborted' : 'failed';
    const error = cause === undefined ? undefined : cause instanceof Error ? cause.message : String(cause);
    await this.commands.finish({ ...receipt, status, agentIds: [], ...(error ? { error } : {}) });
    this.feed?.publish({ type: 'round-end', ...receipt, status, ...(error ? { error } : {}) });
  }

  async drain(): Promise<void> {
    await Promise.all([...this.active.values()].map(item => item.task?.catch(() => undefined)));
    if (this.terminalFailure !== undefined) throw this.terminalFailure;
  }

  private async settleRound(prepared: ConvectionPreparedRound,
    commit: () => Promise<unknown>): Promise<void> {
    try { await prepared.settle(commit); }
    catch (error) {
      // Background execution has no awaiting caller; retain the IO failure for drain/shutdown.
      this.terminalFailure = error;
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    const preparations = await Promise.allSettled([...this.preparing]);
    const aborts = await Promise.allSettled([...this.active.values()].map(item => item.dispose()));
    const failed = [...preparations, ...aborts].find(result => result.status === 'rejected'
      && (result.reason as { data?: { code?: string } })?.data?.code !== 'CONVECTION_RUNTIME_CLOSING');
    if (failed?.status === 'rejected') throw failed.reason;
    if (this.terminalFailure !== undefined) throw this.terminalFailure;
  }

  private async perform(
    session: Awaited<ReturnType<ConvectionSessionService['require']>>,
    message: string,
    receipt: BeginConvectionRoundReceipt,
    onEvent: ConvectionEventSink,
    settle: (commit: () => Promise<unknown>) => Promise<void>,
  ): Promise<void> {
    const signal = this.rounds.signal(receipt.sessionId, receipt.runId);
    let status: 'completed' | 'aborted' | 'failed' = 'completed';
    let error: string | undefined;
    let failure: unknown;
    const startedAgents = new Set<string>();
    const observe = this.eventSink(receipt, onEvent, startedAgents);
    try {
      this.live.set(receipt.sessionId, { session, round: receipt.round, runId: receipt.runId,
        speaker: receipt.round === 'chair' ? '会议助理' : '', draft: '', message });
      this.feed?.publish({ type: 'round-start', ...receipt, message });
      if (signal.aborted) status = 'aborted';
      else if (receipt.round === 'public') await this.executor.speak(session, message, observe, signal, receipt.runId);
      else await this.executor.chair(session, message, observe, signal, receipt.runId);
      if (signal.aborted) status = 'aborted';
    } catch (cause) {
      failure = cause;
      status = signal.aborted ? 'aborted' : 'failed';
      error = cause instanceof Error ? cause.message : String(cause);
    }
    await settle(() => this.commands.finish({
      sessionId: receipt.sessionId, runId: receipt.runId, status,
      ...(error ? { error } : {}),
      agentIds: [...startedAgents],
    }));
    if (this.live.get(receipt.sessionId)?.runId === receipt.runId) this.live.delete(receipt.sessionId);
    this.feed?.publish({ type: 'round-end', sessionId: receipt.sessionId,
      runId: receipt.runId, round: receipt.round, status, ...(error ? { error } : {}) });
    if (status === 'aborted') throw frameworkError({
      code: 'CONVECTION_ROUND_ABORTED', kind: 'cancelled', message: '对流轮次已停止',
      source: 'convection.round-service', retryable: false,
    });
    if (failure) throw failure;
  }

  private eventSink(receipt: BeginConvectionRoundReceipt, onEvent: ConvectionEventSink,
    startedAgents: Set<string>): ConvectionEventSink {
    return event => {
      if (event.type === 'agent-start') startedAgents.add(event.agentId);
      this.updateLive(receipt.sessionId, event);
      this.feed?.publish({ type: 'round-event', sessionId: receipt.sessionId,
        runId: receipt.runId, round: receipt.round, event });
      onEvent(event);
    };
  }

  private updateLive(sessionId: string, event: ConvectionStreamEvent): void {
    const current = this.live.get(sessionId);
    if (!current) return;
    if (event.type === 'agent-start') {
      current.speaker = event.label;
      current.draft = '';
    } else if (event.type === 'token' || event.type === 'chair-token') {
      current.draft += event.chunk;
    } else if (event.type === 'agent-done' || event.type === 'chair-done') {
      current.draft = '';
    }
  }

  private assertOpen(): void {
    if (!this.closing) return;
    throw frameworkError({
      code: 'CONVECTION_RUNTIME_CLOSING', kind: 'cancelled',
      message: '对流运行时正在关闭', source: 'convection.round-service', retryable: false,
    });
  }
}
