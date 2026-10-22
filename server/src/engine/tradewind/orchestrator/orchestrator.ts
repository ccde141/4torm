/** 信风运行生命周期：接管准备资源后激活，统一提交终态并释放本次执行。
 * strict 由既有入口汇合完成；handoff 由逐封队列确认所有 root 交付后完成。
 */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkflowGraph, WorkflowNode, NodeExecutor, WorkflowMode } from '../foundation/types';
import { BUILTIN_EVENT_IDS } from '../foundation/types';
import { InputBuffer } from '../foundation/input-buffer';
import { EventBus } from '../foundation/event-bus';
import { TokenStreamBus } from '../foundation/token-stream';
import { activeNodeRunners } from '../nodes/agent';
import { ArchiveManager } from './archive-manager';
import { clearExecution as clearNodeContextStore } from '../foundation/node-context-store';
import { clearExecution as clearNodeStatusStore } from '../foundation/node-status-store';
import type { AgentActivityHandle } from '../../shared/agent-activity.js';
import { clearContactRegistry } from '../execution/contact-registry';
import { FrameworkError } from '../../shared/framework-error.js';
import { prepareWorkflowExecution } from './workflow-bootstrap';
import type { HandoffRuntime } from './handoff-runtime.js';

export interface OrchestratorOptions {
  graph: WorkflowGraph;
  dataDir: string;
  workflowId: string;
  executors: Map<string, NodeExecutor>;
  /** 可选：外部提供初始输入内容（Entry 节点用） */
  initialInput?: string;
  /** 运行模式（缺省 manual）；自动模式下节点走全自动路径 */
  mode?: WorkflowMode;
  /**
   * 可选：循环上下文（由 LoopController 注入）。存在即表示本次是循环中的一圈，
   * Entry 会据此给出线信封盖上信封皮（lap / loopNote / idempotencyKey）。
   */
  loopContext?: LoopContext;
  trigger?: { source: 'user' | 'conversation'; sessionId?: string; agentId?: string };
}

/** 循环上下文：单圈在循环中的位置与续跑框定 */
export interface LoopContext {
  lapIndex: number;
  lapTotal: number | null;
  loopNote?: string;
  idempotencyKey?: string;
}

/** 单圈结束的三种归宿 */
export type LapOutcome = 'done' | 'error' | 'stopped';

export class Orchestrator {
  private readonly executionId: string;
  private readonly graph: WorkflowGraph;
  private readonly dataDir: string;
  private readonly workflowId: string;
  private readonly runDir: string;

  private readonly eventBus: EventBus;
  private readonly tokenStream: TokenStreamBus;
  private readonly inputBuffers = new Map<string, InputBuffer>();
  private readonly nodeMap = new Map<string, WorkflowNode>();
  private readonly executors: Map<string, NodeExecutor>;
  private readonly initialInput: string;
  private readonly mode: WorkflowMode;
  private readonly loopContext?: LoopContext;
  private readonly trigger?: OrchestratorOptions['trigger'];

  private archive!: ArchiveManager;
  private handoff?: HandoffRuntime;
  private nodesSettled?: () => Promise<void>;
  private preparation?: ReturnType<typeof prepareWorkflowExecution>;
  private preparing = false;
  private abortController = new AbortController();
  private running = false;
  private outcome: LapOutcome | null = null;
  private stopPromise: Promise<void> | null = null;
  private settlementComplete = false;
  private failure: FrameworkError | null = null;
  private completionNodeId: string | null = null;
  private agentActivities = new Map<string, AgentActivityHandle>();
  /** 本圈结束信号：Output → 'done'；出错 → 'error'；外部 stop 未出 output → 'stopped'。供 LoopController 等待。 */
  private settledResolve!: (outcome: LapOutcome) => void;
  private readonly settled = new Promise<LapOutcome>((resolve) => {
    this.settledResolve = resolve;
  });

