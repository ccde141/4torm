/** 启动时清理旧版本写入 registry 的 Agent 占用状态。 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { agentRegistryFile } from '../../services/data-paths.js';
import { atomicWriteFile } from './atomic-io';

interface AgentEntry {
  status?: string;
  busy?: boolean;
  [key: string]: unknown;
}

interface RegistryFile {
  [agentId: string]: AgentEntry;
}

async function readRegistry(dataDir: string): Promise<RegistryFile> {
  const file = agentRegistryFile(dataDir);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeRegistry(dataDir: string, data: RegistryFile): Promise<void> {
  const file = agentRegistryFile(dataDir);
  await atomicWriteFile(file, JSON.stringify(data, null, 2));
}

/**
 * `busy` 和旧功能归属状态已不再写入磁盘。这里仅兼容升级前的数据；
 * 进程内活动表会在每次启动时自然为空。
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
