/**
 * 潮汐 — HTTP 路由
 *
 * 前缀：/api/tide
 */

import type { FastifyInstance } from 'fastify';
import { getAppContext } from '../services/app-context.js';
import { loadTasks, getTask, upsertTask, deleteTask, listRunRecords } from '../services/tide/store';
import { parseInterval } from '../services/tide/schedule-parser';
import { fireManual, tideTaskRuns } from '../services/tide/scheduler';
import { readTideSession, readSeasonSession, listTideSessions, deleteTideSession, deleteTaskSessionDir } from '../services/tide/session-store';
import type { TideTask } from '../services/tide/types';

function genId(): string {
  return `tide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 校验 windowN：合法值 = {1} ∪ {2,4,6,...}。非法返回错误信息，合法返回 null */
function validateWindowN(n: number): string | null {
  if (!Number.isInteger(n) || n < 1) return 'windowN 必须是 ≥1 的整数';
  if (n >= 2 && n % 2 !== 0) return 'windowN ≥2 时必须为偶数';
  return null;
}

/** self-loop 预设覆盖：强制 accumulate + N=2 + 永续 + 锚定原始目标 */
function applySelfLoop(task: TideTask): void {
  if (!task.selfLoop) return;
  task.pushMode = 'accumulate';
  task.windowN = 2;
  task.repeatCount = -1;
  if (!task.originalPrompt) task.originalPrompt = task.prompt;
}

export async function tideRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  // ── POST /api/tide/task — 创建任务 ──
  app.post('/task', async (req, reply) => {
    const body = req.body as Partial<TideTask>;
    if (!body.name || !body.schedule || !body.prompt || !body.agentId) {
      return reply.status(400).send({ error: '缺少 name/schedule/prompt/agentId' });
    }
    // 校验 schedule 格式
    try { parseInterval(body.schedule); } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
    const pushMode = body.pushMode ?? 'accumulate';
    const windowN = body.windowN ?? 1;
    const nErr = validateWindowN(windowN);
    if (nErr) return reply.status(400).send({ error: nErr });
    if (pushMode === 'designated' && !body.targetSessionId) {
      return reply.status(400).send({ error: 'designated 模式需要 targetSessionId' });
    }

    const now = new Date();
    const interval = parseInterval(body.schedule);
    const task: TideTask = {
      id: genId(),
      name: body.name,
      schedule: body.schedule,
      prompt: body.prompt,
      agentId: body.agentId,
      repeatCount: body.repeatCount ?? -1,
      pushMode,
      targetSessionId: body.targetSessionId,
      windowN,
      roundSeq: 0,
      archiveBatch: 0,
      selfLoop: body.selfLoop ?? false,
      consecutiveErrors: 0,
      enabled: true,
      createdAt: now.toISOString(),
      nextRun: new Date(now.getTime() + interval).toISOString(),
    };
    applySelfLoop(task);
    await upsertTask(dataDir, task);
    return reply.send(task);
  });

  // ── GET /api/tide/task/:taskId — 任务详情 + 最近 5 条记录 ──
  app.get('/task/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getTask(dataDir, taskId);
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    const recent = await listRunRecords(dataDir, taskId, 5);
    return reply.send({ task, recent });
  });

  // ── GET /api/tide/tasks — 列出所有任务 ──
  app.get('/tasks', async (_req, reply) => {
    const tasks = await loadTasks(dataDir);
    return reply.send(tasks);
  });

  // ── PATCH /api/tide/task/:taskId ──
  app.patch('/task/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const body = req.body as Partial<TideTask>;
    const task = await getTask(dataDir, taskId);
    if (!task) return reply.status(404).send({ error: '任务不存在' });

    if (body.schedule !== undefined) {
      try { parseInterval(body.schedule); } catch (e) {
        return reply.status(400).send({ error: (e as Error).message });
      }
      task.schedule = body.schedule;
      // 改 schedule 后重算 nextRun
      task.nextRun = new Date(Date.now() + parseInterval(body.schedule)).toISOString();
    }
    if (body.name !== undefined) task.name = body.name;
    if (body.prompt !== undefined) task.prompt = body.prompt;
    if (body.repeatCount !== undefined) task.repeatCount = body.repeatCount;
    if (body.enabled !== undefined) task.enabled = body.enabled;
    if (body.pushMode !== undefined) task.pushMode = body.pushMode;
    if (body.targetSessionId !== undefined) task.targetSessionId = body.targetSessionId;
    if (body.windowN !== undefined) {
      const nErr = validateWindowN(body.windowN);
      if (nErr) return reply.status(400).send({ error: nErr });
      task.windowN = body.windowN;
    }
    if (body.selfLoop !== undefined) task.selfLoop = body.selfLoop;
    applySelfLoop(task);

    await upsertTask(dataDir, task);
    return reply.send(task);
  });

  // ── DELETE /api/tide/task/:taskId ──
  app.delete('/task/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getTask(dataDir, taskId);
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    const deleted = await tideTaskRuns.run(taskId, async () => {
      // 先清会话目录（含 bak 归档），再删任务 + 运行记录
      await deleteTaskSessionDir(dataDir, task.agentId, task.id, task.name);
      await deleteTask(dataDir, taskId);
      return true;
    });
    if (!deleted) {
      return reply.status(409).send({ error: '任务正在执行，请等待本轮结束后再删除' });
    }
    return reply.send({ ok: true });
  });

  // ── POST /api/tide/task/:taskId/toggle — 启用/暂停切换 ──
  app.post('/task/:taskId/toggle', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getTask(dataDir, taskId);
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    task.enabled = !task.enabled;
    if (task.enabled) {
      // 重新启用：重置 nextRun 为 now+interval（避免历史 nextRun 立即触发）
      task.nextRun = new Date(Date.now() + parseInterval(task.schedule)).toISOString();
    }
    await upsertTask(dataDir, task);
    return reply.send(task);
  });

  // ── POST /api/tide/task/:taskId/run-now — 立即运行 ──
  app.post('/task/:taskId/run-now', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getTask(dataDir, taskId);
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    // 直接传原始 task；runner 通过 isManual + enabled 决定是否扣次/推时钟
    fireManual(task).catch(e => app.log.error(e));
    return reply.send({ ok: true });
  });

  // ── GET /api/tide/task/:taskId/runs — 运行历史 ──
  app.get('/task/:taskId/runs', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const limit = parseInt((req.query as any).limit ?? '20', 10);
    const records = await listRunRecords(dataDir, taskId, limit);
    return reply.send(records);
  });

  // ── GET /api/tide/sessions/:agentId — 列潮汐会话 ──
  app.get('/sessions/:agentId', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const sessions = await listTideSessions(dataDir, agentId);
    // 返回摘要（不含完整 messages）
    return reply.send(sessions.map(s => ({
      id: s.id, agentId: s.agentId, agentName: s.agentName,
      title: s.title, model: s.model,
      messageCount: s.messages.length,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    })));
  });

  // ── GET /api/tide/session/:agentId/:sessionId — 读取潮汐会话内容 ──
  app.get('/session/:agentId/:sessionId', async (req, reply) => {
    const { agentId, sessionId } = req.params as { agentId: string; sessionId: string };
    // 先查 sessions-tide/，再降级查 sessions/（designated 模式）
    const s = await readTideSession(dataDir, agentId, sessionId)
      || await readSeasonSession(dataDir, agentId, sessionId);
    if (!s) return reply.status(404).send({ error: '会话不存在' });
    return reply.send(s);
  });

  // ── DELETE /api/tide/session/:taskId — 删除潮汐活跃会话 ──
  app.delete('/session/:taskId', async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    const task = await getTask(dataDir, taskId);
    if (!task) return reply.status(404).send({ error: '任务不存在' });
    if (task.enabled) return reply.status(400).send({ error: '请先暂停任务再删除会话' });
    if (!task.targetSessionId) return reply.status(400).send({ error: '该任务没有绑定的会话' });

    const deleted = await deleteTideSession(dataDir, task.agentId, task.targetSessionId, task.id, task.name);
    if (!deleted) return reply.status(404).send({ error: '会话文件不存在' });

    // 复位 task 关联字段（archiveBatch 保留接续）
    task.targetSessionId = undefined;
    task.roundSeq = 0;
    await upsertTask(dataDir, task);

    return reply.send({ ok: true });
  });
}
