import { withCycloneSummaryUsage } from './summary-model-usage.js';
import { alignCycloneTranscript, captureCycloneCompaction } from '../../../engine/cyclone/conversation-transcript.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { withAgentActivity } from '../../../engine/shared/agent-activity.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { throwForReActFailure } from '../../../engine/shared/react/outcome.js';
import { readTaskboard, execTaskBoard, type TaskBoard } from '../../../engine/shared/taskboard.js';
import { editContextMessage, deleteContextMessage } from '../../../engine/cyclone/message-mutations.js';
import { runSupervisorTurn, type SupervisorTurnInput } from '../../../engine/cyclone/supervisor-runner.js';
import { archiveSupervisorContext, enqueueSupervisorInformation,
  isSupervisorBusy, loadSupervisor, mutateSupervisor, readPendingSupervisorInformation, readSupervisorInbox,
  supervisorTaskboardFile, tryAcquireSupervisorLock, hasEstablishedSupervisorGoal,
  type SupervisorGoalOrigin } from '../../../engine/cyclone/supervisor-store.js';
import { loadSeat } from '../../../engine/cyclone/seat-store.js';
import { loadWorkshop } from '../../../engine/cyclone/workshop-store.js';
import { listWorkshopDispatches, type CycloneDispatch } from '../../../engine/cyclone/dispatch-store.js';
import type { CycloneCommands } from './execution-commands.js';
import type { CycloneExecutionPort, CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';
import type { CycloneChangeFeed } from './change-feed.js';
import type { CycloneContextSummarizer } from '../domain/context-summary.js';
import { retainedCycloneMessages, toCycloneSummaryMessages } from '../domain/context-summary.js';
import type { CyclonePrivateChatActivity } from './private-chat-activity.js';
import { withCycloneContextChange } from './context-compaction-transaction.js';
import { finishCycloneCompaction, recoveredCycloneCompaction } from '../../../engine/cyclone/compaction-progress.js';
import { listWorkshopContactCommunications, type ContactCommunication } from '../../../engine/cyclone/contact-communication-store.js';
import { trackCyclonePreparation } from './execution-preparation.js';
import type { CycloneSupervisorSummary } from '../domain/supervisor-view.js';

export interface PreparedSupervisorChat {
  execution: CycloneExecutionSnapshot;
  run(onEvent?: (event: unknown) => void): Promise<void>;
  dispose(error?: unknown): Promise<void>;
}
export class CycloneSupervisorService {
  private readonly background = new Set<Promise<void>>();
  private readonly receiptWrites = new Set<Promise<void>>();
  private stopped = false;
  constructor(private readonly dataDir: string, private readonly commands: CycloneCommands,
    private readonly executions: CycloneExecutionPort, private readonly summarizer: CycloneContextSummarizer,
    private readonly changes: CycloneChangeFeed, private readonly activity: CyclonePrivateChatActivity) {}

  async status(workshopId: string) {
    const supervisor = await loadSupervisor(this.dataDir, workshopId);
    supervisor.compaction = recoveredCycloneCompaction(supervisor.compaction,
      isSupervisorBusy(this.dataDir, workshopId));
    return { ...supervisor, configured: Boolean(supervisor.agentId),
      busy: isSupervisorBusy(this.dataDir, workshopId) };
  }
  async summary(workshopId: string): Promise<CycloneSupervisorSummary> {
    const value = await this.status(workshopId);
    return { configured: value.configured, agentId: value.agentId, busy: value.busy,
      pending: Boolean(value.pending), revision: value.revision, updatedAt: value.updatedAt,
      followUpPaused: Boolean(value.followUpPaused),
      goalKind: value.goalOrigin?.kind ?? (value.humanIntentEstablished ? 'human' : 'none'),
      ...(value.goalOrigin?.kind === 'agent' ? { delegatedByAgentId: value.goalOrigin.agentId } : {}) };
  }
  async configure(workshopId: string, input: { agentId: string; rolePrompt: string }) {
    return this.configureBinding(workshopId, input, false);
  }
  async configureInitial(workshopId: string, input: { agentId: string; rolePrompt: string }) {
    return this.configureBinding(workshopId, input, true);
  }
  private async configureBinding(workshopId: string, input: { agentId: string; rolePrompt: string }, initial: boolean) {
    if (!input.agentId || !await loadAgent(this.dataDir, input.agentId)) throw failure('绑定的 Agent 不存在', 'validation');
    const release = this.lock(workshopId);
    try {
      await mutateSupervisor(this.dataDir, workshopId, current => {
        if (initial && current.agentId) throw failure('工作室已配置主管；更换主管请由人类在工作台操作', 'conflict');
        current.agentId = input.agentId; current.rolePrompt = input.rolePrompt;
      });
      this.changed(workshopId);
      return this.status(workshopId);
    } finally { release(); }
  }
  async startDelegated(workshopId: string, text: string,
    origin: Extract<SupervisorGoalOrigin, { kind: 'agent' }>, signal?: AbortSignal): Promise<CycloneExecutionSnapshot> {
    signal?.throwIfAborted();
    const prepared = await this.prepare({ workshopId, mode: 'delegated', text, origin });
    if (signal?.aborted) {
      await prepared.dispose(signal.reason);
      signal.throwIfAborted();
    }
    const task = prepared.run().catch(error => {
      console.error('[cyclone] 委托主管执行失败', error);
    }).finally(() => this.background.delete(task));
    this.background.add(task);
    return prepared.execution;
  }
  async prepare(input: SupervisorTurnInput & { workshopId: string }): Promise<PreparedSupervisorChat> {
    await this.reconcileCommunicationReceipts(input.workshopId);
    const supervisor = await loadSupervisor(this.dataDir, input.workshopId);
    if (this.stopped) throw failure('主管服务正在关闭');
    if (!supervisor.agentId) throw failure('请先选择主管 Agent', 'validation');
    if (input.mode === 'information' && (!hasEstablishedSupervisorGoal(supervisor) || supervisor.followUpPaused)) {
      throw failure('主管当前没有可自动接续的已确认目标');
    }
    if (input.mode !== 'resume' && supervisor.pending) throw failure('主管正在等待人类回答');
    const execution = await this.commands.begin({ workshopId: input.workshopId,
      targetKind: 'supervisor', targetId: 'supervisor', agentId: supervisor.agentId,
      phase: input.mode === 'resume' ? 'supervisor-resume' : 'supervisor-chat' });
    let started = false;
    let finished = false;
    const finish = async (status: 'completed' | 'failed' | 'aborted', error?: unknown) => {
      if (finished) return;
      finished = true;
      await this.commands.finish({ ...execution, status,
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) });
      this.changed(input.workshopId);
    };
    this.changed(input.workshopId);
    return trackCyclonePreparation(this.commands, { execution, run: async onEvent => {
      if (started || finished) throw failure('主管执行已经开始或结束');
      started = true;
      const handle = this.activity.begin(execution, input.text);
      const emit = (event: unknown) => {
        if (event && typeof event === 'object') handle.emit(event as Record<string, unknown>);
        onEvent?.(event);
      };
      const signal = this.executions.signal(execution.operationId, execution.runId);
      try {
        if (input.mode !== 'information') await mutateSupervisor(this.dataDir, input.workshopId,
          current => { current.followUpPaused = false; });
        const result = await withAgentActivity(supervisor.agentId!, 'cyclone', () => runSupervisorTurn(this.dataDir, input.workshopId,
          { ...input, inputMessageId: execution.runId }, event => {
          if (event && typeof event === 'object' && 'type' in event && event.type === 'error') return;
          emit(event);
        }, signal));
        throwForReActFailure(result.termination);
        const aborted = signal.aborted || result.termination.status === 'aborted';
        if (aborted) await mutateSupervisor(this.dataDir, input.workshopId, current => { current.followUpPaused = true; });
        await finish(aborted ? 'aborted' : 'completed');
        emit({ type: 'done' });
        if (!aborted && !result.suspended) this.kick(input.workshopId);
      } catch (error) {
        if (signal.aborted) await mutateSupervisor(this.dataDir, input.workshopId, current => { current.followUpPaused = true; });
        await finish(signal.aborted ? 'aborted' : 'failed', error);
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally { handle.finish(); }
    }, dispose: async error => {
      if (!started) await finish('failed', error ?? new Error('主管流式连接未能建立'));
    } });
  }
  async report(workshopId: string, seatId: string, message: string) {
    const seat = await loadSeat(this.dataDir, workshopId, seatId);
    const workshop = await loadWorkshop(this.dataDir, workshopId);
    if (!seat || !workshop?.seatIds.includes(seatId)) throw failure('来源工位不存在', 'not_found');
    const item = await enqueueSupervisorInformation(this.dataDir, workshopId, {
      sourceKind: 'seat', sourceId: seatId, sourceTitle: seat.title, content: message,
    });
    this.changed(workshopId); this.kick(workshopId);
    return { ok: true, result: JSON.stringify({ informationId: item.id, delivered: true,
      status: 'received', message: '信息已送达工作室主管，等待查看；未向主管派发任务。' }) };
  }
  receiveDispatch(item: CycloneDispatch, followUp = true): Promise<void> {
    if (this.stopped || item.sourceKind !== 'supervisor' || !['completed', 'failed'].includes(item.status)) return Promise.resolve();
    return this.persistReceipt(item.workshopId, {
      id: `dispatch:${item.id}:${item.status}`, sourceKind: 'dispatch', sourceId: item.id,
      sourceTitle: item.targetSeatTitle, content: JSON.stringify({ dispatchId: item.id,
        status: item.status, response: item.response, error: item.error, errorCode: item.errorCode }),
    }, followUp);
  }
  receiveContact(item: ContactCommunication, followUp = true): Promise<void> {
    if (this.stopped || item.sourceKind !== 'supervisor' || ['waiting', 'running'].includes(item.status)) return Promise.resolve();
    return this.persistReceipt(item.workshopId, {
      id: `contact:${item.id}:${item.status}`, sourceKind: 'contact', sourceId: item.id,
      sourceTitle: item.targetTitle,
      content: JSON.stringify({ contactId: item.id, status: item.status,
        delivered: item.delivered, response: item.response, error: item.error }),
    }, followUp);
  }
  private persistReceipt(workshopId: string,
    input: Parameters<typeof enqueueSupervisorInformation>[2], followUp: boolean): Promise<void> {
    const task = enqueueSupervisorInformation(this.dataDir, workshopId, input).then(() => {
      if (followUp && !this.stopped) { this.changed(workshopId); this.kick(workshopId); }
    });
    this.receiptWrites.add(task);
    void task.finally(() => this.receiptWrites.delete(task)).catch(() => undefined);
    return task;
  }
  /** Notifications accelerate delivery; persisted communication records repair missed receipts. */
  async reconcileCommunicationReceipts(workshopId: string): Promise<void> {
    if (!(await loadSupervisor(this.dataDir, workshopId)).agentId) return;
    const [dispatches, contacts, inbox] = await Promise.all([
      listWorkshopDispatches(this.dataDir, workshopId), listWorkshopContactCommunications(this.dataDir, workshopId),
      readSupervisorInbox(this.dataDir, workshopId),
    ]);
    const known = new Set(inbox.map(item => item.id));
    for (const item of dispatches) if (!known.has(`dispatch:${item.id}:${item.status}`)) await this.receiveDispatch(item, false);
    for (const item of contacts) if (!known.has(`contact:${item.id}:${item.status}`)) await this.receiveContact(item, false);
  }
  kick(workshopId: string): void {
    if (this.stopped) return;
    const task = this.continueInformation(workshopId).catch(error => {
      console.error('[cyclone] 主管跟进失败', error);
    }).finally(() => this.background.delete(task));
    this.background.add(task);
  }
  private async continueInformation(workshopId: string): Promise<void> {
    const supervisor = await loadSupervisor(this.dataDir, workshopId);
    if (!supervisor.agentId || !hasEstablishedSupervisorGoal(supervisor) || supervisor.pending || supervisor.followUpPaused
      || isSupervisorBusy(this.dataDir, workshopId)) return;
    await this.reconcileCommunicationReceipts(workshopId);
    if (!(await readPendingSupervisorInformation(this.dataDir, workshopId)).length) return;
    let prepared: PreparedSupervisorChat;
    try { prepared = await this.prepare({ workshopId, mode: 'information', text: '' }); }
    catch (error) {
      if (isSupervisorBusy(this.dataDir, workshopId)) return;
      throw error;
    }
    await prepared.run();
  }
  async edit(workshopId: string, index: number, content?: string) {
    const release = this.lock(workshopId);
    try {
      await mutateSupervisor(this.dataDir, workshopId, current => {
        if (current.pending) throw failure('请先回答主管的问题');
        const before = [...current.messages];
        const changed = content === undefined ? deleteContextMessage(current.messages, index)
          : editContextMessage(current.messages, index, content);
        if (!changed) throw failure('消息索引无效', 'validation');
        alignCycloneTranscript(current.displayHistory, before, current.messages);
      });
      this.changed(workshopId); return { ok: true };
    } finally { release(); }
  }
  async reset(workshopId: string, mode: 'clear' | 'summary', signal?: AbortSignal) {
    const release = this.lock(workshopId);
    try { return await this.compactWithinLock(workshopId, mode, signal); } finally { release(); }
  }
  async prepareCompaction(workshopId: string): Promise<PreparedSupervisorChat> {
    const current = await loadSupervisor(this.dataDir, workshopId);
    if (!current.agentId) throw failure('请先选择主管 Agent', 'validation');
    if (current.pending) throw failure('请先回答主管的问题');
    const execution = await this.commands.begin({ workshopId, targetKind: 'supervisor',
      targetId: 'supervisor', phase: 'supervisor-compact', agentId: current.agentId });
    let started = false;
    let finished = false;
    const finish = async (status: 'completed' | 'aborted' | 'failed', error?: unknown) => {
      if (finished) return;
      finished = true;
      await this.commands.finish({ ...execution, status,
        ...(error ? { error: (error as Error).message } : {}) });
      this.changed(workshopId);
    };
    return trackCyclonePreparation(this.commands, { execution, run: async (onEvent = () => {}) => {
      if (started || finished) throw failure('压缩已经开始或结束');
      started = true;
      const signal = this.executions.signal(execution.operationId, execution.runId);
      try {
        await this.compactWithinLock(workshopId, 'summary', signal, onEvent);
        await finish('completed'); onEvent({ type: 'done' });
      } catch (error) { await finish(signal.aborted ? 'aborted' : 'failed', error); throw error; }
    }, dispose: async error => { if (!started) await finish('failed', error ?? new Error('压缩连接未能建立')); } });
  }
  async compactWithinLock(workshopId: string, mode: 'clear' | 'summary', signal?: AbortSignal,
    emit: (event: unknown) => void = () => {}) {
    return withCycloneContextChange(mode === 'summary' ? 'compact' : 'reset', signal,
      async progress => {
        await mutateSupervisor(this.dataDir, workshopId, current => { current.compaction = progress; });
        this.changed(workshopId); emit(progress);
      }, async started => {
        const current = await loadSupervisor(this.dataDir, workshopId);
        if (current.pending) throw failure('请先回答主管的问题');
    if (mode === 'clear') await this.reconcileCommunicationReceipts(workshopId);
    const inboxBefore = mode === 'clear'
      ? (await readPendingSupervisorInformation(this.dataDir, workshopId)).map(item => item.id) : [];
        const archivePath = await archiveSupervisorContext(this.dataDir, workshopId, current);
        const compacted = mode === 'summary' ? await withCycloneSummaryUsage({
          get: () => current.modelUsage, set: value => { current.modelUsage = value; },
          persist: () => mutateSupervisor(this.dataDir, workshopId, next => { next.modelUsage = current.modelUsage; }),
          emit: event => { this.changed(workshopId); emit(event); },
        }, () => this.summarizer.summarize({
          agentId: current.agentId!, subject: '工作室主管会话',
          target: { workshopId, kind: 'supervisor' },
          messages: toCycloneSummaryMessages(current.messages), signal,
          onNotice: async notice => {
            await mutateSupervisor(this.dataDir, workshopId, next => { next.compactionNotice = notice; });
            this.changed(workshopId); emit(notice);
          },
        })) : undefined;
        const summary = compacted?.summary;
        if (mode === 'summary' && !summary?.trim()) throw failure('摘要为空，原会话保留', 'io');
        signal?.throwIfAborted();
        await mutateSupervisor(this.dataDir, workshopId, next => {
          const before = next.messages;
          next.messages = summary ? [{ role: 'system', content: `[会话归档摘要]\n${summary}` },
            ...retainedCycloneMessages(before, compacted!)] : [];
          next.displayHistory = summary ? captureCycloneCompaction(next.displayHistory, before, next.messages,
            { role: 'system', content: `[历史压缩记录]\n${summary}`, compactionId: started.id }) : undefined;
          next.tokenUsage = undefined;
          next.pending = undefined;
          next.compaction = finishCycloneCompaction(started);
          if (mode === 'clear') {
            next.humanIntentEstablished = false; next.goalOrigin = undefined; next.followUpPaused = true;
            next.clearedInformationIds = [...new Set([...(next.clearedInformationIds ?? []), ...inboxBefore])];
          }
          next.compactState = { disabled: false, archiveSeq: (next.compactState?.archiveSeq ?? 0) + 1,
            lastCompactAt: new Date().toISOString() };
        }, signal);
        this.changed(workshopId);
        return { ok: true, archivePath, archivedCount: current.messages.length, summary: mode === 'summary' };
      });
  }
  taskboard(workshopId: string) { return loadSupervisor(this.dataDir, workshopId)
    .then(() => readTaskboard(supervisorTaskboardFile(this.dataDir, workshopId))); }
  async saveTaskboard(workshopId: string, board: TaskBoard | null, expectedRevision: number) {
    await loadSupervisor(this.dataDir, workshopId);
    return execTaskBoard(supervisorTaskboardFile(this.dataDir, workshopId), board
      ? { action: 'set', goal: board.goal, tasks: board.tasks, expectedRevision }
      : { action: 'clear', expectedRevision });
  }
  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const item of this.executions.list()) if (item.targetKind === 'supervisor') {
      await this.commands.abort(item);
    }
    while (this.background.size || this.receiptWrites.size) {
      await Promise.allSettled([...this.background, ...this.receiptWrites]);
    }
  }
  private lock(workshopId: string): () => void {
    const release = tryAcquireSupervisorLock(this.dataDir, workshopId);
    if (!release) throw failure('主管正在处理中');
    return release;
  }
  private changed(workshopId: string) { this.changes.publish(workshopId, 'activity', 'supervisor'); }
}
function failure(message: string, kind: 'conflict' | 'validation' | 'not_found' | 'io' = 'conflict') {
  return frameworkError({ code: 'CYCLONE_SUPERVISOR_ERROR', kind, message,
    source: 'cyclone.supervisor', retryable: false });
}
