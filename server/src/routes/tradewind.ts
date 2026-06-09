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
import type { FastifyInstance } from 'fastify';
import type { WorkflowGraph } from '../engine/tradewind/foundation/types';
import { Orchestrator } from '../engine/tradewind/orchestrator';
import { EntryExecutor } from '../engine/tradewind/nodes/entry';
import { OutputExecutor } from '../engine/tradewind/nodes/output';
import { AgentExecutor, activeNodeRunners } from '../engine/tradewind/nodes/agent';
import { MeetingExecutor, activeMeetings } from '../engine/tradewind/nodes/meeting';
import { NoteExecutor } from '../engine/tradewind/nodes/note';
import { HumanGateExecutor, activeHumanGates } from '../engine/tradewind/nodes/human-gate';
import { handleSpeak, handleChair, handleEnd } from '../engine/tradewind/execution/meeting-handlers';
import { getEnvelopePending } from '../engine/tradewind/foundation/node-status-store';
import { getMeetingsDir, getMeetingFileName } from '../engine/tradewind/foundation/archive-paths';
import { validateWorkflow } from '../engine/tradewind/foundation/workflow-validator';

/** 当前活跃的 orchestrator 实例（单执行，后续改为 Map） */
let activeOrchestrator: Orchestrator | null = null;

