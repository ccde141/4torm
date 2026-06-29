/**
 * 后端侧 Agent 互斥锁工具。
 *
 *   busy — 短暂互斥锁（LLM 流式输出期间），唯一互斥字段。
 *
 * lockAgent/unlockAgent 仅操作 busy 字段。
 * （旧的 status 归属标记 convection/tradewind 已废弃，不再写入；
 *   启动自愈会把残留的非 idle/offline 归属态归一化回 idle。）
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
 * 同时把残留的旧归属态（convection/tradewind 等非 idle/offline）归一化回 idle。
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
    // 归一化残留的旧归属态（convection/tradewind 已废弃）
    if (agent.status && agent.status !== 'idle' && agent.status !== 'offline') {
      released.push(`${agentId} (status:${agent.status}→idle)`);
      agent.status = 'idle';
    }
  }

  if (released.length > 0) {
    await writeRegistry(dataDir, reg);
  }

  return released;
}
