/**
 * 后端侧 Agent 状态管理工具。
 *
 * 双字段模型：
 *   status — 长期归属标记（idle/convection/tradewind/offline），非互斥展示用
 *   busy   — 短暂互斥锁（LLM 流式输出期间），唯一互斥
 *
 * lockAgent/unlockAgent 仅操作 busy 字段。
 * setPresence/clearPresence 仅操作 status 字段（不互斥）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

interface AgentEntry {
  status?: string;
  busy?: boolean;
  [key: string]: unknown;
}

interface RegistryFile {
  [agentId: string]: AgentEntry;
}

async function readRegistry(dataDir: string): Promise<RegistryFile> {
  const file = path.join(dataDir, 'agents', 'registry.json');
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeRegistry(dataDir: string, data: RegistryFile): Promise<void> {
  const file = path.join(dataDir, 'agents', 'registry.json');
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Unlock Hook（用于潮汐 slot flush）──
type UnlockHook = (agentId: string) => void | Promise<void>;
const unlockHooks: UnlockHook[] = [];

/** 注册解锁钩子。Agent busy 释放后异步触发，错误不冒泡。 */
export function registerUnlockHook(hook: UnlockHook): void {
  unlockHooks.push(hook);
}

function fireUnlockHooks(agentId: string): void {
  for (const h of unlockHooks) {
    Promise.resolve(h(agentId)).catch(() => {});
  }
}

// ── 互斥锁：仅 busy 字段 ────────────────────────────────────────

/** 锁定 agent（设 busy=true）。已 busy 时抛异常。 */
export async function lockAgent(
  dataDir: string,
  agentId: string,
  _status?: string, // 兼容旧调用签名，忽略
): Promise<void> {
  const reg = await readRegistry(dataDir);
  const agent = reg[agentId];
  if (!agent) throw new Error(`Agent ${agentId} 不存在`);
  if (agent.busy) {
    throw new Error(`Agent ${agentId} 正忙（LLM 输出中），无法锁定`);
  }
  agent.busy = true;
  await writeRegistry(dataDir, reg);
}

/** 解锁 agent（设 busy=false）。 */
export async function unlockAgent(
  dataDir: string,
  agentId: string,
  _owner?: string, // 兼容旧调用签名，忽略
): Promise<void> {
  const reg = await readRegistry(dataDir);
  const agent = reg[agentId];
  if (!agent) return;
  if (!agent.busy) return; // 已经不忙，幂等
  agent.busy = false;
  await writeRegistry(dataDir, reg);
  fireUnlockHooks(agentId);
}

// ── 归属标记（非互斥）───────────────────────────────────────────

/** 设置 agent 的长期归属标记（convection/tradewind）。不互斥，不阻止 lockAgent。 */
export async function setPresence(
  dataDir: string, agentId: string, status: string,
): Promise<void> {
  const reg = await readRegistry(dataDir);
  const agent = reg[agentId];
  if (!agent) return;
  agent.status = status;
  await writeRegistry(dataDir, reg);
}

/** 清除 agent 归属标记，回到 idle。仅当前 status 匹配时才清除。 */
export async function clearPresence(
  dataDir: string, agentId: string, expectedStatus: string,
): Promise<void> {
  const reg = await readRegistry(dataDir);
  const agent = reg[agentId];
  if (!agent) return;
  if (agent.status !== expectedStatus) return; // 被别的模块改了，不覆盖
  agent.status = 'idle';
  await writeRegistry(dataDir, reg);
}

// ── 强制解锁 ────────────────────────────────────────────────────

export async function forceUnlock(dataDir: string, agentId: string): Promise<void> {
  const reg = await readRegistry(dataDir);
  const agent = reg[agentId];
  if (!agent) return;
  agent.busy = false;
  await writeRegistry(dataDir, reg);
  fireUnlockHooks(agentId);
}

// ── 启动自愈 ────────────────────────────────────────────────────

/**
 * 启动自愈：扫描 registry，释放 busy 残留。
 * busy 是内存态（LLM 流式输出），重启后不可能残留有效上下文。
 * convection/tradewind 是持久化归属，需要检查 session 文件。
 */
export async function healAgentLocks(dataDir: string): Promise<string[]> {
  const released: string[] = [];
  const reg = await readRegistry(dataDir);

  for (const [agentId, agent] of Object.entries(reg)) {
    // 清理残留 busy
    if (agent.busy) {
      agent.busy = false;
      released.push(`${agentId} (busy)`);
    }
    // convection 归属：检查是否仍在活跃 session 中
    if (agent.status === 'convection') {
      const alive = await isAgentInConvectionSession(dataDir, agentId);
      if (!alive) {
        agent.status = 'idle';
        released.push(`${agentId} (convection/orphan)`);
      }
    }
    // tradewind 归属：重启后无活跃执行，清理
    if (agent.status === 'tradewind') {
      agent.status = 'idle';
      released.push(`${agentId} (tradewind)`);
    }
  }

  if (released.length > 0) {
    await writeRegistry(dataDir, reg);
  }

  return released;
}

async function isAgentInConvectionSession(dataDir: string, agentId: string): Promise<boolean> {
  const indexFile = path.join(dataDir, 'convection', 'sessions', '_index.json');
  let index: string[];
  try {
    index = JSON.parse(await fs.readFile(indexFile, 'utf-8'));
  } catch {
    return false;
  }
  for (const sid of index) {
    const file = path.join(dataDir, 'convection', 'sessions', `${sid}.json`);
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const session = JSON.parse(raw);
      if (session.chairAgentId === agentId) return true;
      if (Array.isArray(session.participantAgentIds) && session.participantAgentIds.includes(agentId)) return true;
    } catch { continue; }
  }
  return false;
}
