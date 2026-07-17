/**
 * 信风路由 — Phase R4
 *
 * 端点：
 *   POST /run                    启动工作流执行
 *   POST /stop                   停止当前执行
 *   GET  /events                 SSE 事件流
 *   GET  /health                 健康检查
 *   POST /workflow/save          保存工作流
 *   GET  /workflow/load/:id      加载工作流
 *   GET  /workflow/list          列出所有工作流
 *   DELETE /workflow/:id         删除工作流
 *   POST /meeting/:nodeId/speak  会议发言
 *   POST /meeting/:nodeId/chair  会长私聊
 *   POST /meeting/:nodeId/end    结束会议
 *   GET  /meeting/:nodeId/status 会议状态
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../engine/shared/atomic-io';
import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import type { WorkflowGraph, WorkflowMode } from '../engine/tradewind/foundation/types';
import { Orchestrator, LoopController } from '../engine/tradewind/orchestrator';
import type { LoopConfig } from '../engine/tradewind/orchestrator';
import { loadProfiles, saveProfiles, findProfile, autoProfileToLoopConfig } from '../engine/shared/profile-store';
import type { AutoProfile } from '../engine/tradewind/foundation/types';
import { EntryExecutor } from '../engine/tradewind/nodes/entry';
import { OutputExecutor } from '../engine/tradewind/nodes/output';
import { AgentExecutor, activeNodeRunners } from '../engine/tradewind/nodes/agent';
import { MeetingExecutor, activeMeetings } from '../engine/tradewind/nodes/meeting';
import { NoteExecutor } from '../engine/tradewind/nodes/note';
import { HumanGateExecutor, activeHumanGates } from '../engine/tradewind/nodes/human-gate';
import { handleSpeak, handleChair, handleEnd } from '../engine/tradewind/execution/meeting-handlers';
import { compactMeetingIfNeeded, MEETING_COMPACT_THRESHOLD } from '../engine/tradewind/execution/context-compactor';
import { addClient, removeClient, broadcastToMeeting, clearClients } from '../engine/tradewind/streaming/meeting-broadcast';
import { addUnifiedClient, removeUnifiedClient } from '../engine/tradewind/streaming/unified-stream';
import { getEnvelopePending } from '../engine/tradewind/foundation/node-status-store';
import { getMeetingsDir, getMeetingFileName } from '../engine/tradewind/foundation/archive-paths';
import { validateWorkflow } from '../engine/tradewind/foundation/workflow-validator';
import { loadAgent } from '../engine/shared/agent-loader';
import { agentRegistryFile, tradewindRunDir, tradewindWorkflowsDir } from '../services/data-paths.js';

/** 获取会长的 model key（用于压缩摘要 LLM 调用） */
async function getChairModel(dataDir: string, chairAgentId: string): Promise<string> {
  const agent = await loadAgent(dataDir, chairAgentId);
  return agent?.model || '';
}

/** 当前活跃的 orchestrator 实例（单执行，后续改为 Map）。循环模式下指向当前圈。 */
let activeOrchestrator: Orchestrator | null = null;
/** 当前活跃的循环控制器（循环模式）；单次运行时为 null */
let activeLoop: LoopController | null = null;

/** 统一存活判定：循环存活（含圈间 gap）或单圈存活 */
function isExecutionRunning(): boolean {
  return !!(activeLoop?.isRunning() || activeOrchestrator?.isRunning());
}

export async function stopActiveTradewindExecution(): Promise<void> {
  if (activeLoop?.isRunning()) {
    await activeLoop.stop();
    activeLoop = null;
    return;
  }
  if (activeOrchestrator?.isRunning()) await activeOrchestrator.stop();
}