  constructor(options: OrchestratorOptions) {
    this.executionId = randomUUID();
    this.graph = options.graph;
    this.dataDir = options.dataDir;
    this.workflowId = options.workflowId;
    this.executors = options.executors;
    this.initialInput = options.initialInput ?? '';
    this.mode = options.mode ?? 'manual';
    this.loopContext = options.loopContext;
    this.trigger = options.trigger;

    this.runDir = path.join(
      options.dataDir, 'tradewind', 'runs',
      options.workflowId, this.executionId,
    );

    const eventsFile = path.join(this.runDir, 'events.jsonl');
    this.eventBus = new EventBus(eventsFile, this.graph.orchestration === 'handoff');
    this.tokenStream = new TokenStreamBus();

    for (const node of this.graph.nodes) {
      this.nodeMap.set(node.id, node);
    }
  }

  getExecutionId(): string { return this.executionId; }
  getWorkflowId(): string { return this.workflowId; }
  getEventBus(): EventBus { return this.eventBus; }
  getTokenStream(): TokenStreamBus { return this.tokenStream; }
  getRunDir(): string { return this.runDir; }
  isRunning(): boolean { return this.running || (this.stopPromise !== null && !this.settlementComplete); }
  isPreparing(): boolean { return this.preparing && !this.archive?.hasStarted(); }
  getOutcome(): LapOutcome | null { return this.settlementComplete ? this.outcome : null; }
  getFailure(): FrameworkError | null { return this.failure; }
  getHandoffState() { return this.handoff?.snapshot(); }

  /** 本圈结束信号。LoopController 用它等待续圈时机；'done' 才续圈，'error'/'stopped' 终止循环。 */
  whenSettled(): Promise<LapOutcome> { return this.settled; }

  async start(): Promise<void> {
    if (this.running) throw new Error('Orchestrator already running');
    this.running = true;
    try {
      await this.startExecution();
    } catch (error) {
      await this.failStart(error);
      throw error;
    }
  }

  private async startExecution(): Promise<void> {
    this.preparing = true;
    this.preparation = prepareWorkflowExecution({
      executionId: this.executionId, workflowId: this.workflowId,
      runDir: this.runDir, dataDir: this.dataDir, graph: this.graph,
      mode: this.mode, initialInput: this.initialInput,
      loopContext: this.loopContext, trigger: this.trigger, executors: this.executors,
      nodes: this.nodeMap, inputBuffers: this.inputBuffers, agentActivities: this.agentActivities,
      eventBus: this.eventBus, signal: this.abortController.signal,
      onToken: (nodeId, chunk) => this.tokenStream.pushChunk(nodeId, chunk),
      onDone: nodeId => this.handleNodeDone(nodeId),
      onError: (nodeId, error) => this.handleNodeError(nodeId, error),
      onArchive: archive => { this.archive = archive; },
    });
    let prepared: Awaited<ReturnType<typeof prepareWorkflowExecution>>;
    try { prepared = await this.preparation; }
    finally { this.preparing = false; }
    if (this.abortController.signal.aborted) {
      const error = new Error('工作流启动已停止'); error.name = 'AbortError'; throw error;
    }
    // 必须先接管归档再激活节点：极速 Output 也使用同一个终态提交入口。
    this.archive = prepared.archive;
    this.handoff = prepared.handoff;
    this.nodesSettled = prepared.settle;
    prepared.activate();
  }

  private async failStart(error: unknown): Promise<void> {
    if (this.abortController.signal.aborted && this.outcome === 'stopped' && this.stopPromise) {
      await this.stopPromise;
      return;
    }
    this.running = false;
    this.outcome = 'error';
    this.failure = this.executionFailure(error);
    try { await this.releaseExecutionResources(); }
    finally { this.settlementComplete = true; this.settledResolve('error'); }
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (!this.running) return Promise.resolve();
    this.stopPromise = this.performStop();
    return this.stopPromise;
  }

