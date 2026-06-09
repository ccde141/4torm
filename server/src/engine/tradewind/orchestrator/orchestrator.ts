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
import type { WorkflowGraph, WorkflowNode, NodeExecutor } from '../foundation/types';
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
import { lockAgent, unlockAgent } from '../../shared/agent-lock';

export interface OrchestratorOptions {
  graph: WorkflowGraph;
  dataDir: string;
  workflowId: string;
  executors: Map<string, NodeExecutor>;
  /** 可选：外部提供初始输入内容（Entry 节点用） */
  initialInput?: string;
}

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

  private router!: EnvelopeRouter;
  private activator!: NodeActivator;
  private contextBuilder!: ContextBuilder;
  private archive!: ArchiveManager;
  private abortController = new AbortController();
  private running = false;
  private agentIds = new Set<string>();

  constructor(options: OrchestratorOptions) {
    this.executionId = randomUUID();
    this.graph = options.graph;
    this.dataDir = options.dataDir;
    this.workflowId = options.workflowId;
    this.executors = options.executors;
    this.initialInput = options.initialInput ?? '';

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

    // 5.5 锁定所有 Agent 节点
    for (const node of this.graph.nodes) {
      if (node.type !== 'agent') continue;
      const agentId = (node.config as { agentId?: string }).agentId;
      if (!agentId) continue;
      try {
        await lockAgent(this.dataDir, agentId, 'tradewind');
        this.agentIds.add(agentId);
      } catch (e) {
        console.warn(`[orchestrator] 无法锁定 Agent ${agentId}: ${(e as Error).message}`);
      }
    }

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

    // 7. 激活所有节点
    // Entry 节点：buffer expected=0，waitForInputs 立即 resolve
    // 其他节点：挂起在 waitForInputs 直到 handoff 信封到齐
    for (const node of this.graph.nodes) {
      if (node.type === 'entry') {
        node.config._initialInput = this.initialInput;
      }
      // 注入 _nodeLabel 供 executor 读取
      node.config._nodeLabel = node.label;
      // 注入 _notes 供 agent executor 读取
      const notes = noteContents.get(node.id);
      if (notes) node.config._notes = notes;

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

    // 0. 释放所有 Agent 锁
    for (const agentId of this.agentIds) {
      try { await unlockAgent(this.dataDir, agentId, 'tradewind'); } catch { /* 忽略 */ }
    }
    this.agentIds.clear();

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
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    if (node.type === 'output') {
      this.eventBus.emit({
        timestamp: new Date().toISOString(),
        nodeId,
        eventTypeId: BUILTIN_EVENT_IDS.WORKFLOW_END,
      });
      this.archive.writeEnd('done');
      this.stop();
    }
  }

  private handleNodeError(nodeId: string, error: Error): void {
    console.error(`[orchestrator] Node ${nodeId} failed:`, error.message);
    this.eventBus.emit({
      timestamp: new Date().toISOString(),
      nodeId,
      eventTypeId: 'node-error',
      payload: { message: error.message },
    });
    this.archive.writeEnd('error');
    this.stop();
  }
}