export async function tradewindRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  // 注册内置 executor
  const executors = new Map();
  executors.set('entry', new EntryExecutor());
  executors.set('output', new OutputExecutor());
  executors.set('agent', new AgentExecutor());
  executors.set('meeting', new MeetingExecutor());
  executors.set('note', new NoteExecutor());
  executors.set('human-gate', new HumanGateExecutor());

  /** POST /run — 启动工作流 */
  app.post('/run', async (req, reply) => {
    if (isExecutionRunning()) {
      return reply.status(409).send({ error: 'Execution already running' });
    }

    const body = req.body as {
      graph: WorkflowGraph;
      workflowId: string;
      initialInput?: string;
      mode?: WorkflowMode;
      /** 循环档案 ID：仅 mode='auto' 时有意义；manual 一律忽略 */
      profileId?: string;
    };

    if (!body.graph || !body.workflowId) {
      return reply.status(400).send({ error: 'Missing graph or workflowId' });
    }

    const mode: WorkflowMode = body.mode === 'auto' ? 'auto' : 'manual';

    // 启动前校验图结构（基础：无环 / 入出线 / 类型 / agent 引用 …；
    // 自动模式追加：否决会议室/暂停点 + 模型须 native）。前端据 errors[].nodeId 高亮否决。
    const knownNodeTypes = new Set(executors.keys());
    const errors = await validateWorkflow(body.graph, dataDir, knownNodeTypes, mode);
    if (errors.length > 0) {
      return reply.status(400).send({ error: '工作流校验未通过', errors });
    }

    // 循环内生于 auto：manual 一律不循环；auto 且指定了可映射的 profile 才起 LoopController。
    let loopConfig: LoopConfig | null = null;
    if (mode === 'auto' && body.profileId) {
      const profiles = await loadProfiles(dataDir, body.workflowId);
      const profile = findProfile(profiles, body.profileId);
      if (!profile) {
        return reply.status(404).send({ error: `档案不存在：${body.profileId}` });
      }
      loopConfig = autoProfileToLoopConfig(profile);
      // absolute（潮汐）档本刀不支持循环执行 → 降级单圈 + 日志说明
      if (!loopConfig) {
        console.warn(`[tradewind] profile ${body.profileId} 为 absolute 档，本刀不支持循环，降级单圈`);
      }
    }

    // 循环模式：LoopController 常驻，每圈起跑时把当前 Orchestrator 挂到 activeOrchestrator
    if (loopConfig) {
      activeLoop = new LoopController({
        graph: body.graph,
        dataDir,
        workflowId: body.workflowId,
        executors,
        initialInput: body.initialInput,
        mode,
        loop: loopConfig,
        onLapStart: (orch) => { activeOrchestrator = orch; },
      });
      await activeLoop.start();
      // start 后 onLapStart 已同步设好首圈 activeOrchestrator
      return reply.send({
        executionId: activeOrchestrator?.getExecutionId() ?? '',
        runDir: activeOrchestrator?.getRunDir() ?? '',
        loop: true,
      });
    }

    // 单次运行（manual，或 auto 无 profile / absolute 降级）：行为与循环无关，完全不变
    activeLoop = null;
    activeOrchestrator = new Orchestrator({
      graph: body.graph,
      dataDir,
      workflowId: body.workflowId,
      executors,
      initialInput: body.initialInput,
      mode,
    });

    await activeOrchestrator.start();
    return reply.send({
      executionId: activeOrchestrator.getExecutionId(),
      runDir: activeOrchestrator.getRunDir(),
    });
  });

  /** POST /stop — 停止当前执行 */
  app.post('/stop', async (_req, reply) => {
    if (!isExecutionRunning()) {
      return reply.status(404).send({ error: 'No running execution' });
    }
    await stopActiveTradewindExecution();
    return reply.send({ stopped: true });
  });

  /** GET /status — 当前执行状态（用于前端刷新后恢复） */
  app.get('/status', async (_req, reply) => {
    if (!isExecutionRunning() || !activeOrchestrator) {
      return reply.send({ running: false });
    }
    return reply.send({
      running: true,
      executionId: activeOrchestrator.getExecutionId(),
      workflowId: activeOrchestrator.getWorkflowId(),
      runDir: activeOrchestrator.getRunDir(),
      ...(activeLoop ? { loop: true, lap: activeLoop.getLapIndex() } : {}),
    });
  });

  /** GET /nodes/status — 所有节点的运行时状态（前端轮询用） */
  app.get('/nodes/status', async (_req, reply) => {
    // 循环模式下用统一存活判定：圈间 gap 期 activeLoop 仍存活，不能因当前圈已 stop 就误报 stopped。
    if (!isExecutionRunning()) {
      return reply.send({ running: false, nodes: {} });
    }
    const lap = activeLoop ? activeLoop.getLapIndex() : undefined;
    // gap 期 activeOrchestrator 可能指向已停实例：拿不到执行态就回空节点表，但 running 仍为 true。
    if (!activeOrchestrator) {
      return reply.send({ running: true, nodes: {}, ...(lap !== undefined ? { lap } : {}) });
    }
    const executionId = activeOrchestrator.getExecutionId();
    const envelopePending = getEnvelopePending(executionId);
    const nodes: Record<string, {
      busy: boolean;
      envelopePending: boolean;
      humanGate?: { waiting: true; envelopeContent: string; arrivedAt: number };
    }> = {};

    // Agent 节点：runner.isBusy()
    for (const [nodeId, runner] of activeNodeRunners) {
      nodes[nodeId] = {
        busy: runner.isBusy(),
        envelopePending: envelopePending.has(nodeId),
      };
    }
    // Meeting 节点：session.busy
    for (const [nodeId, meeting] of activeMeetings) {
      nodes[nodeId] = {
        busy: meeting.session.busy,
        envelopePending: envelopePending.has(nodeId),
      };
    }
    // Human Gate 节点：等待人类决策
    for (const [nodeId, gate] of activeHumanGates) {
      nodes[nodeId] = {
        busy: false,
        envelopePending: envelopePending.has(nodeId),
        humanGate: {
          waiting: true,
          envelopeContent: gate.envelopeContent,
          arrivedAt: gate.arrivedAt,
        },
      };
    }
    // envelopePending 但 runner/meeting/gate 还没注册的节点（waitForInputs 阶段）
    for (const nodeId of envelopePending) {
      if (!nodes[nodeId]) {
        nodes[nodeId] = { busy: false, envelopePending: true };
      }
    }

    return reply.send({ running: true, nodes, executionId, ...(lap !== undefined ? { lap } : {}) });
  });

  /** POST /human-gate/:nodeId/submit — 人类编辑后继续 */
  app.post('/human-gate/:nodeId/submit', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const body = req.body as { content?: string };

    const gate = activeHumanGates.get(nodeId);
    if (!gate) return reply.status(404).send({ error: '该节点没有等待中的审查' });

    // content 为空或未传 → 使用原始信封内容（不编辑直接放行）
    const content = (body.content ?? gate.envelopeContent).trim() || gate.envelopeContent;
    gate.resolve({ content });
    return reply.send({ ok: true });
  });

  /** GET /events — SSE 事件流 */
  app.get('/events', (req, reply) => {
    if (!activeOrchestrator) {
      return reply.status(404).send({ error: 'No execution' });
    }

    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    raw.write('\n');

    activeOrchestrator.getEventBus().subscribe(raw);
  });

  // ── Workflow CRUD ──────────────────────────────────────────────

  const workflowsDir = tradewindWorkflowsDir(dataDir);

  /** POST /workflow/save — 保存工作流 */
  app.post('/workflow/save', async (req, reply) => {
    const body = req.body as { workflowId: string; graph: WorkflowGraph; name?: string };
    if (!body.workflowId || !body.graph) {
      return reply.status(400).send({ error: 'Missing workflowId or graph' });
    }
    const wfDir = path.join(workflowsDir, body.workflowId);
    await fs.mkdir(path.join(wfDir, 'workspace'), { recursive: true });
    await atomicWriteFile(path.join(wfDir, 'graph.json'), JSON.stringify(body.graph, null, 2));
    await atomicWriteFile(path.join(wfDir, 'meta.json'), JSON.stringify({
      workflowId: body.workflowId,
      name: body.name || body.workflowId,
      updatedAt: new Date().toISOString(),
    }, null, 2));
    return reply.send({ saved: true, workflowId: body.workflowId });
  });

  /** GET /workflow/load/:id — 加载工作流 */
  app.get('/workflow/load/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const wfDir = path.join(workflowsDir, id);
    const graphFile = path.join(wfDir, 'graph.json');
    const metaFile = path.join(wfDir, 'meta.json');
    try {
      const graphRaw = await fs.readFile(graphFile, 'utf-8');
      const graph = JSON.parse(graphRaw);
      let name = id;
      try {
        const metaRaw = await fs.readFile(metaFile, 'utf-8');
        name = JSON.parse(metaRaw).name || id;
      } catch { /* meta 可选 */ }
      return reply.send({ workflowId: id, name, graph });
    } catch {
      return reply.status(404).send({ error: 'Workflow not found' });
    }
  });

  /** GET /workflow/list — 列出所有工作流 */
  app.get('/workflow/list', async (_req, reply) => {
    try {
      await fs.mkdir(workflowsDir, { recursive: true });
      const entries = await fs.readdir(workflowsDir, { withFileTypes: true });
      const workflows = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        try {
          const metaRaw = await fs.readFile(path.join(workflowsDir, entry.name, 'meta.json'), 'utf-8');
          const meta = JSON.parse(metaRaw);
          let nodeCount = 0;
          try {
            const graphRaw = await fs.readFile(path.join(workflowsDir, entry.name, 'graph.json'), 'utf-8');
            nodeCount = JSON.parse(graphRaw).nodes?.length ?? 0;
          } catch { /* graph 可选 */ }
          workflows.push({
            workflowId: meta.workflowId || entry.name,
            name: meta.name || entry.name,
            nodeCount,
            updatedAt: meta.updatedAt,
          });
        } catch { /* skip dirs without meta.json */ }
      }
      return reply.send({ workflows });
    } catch {
      return reply.send({ workflows: [] });
    }
  });

  /** DELETE /workflow/:id — 删除工作流 */
  app.delete('/workflow/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const wfDir = path.join(workflowsDir, id);
    try {
      await fs.rm(wfDir, { recursive: true });
      return reply.send({ deleted: true });
    } catch {
      return reply.status(404).send({ error: 'Workflow not found' });
    }
  });

  // ── AutoProfile CRUD（循环档案，独立 profiles.json，图保持 mode-free）────

  /** GET /workflow/:id/profiles — 列出一个工作流的全部循环档案 */
  app.get('/workflow/:id/profiles', async (req, reply) => {
    const { id } = req.params as { id: string };
    const profiles = await loadProfiles(dataDir, id);
    return reply.send({ profiles });
  });

  /** POST /workflow/:id/profiles — 覆盖写整个档案数组（前端整存） */
  app.post('/workflow/:id/profiles', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { profiles?: AutoProfile[] };
    if (!Array.isArray(body.profiles)) {
      return reply.status(400).send({ error: 'Missing profiles array' });
    }
    // 基础 shape 校验：id/name 必填、cadence 合法、lapBound/carryOver 合法
    for (const p of body.profiles) {
      const okCadence = p.cadence?.kind === 'relative'
        ? typeof (p.cadence as { gapSec?: unknown }).gapSec === 'number' && p.cadence.gapSec >= 0
        : p.cadence?.kind === 'absolute';
      const okBound = p.lapBound === null || (typeof p.lapBound === 'number' && p.lapBound > 0);
      if (!p.id || !p.name || !okCadence || !okBound
        || (p.carryOver !== 'accumulate' && p.carryOver !== 'reset' && p.carryOver !== 'summary')) {
        return reply.status(400).send({ error: `档案字段非法：${p.id || '(缺 id)'}` });
      }
    }
    await saveProfiles(dataDir, id, body.profiles);
    return reply.send({ saved: true, count: body.profiles.length });
  });

  /** DELETE /workflow/:id/profiles/:profileId — 删单个档案 */
  app.delete('/workflow/:id/profiles/:profileId', async (req, reply) => {
    const { id, profileId } = req.params as { id: string; profileId: string };
    const profiles = await loadProfiles(dataDir, id);
    const next = profiles.filter(p => p.id !== profileId);
    if (next.length === profiles.length) {
      return reply.status(404).send({ error: `档案不存在：${profileId}` });
    }
    await saveProfiles(dataDir, id, next);
    return reply.send({ deleted: true });
  });

  /** GET /health — 健康检查 */
  app.get('/health', async (_req, reply) => {
    return reply.send({
      status: activeOrchestrator?.isRunning() ? 'running' : 'idle',
    });
  });

  // ── Agent 列表 ──────────────────────────────────────────────

  /** GET /agents — 返回全局 Agent 池摘要列表 */
  app.get('/agents', async (_req, reply) => {
    const registryFile = agentRegistryFile(dataDir);
    try {
      const raw = await fs.readFile(registryFile, 'utf-8');
      const registry = JSON.parse(raw) as Record<string, { name?: string; model?: string }>;
      const agents = Object.entries(registry).map(([id, entry]) => ({
        id,
        name: entry.name || id,
        model: entry.model || '',
      }));
      return reply.send({ agents });
    } catch {
      return reply.send({ agents: [] });
    }
  });

  // ── Agent 节点对话（SSE） ───────────────────────────────────────

  /** POST /chat/:nodeId — 人类向 Agent 节点发消息 */
  app.post('/chat/:nodeId', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const { message } = req.body as { message: string };

    if (!message) {
      return reply.status(400).send({ error: 'Missing message' });
    }

    const runner = activeNodeRunners.get(nodeId);
    if (!runner) {
      return reply.status(404).send({ error: '节点尚未激活，请先启动工作流' });
    }
    if (runner.isBusy()) {
      return reply.status(409).send({ error: '节点正在处理上一条消息，请稍后再试' });
    }

    runner.push({ source: 'human', content: message });
    return reply.send({ ok: true });
  });

  // ── 统一 SSE 端点（解决浏览器 6 连接上限） ─────────────────────

  /** GET /stream — 所有活跃节点的事件统一推送（单连接复用） */
  app.get('/stream', (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('\n');

    addUnifiedClient(raw);

    // 发送所有活跃 agent 节点的 connected 快照
    for (const [nodeId, runner] of activeNodeRunners) {
      const snap = { scope: 'agent', nodeId, type: 'connected', busy: runner.isBusy() };
      try { raw.write(`data: ${JSON.stringify(snap)}\n\n`); } catch {}
    }
    // 发送所有活跃会议室的 connected 快照
    for (const [nodeId, meeting] of activeMeetings) {
      const snap = {
        scope: 'meeting', nodeId, type: 'connected',
        phase: meeting.session.phase,
        round: meeting.session.round,
        messages: meeting.session.publicMessages,
        chairMessages: meeting.session.chairMessages,
        participants: meeting.session.participants,
        configuredParticipants: meeting.configuredParticipants,
      };
      try { raw.write(`data: ${JSON.stringify(snap)}\n\n`); } catch {}
    }

    // 心跳保活
    const hb = setInterval(() => {
      try { raw.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
    }, 15_000);

    req.raw.on('close', () => {
      clearInterval(hb);
      removeUnifiedClient(raw);
    });
  });

  /** GET /chat/:nodeId/events — Agent 节点持久 SSE 事件流（信封/人类消息处理均推送） */
  app.get('/chat/:nodeId/events', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const runner = activeNodeRunners.get(nodeId);
    if (!runner) {
      return reply.status(404).send({ error: '节点尚未激活' });
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 发送连接确认 + 当前状态
    const connected = { type: 'connected', busy: runner.isBusy() };
    raw.write(`data: ${JSON.stringify(connected)}\n\n`);

    const listener = (ev: any) => {
      try { raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
    };
    runner.addEventListener(listener);

    // 客户端断开时清理
    req.raw.on('close', () => {
      runner.removeEventListener(listener);
    });
  });

  /** GET /chat/:nodeId/messages — 获取节点对话历史 */
  app.get('/chat/:nodeId/messages', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const runner = activeNodeRunners.get(nodeId);
    if (runner) {
      return reply.send({ messages: runner.getMessages() });
    }
    // fallback：从磁盘读取持久化的 messages（runDir = runs/{workflowId}/{executionId}）
    const execId = activeOrchestrator?.getExecutionId?.();
    const wfId = activeOrchestrator?.getWorkflowId?.();
    if (execId && wfId) {
      const msgPath = path.join(tradewindRunDir(dataDir, wfId, execId), 'nodes', nodeId, 'messages.json');
      try {
        const raw = await fs.readFile(msgPath, 'utf-8');
        return reply.send({ messages: JSON.parse(raw) });
      } catch { /* file not found */ }
    }
    return reply.send({ messages: [] });
  });

  /** GET /chat/:nodeId/status — 节点对话状态 */
  app.get('/chat/:nodeId/status', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const runner = activeNodeRunners.get(nodeId);
    if (!runner) {
      return reply.status(404).send({ error: '节点尚未激活' });
    }
    return reply.send({ busy: runner.isBusy() });
  });

  /**
   * GET /chat/:nodeId/snapshot — 订阅对账快照
   * 返回 { messages, roundLog, busy, lastSeq }。
   * 前端订阅时拉一次：messages 渲染历史，busy 时回放 roundLog 显示进行中轮次，
   * 之后只应用 seq > lastSeq 的增量事件。彻底消除"面板晚开/订阅竞态丢事件"。
   */
  app.get('/chat/:nodeId/snapshot', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const runner = activeNodeRunners.get(nodeId);
    if (runner) {
      return reply.send(runner.getSnapshot());
    }
    // 节点未激活：回退磁盘 messages，无进行中轮次
    const execId = activeOrchestrator?.getExecutionId?.();
    const wfId = activeOrchestrator?.getWorkflowId?.();
    if (execId && wfId) {
      const msgPath = path.join(tradewindRunDir(dataDir, wfId, execId), 'nodes', nodeId, 'messages.json');
      try {
        const raw = await fs.readFile(msgPath, 'utf-8');
        const all = JSON.parse(raw) as Array<{ role: string; content: string }>;
        const messages = all.filter((_, i) => i !== 0); // 去首条 system
        return reply.send({ messages, roundLog: [], busy: false, lastSeq: 0 });
      } catch { /* file not found */ }
    }
    return reply.send({ messages: [], roundLog: [], busy: false, lastSeq: 0 });
  });

  /** POST /chat/:nodeId/abort — 中止 Agent 节点当前轮次（仅 human 轮；envelope 轮请用 /pause） */
  app.post('/chat/:nodeId/abort', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const runner = activeNodeRunners.get(nodeId);
    if (!runner) {
      return reply.status(404).send({ error: '节点尚未激活' });
    }
    if (!runner.isBusy()) {
      return reply.status(409).send({ error: '节点当前没有在处理消息' });
    }
    runner.abortRound();
    return reply.send({ aborted: true });
  });

  /**
   * POST /chat/:nodeId/pause — 暂停 Agent 节点当前信封轮（软中止 + 扣住信封）。
   * envelope 轮没有"单独取消"的合法出口：只能暂停后续跑，或 /stop 停整个工作流。
   */
  app.post('/chat/:nodeId/pause', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const runner = activeNodeRunners.get(nodeId);
    if (!runner) {
      return reply.status(404).send({ error: '节点尚未激活' });
    }
    if (!runner.pause()) {
      return reply.status(409).send({ error: '节点当前没有可暂停的信封轮' });
    }
    return reply.send({ paused: true });
  });

  /**
   * POST /chat/:nodeId/resume — 续跑已暂停的信封轮（重跑本轮，便宜版）。
   * 真封口（complete_task/anomaly）才会投递下游。
   */
  app.post('/chat/:nodeId/resume', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const runner = activeNodeRunners.get(nodeId);
    if (!runner) {
      return reply.status(404).send({ error: '节点尚未激活' });
    }
    if (!runner.resume()) {
      return reply.status(409).send({ error: '节点当前没有已暂停的信封轮' });
    }
    return reply.send({ resumed: true });
  });

  // ── Meeting 端点 ──────────────────────────────────────────────

  /** GET /meeting/:nodeId/events — 会议室统一 SSE 事件流（持久连接） */
  app.get('/meeting/:nodeId/events', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('\n');

    addClient(nodeId, raw);

    // 发送当前快照事件——仅发给刚连上的 client，不广播给其他已连接的标签页
    const snapshot = {
      type: 'connected' as const,
      phase: meeting.session.phase,
      round: meeting.session.round,
      messages: meeting.session.publicMessages,
      chairMessages: meeting.session.chairMessages,
      participants: meeting.session.participants,
      configuredParticipants: meeting.configuredParticipants,
    };
    try { raw.write(`data: ${JSON.stringify(snapshot)}\n\n`); } catch {}

    // SSE 心跳保活（15s 间隔）
    const hb = setInterval(() => {
      try { raw.write(': heartbeat\n\n'); } catch { clearInterval(hb); }
    }, 15_000);

    req.raw.on('close', () => {
      clearInterval(hb);
      removeClient(nodeId, raw);
    });
  });

  /** POST /meeting/:nodeId/speak — 人类发言（SSE 流式） */
  app.post('/meeting/:nodeId/speak', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const { message } = req.body as { message: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    if (meeting.session.phase !== 'discussion') return reply.status(409).send({ error: '会议尚未进入讨论阶段' });
    if (meeting.session.busy) return reply.status(409).send({ error: 'Round in progress' });

    // SSE 流式响应
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('\n');

    // SSE 心跳保活（15s 间隔）
    const hb = setInterval(() => { try { raw.write(': heartbeat\n\n'); } catch {} }, 15_000);

    // 创建本轮次的 AbortController
    const roundAbort = new AbortController();
    meeting.roundAbort = roundAbort;
    // 组合信号：orchestrator 全局 abort 或本轮 abort 均可中断
    const onGlobalAbort = () => roundAbort.abort();
    meeting.signal.addEventListener('abort', onGlobalAbort, { once: true });

    handleSpeak({
      dataDir: meeting.dataDir,
      workspace: meeting.workspace,
      session: meeting.session,
      humanMessage: message,
      signal: roundAbort.signal,
      teamRoster: meeting.teamRoster,
      onEvent: (ev) => {
        try { raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
        broadcastToMeeting(nodeId, ev);
      },
    }).then(async (speakPromptTokens) => {
      meeting.roundAbort = null;
      meeting.signal.removeEventListener('abort', onGlobalAbort);
      clearInterval(hb);
      // 归档会议记录
      if (meeting.runDir) {
        const meetDir = getMeetingsDir(meeting.runDir);
        const fileName = getMeetingFileName(nodeId, meeting.session.round);
        fs.mkdir(meetDir, { recursive: true })
          .then(() => atomicWriteFile(
            `${meetDir}/${fileName}`,
            JSON.stringify(meeting.session.publicMessages, null, 2),
          ))
          .catch(() => {});
      }
      // abort 后跳过压缩（用户想停就停，不做额外工作）
      if (roundAbort.signal.aborted) {
        meeting.session.busy = false;
        const roundDoneEvent = { type: 'round-done' as const, messages: meeting.session.publicMessages, compacted: false };
        try { raw.write(`data: ${JSON.stringify(roundDoneEvent)}\n\n`); raw.end(); } catch {}
        broadcastToMeeting(nodeId, roundDoneEvent);
        return;
      }
      // 会议室压缩检查（speak 周期完整结束后）
      // 压缩期间重置 busy 防止并发 speak
      meeting.session.busy = true;
      const compacted = await compactMeetingIfNeeded(
        meeting.session.publicMessages,
        speakPromptTokens,
        meeting.compactState,
        {
          dataDir: meeting.dataDir,
          model: await getChairModel(meeting.dataDir, meeting.session.chairAgentId),
          archiveDir: meeting.compactArchiveDir,
          threshold: MEETING_COMPACT_THRESHOLD,
          onEvent: (ev) => {
            try { raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
            broadcastToMeeting(nodeId, ev);
          },
        },
        meeting.session.participants.map(p => p.label),
        meeting.teamRoster,
      );
      meeting.session.busy = false;
      const roundDoneEvent = { type: 'round-done' as const, messages: meeting.session.publicMessages, compacted };
      try {
        raw.write(`data: ${JSON.stringify(roundDoneEvent)}\n\n`);
        raw.end();
      } catch {}
      broadcastToMeeting(nodeId, roundDoneEvent);
    }).catch((e) => {
      meeting.roundAbort = null;
      meeting.signal.removeEventListener('abort', onGlobalAbort);
      clearInterval(hb);
      const errEvent = { type: 'error' as const, message: (e as Error).message };
      try {
        raw.write(`data: ${JSON.stringify(errEvent)}\n\n`);
        raw.end();
      } catch {}
      broadcastToMeeting(nodeId, errEvent);
    });
  });

  /** POST /meeting/:nodeId/abort-round — 人类中断当前轮次 */
  app.post('/meeting/:nodeId/abort-round', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    if (!meeting.session.busy) return reply.status(409).send({ error: 'No round in progress' });
    if (meeting.roundAbort) {
      meeting.roundAbort.abort();
    }
    return reply.send({ ok: true });
  });

  /** POST /meeting/:nodeId/chair — 人类给会长发消息（SSE 流式） */
  app.post('/meeting/:nodeId/chair', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const { message } = req.body as { message: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    if (meeting.session.phase === 'opening') return reply.status(409).send({ error: '会议尚未进入讨论阶段' });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write('\n');

    // SSE 心跳保活（15s 间隔）
    const hb = setInterval(() => { try { raw.write(': heartbeat\n\n'); } catch {} }, 15_000);

    handleChair({
      dataDir: meeting.dataDir,
      session: meeting.session,
      humanMessage: message,
      signal: meeting.signal,
      onEvent: (ev) => {
        try { raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
        broadcastToMeeting(nodeId, ev);
      },
    }).then(() => {
      clearInterval(hb);
      const chairDoneEvent = { type: 'done', messages: meeting.session.chairMessages };
      try {
        raw.write(`data: ${JSON.stringify(chairDoneEvent)}\n\n`);
        raw.end();
      } catch {}
      broadcastToMeeting(nodeId, { type: 'chair-done', content: '' });
    }).catch((e) => {
      clearInterval(hb);
      const errEvent = { type: 'error' as const, message: (e as Error).message };
      try {
        raw.write(`data: ${JSON.stringify(errEvent)}\n\n`);
        raw.end();
      } catch {}
      broadcastToMeeting(nodeId, errEvent);
    });
  });

  /** POST /meeting/:nodeId/end — 人类结束会议 */
  app.post('/meeting/:nodeId/end', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    if (meeting.session.phase !== 'discussion') return reply.status(409).send({ error: '会议尚未进入讨论阶段' });

    // busy 等待：如果当前轮次刚被 abort，handleSpeak 还在收尾（清 listener、归档），
    // 等最多 3s 让其完成，避免直接 409
    if (meeting.session.busy) {
      const startWait = Date.now();
      while (meeting.session.busy && Date.now() - startWait < 3000) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (meeting.session.busy) return reply.status(409).send({ error: 'Round in progress' });
    }

    broadcastToMeeting(nodeId, { type: 'phase-change', phase: 'ending' });

    const result = await handleEnd({
      dataDir: meeting.dataDir,
      session: meeting.session,
      teamRoster: meeting.teamRoster,
      signal: meeting.signal,
      onEvent: (ev) => {
        if (ev.type === 'chair-token') {
          broadcastToMeeting(nodeId, { type: 'summary-chunk', chunk: ev.chunk });
        } else if (ev.type === 'minutes-done') {
          broadcastToMeeting(nodeId, { type: 'summary-done', minutes: ev.content });
        }
      },
    });

    // 纪要写入 publicMessages（面板可见历史）
    meeting.session.publicMessages.push({
      speaker: '[会长总结]',
      content: result.minutes,
      timestamp: Date.now(),
    });

    // 切为 ended：公共发言锁死，会长私聊继续可用，面板可重开查看历史
    meeting.session.phase = 'ended';
    broadcastToMeeting(nodeId, { type: 'phase-change', phase: 'ended' });

    // resolve → executor 继续执行纪要广播 + sendHandoff
    // 不 clearClients、不删 activeMeetings——直到 orchestrator 清理
    meeting.resolve(result);
    return reply.send({ minutes: result.minutes });
  });

  /** GET /meeting/:nodeId/status — 会议状态 */
  app.get('/meeting/:nodeId/status', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    return reply.send({
      nodeId,
      round: meeting.session.round,
      busy: meeting.session.busy,
      phase: meeting.session.phase,
      messageCount: meeting.session.publicMessages.length,
      participants: meeting.session.participants,
      configuredParticipants: meeting.configuredParticipants,
      chairAgentId: meeting.session.chairAgentId,
      publicMessages: meeting.session.publicMessages,
      chairMessages: meeting.session.chairMessages,
      streamingCurrent: meeting.session.streamingCurrent || null,
    });
  });

  /** POST /meeting/:nodeId/join — 动态加入参与者（按节点 ID） */
  app.post('/meeting/:nodeId/join', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const { participantNodeId } = req.body as { participantNodeId: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    if (!participantNodeId) return reply.status(400).send({ error: 'Missing participantNodeId' });
    // 已在会议中
    if (meeting.session.participants.some(p => p.nodeId === participantNodeId)) {
      return reply.send({ participants: meeting.session.participants });
    }
    // 必须在配置层有资格
    const configured = meeting.configuredParticipants.find(p => p.nodeId === participantNodeId);
    if (!configured) return reply.status(400).send({ error: 'Not in configured participants' });
    meeting.session.participants.push(configured);
    return reply.send({ participants: meeting.session.participants });
  });

  /** POST /meeting/:nodeId/leave — 动态移除参与者（按节点 ID） */
  app.post('/meeting/:nodeId/leave', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const { participantNodeId } = req.body as { participantNodeId: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    if (!participantNodeId) return reply.status(400).send({ error: 'Missing participantNodeId' });
    meeting.session.participants = meeting.session.participants.filter(p => p.nodeId !== participantNodeId);
    return reply.send({ participants: meeting.session.participants });
  });

  /** POST /meeting/:nodeId/reorder — 调整参与者顺序（按节点 ID 数组） */
  app.post('/meeting/:nodeId/reorder', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const { order } = req.body as { order: string[] };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    if (!Array.isArray(order)) return reply.status(400).send({ error: 'Invalid order' });
    // 按 order 重排
    const map = new Map(meeting.session.participants.map(p => [p.nodeId, p]));
    const reordered = order.map(nid => map.get(nid)).filter((p): p is NonNullable<typeof p> => !!p);
    meeting.session.participants = reordered;
    return reply.send({ participants: meeting.session.participants });
  });
}
