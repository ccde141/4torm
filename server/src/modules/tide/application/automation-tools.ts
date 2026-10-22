import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import { parseTideSchedule } from '../domain/schedule.js';
import type { TideTask } from '../domain/task.js';
import { readSeasonSession } from '../sessions/session-store.js';
import type { SeasonSessionPort } from '../sessions/season-session-port.js';
import type { TideTaskService, CreateTideTaskInput } from './task-service.js';

const MIN_INTERVAL_MS = 60_000;
const WRITE_TOOLS = ['write_file', 'edit_file', 'delete_file'];

export interface PendingAutomation {
  mode: 'created' | 'updated';
  taskId: string;
  name: string;
  schedule: string;
  repeatCount: number;
  perpetual: boolean;
  selfLoop: boolean;
  windowN: number;
  enabled: boolean;
  agentName: string;
  sandboxLevel: string;
  canWriteFiles: boolean;
  promptPreview: string;
}

interface AgentInfo { name: string; sandboxLevel: string; canWriteFiles: boolean }
type AutomationResult = { result: string; pending: PendingAutomation };

export class TideAgentAutomationService {
  constructor(private readonly dataDir: string, private readonly tasks: TideTaskService,
    private readonly seasonSessions?: SeasonSessionPort) {}

  async create(actorId: string, raw: Record<string, unknown>): Promise<AutomationResult> {
    const args = extract(raw);
    const agentId = optionalText(args.agentId, 'agentId') ?? actorId;
    const info = await requireAgent(this.dataDir, agentId);
    const name = requiredText(args.name, 'name');
    const schedule = requiredText(args.schedule, 'schedule');
    const prompt = requiredText(args.prompt, 'prompt');
    validateSchedule(schedule);
    const pushMode = pushModeOf(args.pushMode);
    if (pushMode === 'designated' && boolean(args.selfLoop, false)) {
      fail('指定季风会话不能与自循环同时使用');
    }
    const targetSessionId = optionalText(args.targetSessionId, 'targetSessionId');
    await assertTargetSession(this.seasonSessions, agentId, pushMode, targetSessionId);
    const input: CreateTideTaskInput = {
      name, schedule, prompt, agentId, pushMode,
      ...(targetSessionId ? { targetSessionId } : {}),
      repeatCount: integer(args.repeatCount, 'repeatCount', -1),
      windowN: integer(args.windowN, 'windowN', 1),
      selfLoop: boolean(args.selfLoop, false),
    };
    const task = await this.tasks.create(input, { enabled: boolean(args.enabled, true, 'enabled') });
    return output('created', task, info);
  }

  async update(_actorId: string, raw: Record<string, unknown>): Promise<AutomationResult> {
    const args = extract(raw);
    if (args.enabled !== undefined) fail('启停任务请使用 set_automation_enabled');
    const taskId = requiredText(args.taskId, 'taskId');
    const current = (await this.tasks.detail(taskId)).task;
    const patch: Partial<TideTask> = {};
    if (args.agentId !== undefined) {
      patch.agentId = requiredText(args.agentId, 'agentId');
      await requireAgent(this.dataDir, patch.agentId);
    }
    for (const field of ['name', 'schedule', 'prompt'] as const) {
      if (args[field] !== undefined) patch[field] = requiredText(args[field], field);
    }
    if (patch.schedule) validateSchedule(patch.schedule);
    if (args.repeatCount !== undefined) patch.repeatCount = integer(args.repeatCount, 'repeatCount', -1);
    if (args.windowN !== undefined) patch.windowN = integer(args.windowN, 'windowN', 1);
    if (args.selfLoop !== undefined) patch.selfLoop = boolean(args.selfLoop, false);
    if (args.pushMode !== undefined) patch.pushMode = pushModeOf(args.pushMode);
    if ((patch.pushMode ?? current.pushMode) === 'designated'
      && (patch.selfLoop ?? current.selfLoop)) fail('指定季风会话不能与自循环同时使用');
    if (args.targetSessionId !== undefined) {
      patch.targetSessionId = requiredText(args.targetSessionId, 'targetSessionId');
    }
    if (!patch.agentId || patch.agentId === current.agentId) {
      await assertTargetSession(this.seasonSessions, current.agentId,
        patch.pushMode ?? current.pushMode, patch.targetSessionId ?? current.targetSessionId);
    }
    const task = await this.tasks.update(taskId, patch);
    return output('updated', task, await requireAgent(this.dataDir, task.agentId));
  }
}