export async function tradewindRoutes(app: FastifyInstance): Promise<void> {
  const dataDir = (app as any).dataDir as string;

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
    if (activeOrchestrator?.isRunning()) {
      return reply.status(409).send({ error: 'Execution already running' });
    }

    const body = req.body as {
      graph: WorkflowGraph;
      workflowId: string;
      initialInput?: string;
    };

    if (!body.graph || !body.workflowId) {
      return reply.status(400).send({ error: 'Missing graph or workflowId' });
    }

    // 启动前校验图结构（无环 / 入出线 / 类型 / agent 引用 …）
    const knownNodeTypes = new Set(executors.keys());
    const errors = await validateWorkflow(body.graph, dataDir, knownNodeTypes);
    if (errors.length > 0) {
      return reply.status(400).send({ error: '工作流校验未通过', errors });
    }

    activeOrchestrator = new Orchestrator({
      graph: body.graph,
      dataDir,
      workflowId: body.workflowId,
      executors,
      initialInput: body.initialInput,
    });

    await activeOrchestrator.start();
    return reply.send({
      executionId: activeOrchestrator.getExecutionId(),
      runDir: activeOrchestrator.getRunDir(),
    });
  });

  /** POST /stop — 停止当前执行 */
  app.post('/stop', async (_req, reply) => {
    if (!activeOrchestrator?.isRunning()) {
      return reply.status(404).send({ error: 'No running execution' });
    }
    await activeOrchestrator.stop();
    return reply.send({ stopped: true });
  });

  /** GET /status — 当前执行状态（用于前端刷新后恢复） */
  app.get('/status', async (_req, reply) => {
    if (!activeOrchestrator?.isRunning()) {
      return reply.send({ running: false });
    }
    return reply.send({
      running: true,
      executionId: activeOrchestrator.getExecutionId(),
      workflowId: activeOrchestrator.getWorkflowId(),
      runDir: activeOrchestrator.getRunDir(),
    });
  });

  /** GET /nodes/status — 所有节点的运行时状态（前端轮询用） */
  app.get('/nodes/status', async (_req, reply) => {
    if (!activeOrchestrator?.isRunning()) {
      return reply.send({ running: false, nodes: {} });
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

    return reply.send({ running: true, nodes });
  });

  /** POST /human-gate/:nodeId/submit — 人类提交审查决策 */
  app.post('/human-gate/:nodeId/submit', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const body = req.body as { action: 'approve' | 'rework'; comment?: string };

    const gate = activeHumanGates.get(nodeId);
    if (!gate) return reply.status(404).send({ error: '该节点没有等待中的审查' });

    if (body.action === 'approve') {
      gate.resolve({ action: 'approve' });
      return reply.send({ ok: true });
    }
    if (body.action === 'rework') {
      const comment = (body.comment || '').trim();
      if (!comment) return reply.status(400).send({ error: '打回必须填写反馈意见' });
      gate.resolve({ action: 'rework', comment });
      return reply.send({ ok: true });
    }
    return reply.status(400).send({ error: '未知 action' });
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

  const workflowsDir = path.join(dataDir, 'tradewind', 'workflows');

  /** POST /workflow/save — 保存工作流 */
  app.post('/workflow/save', async (req, reply) => {
    const body = req.body as { workflowId: string; graph: WorkflowGraph; name?: string };
    if (!body.workflowId || !body.graph) {
      return reply.status(400).send({ error: 'Missing workflowId or graph' });
    }
    const wfDir = path.join(workflowsDir, body.workflowId);
    await fs.mkdir(path.join(wfDir, 'workspace'), { recursive: true });
    await fs.writeFile(path.join(wfDir, 'graph.json'), JSON.stringify(body.graph, null, 2));
    await fs.writeFile(path.join(wfDir, 'meta.json'), JSON.stringify({
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

  /** GET /health — 健康检查 */
  app.get('/health', async (_req, reply) => {
    return reply.send({
      status: activeOrchestrator?.isRunning() ? 'running' : 'idle',
    });
  });

  // ── Agent 列表 ──────────────────────────────────────────────

  /** GET /agents — 返回全局 Agent 池摘要列表 */
  app.get('/agents', async (_req, reply) => {
    const registryFile = path.join(dataDir, 'agents', 'registry.json');
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

  /** POST /chat/:nodeId — 人类向 Agent 节点发消息（SSE 流式返回） */
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

    runner.setEventListener((ev) => {
      try { raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
      if (ev.type === 'done' || ev.type === 'error') {
        runner.setEventListener(null);
        try { raw.end(); } catch {}
      }
    });

    runner.push({ source: 'human', content: message });
  });

  /** GET /chat/:nodeId/messages — 获取节点对话历史 */
  app.get('/chat/:nodeId/messages', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const runner = activeNodeRunners.get(nodeId);
    if (runner) {
      return reply.send({ messages: runner.getMessages() });
    }
    // fallback：从磁盘读取持久化的 messages
    const execId = activeOrchestrator?.getExecutionId?.();
    if (execId) {
      const msgPath = path.join(dataDir, 'tradewind', 'runs', execId, 'nodes', nodeId, 'messages.json');
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

  // ── Meeting 端点 ──────────────────────────────────────────────

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
      onEvent: (ev) => {
        try { raw.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {}
      },
    }).then(() => {
      meeting.roundAbort = null;
      meeting.signal.removeEventListener('abort', onGlobalAbort);
      clearInterval(hb);
      // 归档会议记录
      if (meeting.runDir) {
        const meetDir = getMeetingsDir(meeting.runDir);
        const fileName = getMeetingFileName(nodeId, meeting.session.round);
        fs.mkdir(meetDir, { recursive: true })
          .then(() => fs.writeFile(
            `${meetDir}/${fileName}`,
            JSON.stringify(meeting.session.publicMessages, null, 2),
          ))
          .catch(() => {});
      }
      try {
        raw.write(`data: ${JSON.stringify({ type: 'round-done', messages: meeting.session.publicMessages })}\n\n`);
        raw.end();
      } catch {}
    }).catch((e) => {
      meeting.roundAbort = null;
      meeting.signal.removeEventListener('abort', onGlobalAbort);
      clearInterval(hb);
      try {
        raw.write(`data: ${JSON.stringify({ type: 'error', message: (e as Error).message })}\n\n`);
        raw.end();
      } catch {}
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
    if (meeting.session.phase !== 'discussion') return reply.status(409).send({ error: '会议尚未进入讨论阶段' });

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
      },
    }).then(() => {
      clearInterval(hb);
      try {
        raw.write(`data: ${JSON.stringify({ type: 'done', messages: meeting.session.chairMessages })}\n\n`);
        raw.end();
      } catch {}
    }).catch((e) => {
      clearInterval(hb);
      try {
        raw.write(`data: ${JSON.stringify({ type: 'error', message: (e as Error).message })}\n\n`);
        raw.end();
      } catch {}
    });
  });

  /** POST /meeting/:nodeId/end — 人类结束会议 */
  app.post('/meeting/:nodeId/end', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    const meeting = activeMeetings.get(nodeId);
    if (!meeting) return reply.status(404).send({ error: 'No active meeting' });
    if (meeting.session.phase !== 'discussion') return reply.status(409).send({ error: '会议尚未进入讨论阶段' });
    if (meeting.session.busy) return reply.status(409).send({ error: 'Round in progress' });

    const result = await handleEnd({
      dataDir: meeting.dataDir,
      session: meeting.session,
      signal: meeting.signal,
    });
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