  private async performStop(): Promise<void> {
    this.running = false;
    if (!this.outcome) this.outcome = 'stopped';
    if (this.preparing) {
      this.abortController.abort();
      await this.preparation?.catch(() => undefined);
    }

    // 终态提交失败仍必须释放资源；settled 报告失败，显式 stop 调用保留 IO 异常。
    let archiveError: unknown;
    try {
      if (this.handoff) await this.eventBus.flush();
      await this.archive?.writeEnd(this.outcome);
      if (this.outcome === 'done') await this.emitCompletion();
    }
    catch (error) {
      archiveError = error;
      this.failure = this.executionFailure(error);
      this.outcome = 'error';
      if (this.handoff) await this.archive?.recordFailure(this.failure).catch(() => undefined);
      this.eventBus.emit({ timestamp: new Date().toISOString(), nodeId: '',
        eventTypeId: 'node-error', payload: {
          message: this.failure.message, code: this.failure.data.code,
        } });
    }
    try { await this.releaseExecutionResources(); }
    catch (error) {
      archiveError ??= error;
      this.failure = this.executionFailure(error);
      this.outcome = 'error';
      if (this.handoff) await this.archive?.recordFailure(this.failure).catch(() => undefined);
    }
    finally { this.settlementComplete = true; this.settledResolve(this.outcome); }
    if (archiveError) throw archiveError;
  }

  private async releaseExecutionResources(): Promise<void> {
    // 0. 清理 Contact Registry
    clearContactRegistry(this.executionId);

    // 0.1 清理控制台活动状态。
    for (const activity of this.agentActivities.values()) activity.end();
    this.agentActivities.clear();

    // 0.5 主动 flush 所有活跃 NodeRunner 的 messages（防止 abort 后来不及 persist）
    for (const [, runner] of activeNodeRunners.entries(this.executionId)) {
      try { await runner.flush(); } catch { /* 忽略 */ }
    }

    // 1. 中止所有等待中的 buffer
    this.abortController.abort();
    for (const buffer of this.inputBuffers.values()) {
      buffer.abort();
    }
    if (this.handoff) await this.nodesSettled?.();

    // 2. 等 EventBus 落盘完成
    try { await this.eventBus.flush(); }
    finally {
      this.eventBus.closeAll();
      this.tokenStream.closeAll();
      clearNodeContextStore(this.executionId);
      clearNodeStatusStore(this.executionId);
    }
  }

  private executionFailure(error: unknown): FrameworkError {
    if (error instanceof FrameworkError) return error;
    return new FrameworkError({ code: 'TRADEWIND_EXECUTION_FAILED', kind: 'internal',
      message: '信风执行失败',
      source: 'tradewind.execution', retryable: false }, { cause: error });
  }

  private stopInBackground(): void {
    // 失败已通过 settled 和事实口发布；后台收尾的 Promise 必须有拒绝处理。
    void this.stop().catch(error => console.error('[orchestrator] 收尾失败：', error));
  }

  private emitCompletion(): Promise<void> {
    return this.eventBus.emit({ timestamp: new Date().toISOString(),
      nodeId: this.completionNodeId ?? '',
      eventTypeId: this.loopContext ? BUILTIN_EVENT_IDS.LAP_DONE : BUILTIN_EVENT_IDS.WORKFLOW_END });
  }

  private handleNodeDone(nodeId: string): void {
    // 运行态闸门：stop() 第一件事就是 running=false。abort 会让卡在 waitForInputs 的
    // 节点（尤其 output）抛 BufferAbortError，被 NodeActivator 当正常收尾走 onDone→此处。
    // 若不挡，output 会在"从未收到交接"的情况下伪造 lap-done + writeEnd('done')。
    if (!this.running) return;

    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    if (node.type === 'output') {
      this.outcome = 'done';
      this.completionNodeId = nodeId;
      // 每圈独立收尾；LoopController 只在 settled='done' 后继续下一圈。
      this.stopInBackground();
    }
  }

  private handleNodeError(nodeId: string, error: Error): void {
    // 同 handleNodeDone：stop() 后（running=false）到来的 error 是 teardown 噪声，
    // settled 已由 stop() resolve('stopped')，不再覆写 meta / 重复 resolve。
    if (!this.running) return;
    this.outcome = 'error';
    this.failure = this.executionFailure(error);

    console.error(`[orchestrator] Node ${nodeId} failed:`, error.message);
    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      nodeId,
      eventTypeId: 'node-error',
      payload: { message: error.message },
    });
    this.stopInBackground();
  }
}