function validateSchedule(schedule: string): void {
  let plan: ReturnType<typeof parseTideSchedule>;
  try { plan = parseTideSchedule(schedule); }
  catch { fail('schedule 必须是有效间隔（如 every 5m）或每天时分（如 daily 08:00）'); }
  if (plan.kind === 'interval' && plan.intervalMs < MIN_INTERVAL_MS) {
    fail('间隔不能小于 60 秒（every 1m 起）；每天定时使用 daily HH:mm');
  }
}

function extract(args: Record<string, unknown>): Record<string, unknown> {
  if (typeof args.params !== 'string') return args;
  try {
    const parsed = JSON.parse(args.params) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('params 必须是对象');
    return { ...args, ...parsed };
  } catch (error) {
    if (error instanceof SyntaxError) fail('params 必须是有效 JSON');
    throw error;
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} 必须是非空字符串`);
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requiredText(value, field);
}

function integer(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  const result = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(result)) fail(`${field} 必须是整数`);
  return result as number;
}

function boolean(value: unknown, fallback: boolean, field = 'selfLoop'): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fail(`${field} 必须是布尔值`);
}

function pushModeOf(value: unknown): 'accumulate' | 'designated' {
  if (value === undefined || value === 'accumulate') return 'accumulate';
  if (value === 'designated') return 'designated';
  return fail('pushMode 无效');
}

async function assertTargetSession(
  port: SeasonSessionPort | undefined, agentId: string, mode: 'accumulate' | 'designated', sessionId?: string,
): Promise<void> {
  if (sessionId && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(sessionId)) {
    fail('targetSessionId 无效');
  }
  if (mode === 'designated' && (!sessionId
    || !(await readSeasonSession(port, agentId, sessionId)))) {
    fail('指定的季风会话不存在或不属于目标 Agent');
  }
}

async function requireAgent(dataDir: string, agentId: string): Promise<AgentInfo> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(agentId)) fail('agentId 无效');
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) fail(`Agent 不存在：${agentId}`);
  return {
    name: agent.name || agentId,
    sandboxLevel: agent.sandboxLevel,
    canWriteFiles: agent.tools.some(tool => WRITE_TOOLS.includes(tool)),
  };
}

function output(mode: 'created' | 'updated', task: TideTask, info: AgentInfo): AutomationResult {
  const pending: PendingAutomation = {
    mode, taskId: task.id, name: task.name, schedule: task.schedule,
    repeatCount: task.repeatCount, perpetual: task.repeatCount === -1,
    selfLoop: task.selfLoop, windowN: task.windowN, enabled: task.enabled,
    agentName: info.name, sandboxLevel: info.sandboxLevel,
    canWriteFiles: info.canWriteFiles,
    promptPreview: task.prompt.slice(0, 200) + (task.prompt.length > 200 ? '…' : ''),
  };
  return { result: `${mode === 'created' ? '已创建' : '已更新'}潮汐任务「${task.name}」`
    + `(id: ${task.id}，目标 Agent: ${task.agentId}，${task.schedule})，`
    + `当前${task.enabled ? '已启用' : '未启用'}。`, pending };
}

function fail(message: string): never {
  throw frameworkError({ code: 'TIDE_AUTOMATION_INPUT_INVALID', kind: 'validation',
    message, source: 'tide.automations', retryable: false });
}
