/**
 * Orchestrator —— 信风工作流编排核心
 *
 * 生命周期：constructor → start() → [执行中] → stop()
 *
 * 职责：
 * - 持有并组装所有子模块（EventBus, TokenStream, Router, Activator, Archive）
 * - start() 初始化 InputBuffer、注册路由回调、激活 Entry 节点
 * - 节点完成回调中判断是否为 Output → 触发 workflow-end
 * - stop() 中止所有 buffer、flush EventBus、关闭 SSE
 */

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { WorkflowGraph, WorkflowNode, NodeExecutor, WorkflowMode } from '../foundation/types';
import { BUILTIN_EVENT_IDS } from '../foundation/types';
import { InputBuffer } from '../foundation/input-buffer';
import { EnvelopeRouter, countWorkInputs } from '../foundation/envelope-router';
import { EventBus } from '../foundation/event-bus';
import { TokenStreamBus } from '../foundation/token-stream';
import { NodeActivator } from './node-activator';
import { activeNodeRunners } from '../nodes/agent';
import { ContextBuilder } from './context-builder';
import { ArchiveManager } from './archive-manager';
import { clearExecution as clearNodeContextStore } from '../foundation/node-context-store';
import { clearExecution as clearNodeStatusStore } from '../foundation/node-status-store';
import { beginAgentActivity, type AgentActivityHandle } from '../../shared/agent-activity.js';
import { initContactRegistry, clearContactRegistry } from '../execution/contact-registry';

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

  private router!: EnvelopeRouter;
  private activator!: NodeActivator;
  private contextBuilder!: ContextBuilder;
  private archive!: ArchiveManager;
  private abortController = new AbortController();
  private running = false;
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

    this.runDir = path.join(
      options.dataDir, 'tradewind', 'runs',
      options.workflowId, this.executionId,
    );

    const eventsFile = path.join(this.runDir, 'events.jsonl');
    this.eventBus = new EventBus(eventsFile);
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
  isRunning(): boolean { return this.running; }

  /** 本圈结束信号。LoopController 用它等待续圈时机；'done' 才续圈，'error'/'stopped' 终止循环。 */
  whenSettled(): Promise<LapOutcome> { return this.settled; }

  async start(): Promise<void> {
    if (this.running) throw new Error('Orchestrator already running');
    this.running = true;

    // 0. 确保工作流共享 workspace 目录存在
    const workspaceDir = path.join(this.dataDir, 'tradewind', 'workflows', this.workflowId, 'workspace');
    await fs.mkdir(workspaceDir, { recursive: true });

    // 1. 初始化 InputBuffer（每个节点按 handoff 入线数）
    const workCounts = countWorkInputs(this.graph.edges);
    for (const node of this.graph.nodes) {
      const expected = workCounts.get(node.id) ?? 0;
      this.inputBuffers.set(node.id, new InputBuffer(expected));
    }

    // 2. 初始化 EnvelopeRouter
    this.router = new EnvelopeRouter(this.graph.edges, this.inputBuffers);

    // 3. 初始化 ContextBuilder
    this.contextBuilder = new ContextBuilder({
      executionId: this.executionId,
      workflowId: this.workflowId,
      runDir: this.runDir,
      dataDir: this.dataDir,
      mode: this.mode,
      nodes: this.nodeMap,
      inputBuffers: this.inputBuffers,
      router: this.router,
      eventBus: this.eventBus,
      signal: this.abortController.signal,
      onToken: (nodeId, chunk) => this.tokenStream.pushChunk(nodeId, chunk),
    });

    // 4. 初始化 NodeActivator
    const nodeTypes = new Map<string, string>();
    for (const node of this.graph.nodes) {
      nodeTypes.set(node.id, node.type);
    }

    this.activator = new NodeActivator({
      nodeTypes,
      getExecutor: (type) => {
        const exec = this.executors.get(type);
        if (!exec) throw new Error(`No executor for type: ${type}`);
        return exec;
      },
      buildContext: (nodeId) => this.contextBuilder.buildBase(nodeId),
      onDone: (nodeId) => this.handleNodeDone(nodeId),
      onError: (nodeId, err) => this.handleNodeError(nodeId, err),
    });

    // 5. 初始化 ArchiveManager 并写入 meta
    this.archive = new ArchiveManager(this.runDir, this.executionId, this.workflowId);
    await this.archive.writeStart();

    // 5.1 写入 graph 快照（启动时的工作流拓扑，供回溯）
    try {
      const snapshotPath = path.join(this.runDir, 'graph-snapshot.json');
      await fs.writeFile(snapshotPath, JSON.stringify(this.graph, null, 2));
    } catch { /* 非关键，静默 */ }

    // 5.5 登记本次工作流涉及的 Agent，供控制台显示运行来源。
    for (const node of this.graph.nodes) {
      if (node.type !== 'agent') continue;
      const agentId = (node.config as { agentId?: string }).agentId;
      if (!agentId) continue;
      if (!this.agentActivities.has(agentId)) {
        this.agentActivities.set(agentId, beginAgentActivity(agentId, 'tradewind'));
      }
    }

    // 5.6 初始化 Contact Registry（横向联络 label→nodeId 索引）
    const labelMap: Record<string, string> = {};
    for (const node of this.graph.nodes) {
      labelMap[node.id] = node.label || node.id;
    }
    initContactRegistry(labelMap, activeNodeRunners);

    // 6. 预计算 note 注入（编译期：查找 note 边，读取源 Note 节点的 content）
    const noteContents = new Map<string, string[]>(); // targetNodeId → note 内容列表
    for (const edge of this.graph.edges) {
      if (edge.kind !== 'note') continue;
      const sourceNode = this.nodeMap.get(edge.source);
      if (!sourceNode || sourceNode.type !== 'note') continue;
      const content = (sourceNode.config as { content?: string }).content;
      if (!content) continue;
      const list = noteContents.get(edge.target) ?? [];
      list.push(content);
      noteContents.set(edge.target, list);
    }

    // 6.5 预计算下游感知（handoff 边的目标节点 label）：供 agent 知道"我 complete_task 后
    // 信封自动交给谁"，避免误用 contact 把有自动下游的整包工作前向甩锅（流水线工人模型：
    // 每人只需知直接下游，不给全量工作图）。
    const downstreamLabels = new Map<string, string[]>(); // sourceNodeId → 下游 label 列表
    for (const edge of this.graph.edges) {
      if (edge.kind !== 'handoff') continue;
      const targetNode = this.nodeMap.get(edge.target);
      if (!targetNode) continue;
      const list = downstreamLabels.get(edge.source) ?? [];
      list.push(targetNode.label || targetNode.id);
      downstreamLabels.set(edge.source, list);
    }

    // 7. 激活所有节点
    // Entry 节点：buffer expected=0，waitForInputs 立即 resolve
    // 其他节点：挂起在 waitForInputs 直到 handoff 信封到齐
    for (const node of this.graph.nodes) {
      if (node.type === 'entry') {
        node.config._initialInput = this.initialInput;
        // 循环中的一圈：把循环上下文交给 Entry，供它给出线信封盖信封皮
        if (this.loopContext) node.config._loopContext = this.loopContext;
      }
      // 注入 _nodeLabel 供 executor 读取
      node.config._nodeLabel = node.label;
      // 注入 _notes 供 agent executor 读取
      const notes = noteContents.get(node.id);
      if (notes) node.config._notes = notes;
      // 注入 _downstreamLabels 供 agent executor 读取（下游感知）
      const dsLabels = downstreamLabels.get(node.id);
      if (dsLabels && dsLabels.length) node.config._downstreamLabels = dsLabels;

      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        nodeId: node.id,
        eventTypeId: BUILTIN_EVENT_IDS.NODE_ACTIVATE,
      });
      this.activator.activate(node.id);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    // 兜底：若本圈未经 output/error 就被外部停止，也要 resolve settled，
    // 否则等待中的 LoopController 会永挂。Promise 只 resolve 一次，重复调用无害。
    this.settledResolve('stopped');

    // 写终结状态：被 stop 掐断的圈（未跑到 output）此前会因 handleNodeDone 闸门而不写 meta，
    // 永留 'running'。这里补写 'stopped'，使 meta 状态真实反映"被中止"而非崩溃残留。
    // ?. 守卫：gap 期停整个循环时 archive 可能尚未在 start() 中建立。
    await this.archive?.writeEnd('stopped');

    // 0. 清理 Contact Registry
    clearContactRegistry();

    // 0.1 清理控制台活动状态。
    for (const activity of this.agentActivities.values()) activity.end();
    this.agentActivities.clear();

    // 0.5 主动 flush 所有活跃 NodeRunner 的 messages（防止 abort 后来不及 persist）
    for (const [, runner] of activeNodeRunners) {
      try { await runner.flush(); } catch { /* 忽略 */ }
    }

    // 1. 中止所有等待中的 buffer
    this.abortController.abort();
    for (const buffer of this.inputBuffers.values()) {
      buffer.abort();
    }

    // 2. 等 EventBus 落盘完成
    await this.eventBus.flush();

    // 3. 关闭 SSE 连接
    this.eventBus.closeAll();
    this.tokenStream.closeAll();

    // 4. 清理节点上下文存储
    clearNodeContextStore(this.executionId);
    clearNodeStatusStore(this.executionId);
  }

  private handleNodeDone(nodeId: string): void {
    // 运行态闸门：stop() 第一件事就是 running=false。abort 会让卡在 waitForInputs 的
    // 节点（尤其 output）抛 BufferAbortError，被 NodeActivator 当正常收尾走 onDone→此处。
    // 若不挡，output 会在"从未收到交接"的情况下伪造 lap-done + writeEnd('done')。
    if (!this.running) return;

    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    if (node.type === 'output') {
      // 单圈完成：归档 + 收尾（释放锁、清 runner）。
      // 循环 vs 单次的区别由 settled 信号交给上层判断——本圈无论如何都 stop（每圈全新 Orchestrator）。
      // 非循环（单次运行）时上层无人 await settled，等价于原 WORKFLOW_END + stop 行为。
      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        nodeId,
        eventTypeId: this.loopContext
          ? BUILTIN_EVENT_IDS.LAP_DONE
          : BUILTIN_EVENT_IDS.WORKFLOW_END,
      });
      this.archive.writeEnd('done');
      this.settledResolve('done');
      this.stop();
    }
  }

  private handleNodeError(nodeId: string, error: Error): void {
    // 同 handleNodeDone：stop() 后（running=false）到来的 error 是 teardown 噪声，
    // settled 已由 stop() resolve('stopped')，不再覆写 meta / 重复 resolve。
    if (!this.running) return;

    console.error(`[orchestrator] Node ${nodeId} failed:`, error.message);
    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      nodeId,
      eventTypeId: 'node-error',
      payload: { message: error.message },
    });
    this.archive.writeEnd('error');
    this.settledResolve('error');
    this.stop();
  }
}


