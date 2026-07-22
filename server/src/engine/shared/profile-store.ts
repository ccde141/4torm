/**
 * profile-store —— AutoProfile 的存取 + 到 LoopConfig 的映射
 *
 * 存储：data/tradewind/workflows/{workflowId}/profiles.json（与 graph.json 平级）。
 * 图保持 mode-free；profile 是"auto 模式怎么循环"的独立档案。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from './atomic-io';
import type { AutoProfile } from '../tradewind/foundation/types';
import type { LoopConfig } from '../tradewind/orchestrator';
import { tradewindWorkflowsDir } from '../../services/data-paths.js';

function profilesPath(dataDir: string, workflowId: string): string {
  return path.join(tradewindWorkflowsDir(dataDir), workflowId, 'profiles.json');
}

/** 读一个工作流的全部档案；仅文件缺失时返回空数组。 */
export async function loadProfiles(dataDir: string, workflowId: string): Promise<AutoProfile[]> {
  try {
    const raw = await fs.readFile(profilesPath(dataDir, workflowId), 'utf-8');
    const parsed = JSON.parse(raw) as { profiles?: AutoProfile[] };
    return Array.isArray(parsed.profiles) ? parsed.profiles : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** 覆盖写整个档案数组（前端整存整取） */
export async function saveProfiles(
  dataDir: string, workflowId: string, profiles: AutoProfile[],
): Promise<void> {
  const file = profilesPath(dataDir, workflowId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, JSON.stringify({ workflowId, profiles }, null, 2));
}

/** 按 id 找档案 */
export function findProfile(profiles: AutoProfile[], id: string): AutoProfile | undefined {
  return profiles.find(p => p.id === id);
}

/**
 * AutoProfile → LoopConfig（LoopController 的运行时契约）。
 * relative 才能映射；absolute（潮汐）本刀不支持循环执行，返回 null。
 */
export function autoProfileToLoopConfig(p: AutoProfile): LoopConfig | null {
  if (p.cadence.kind !== 'relative') return null;
  return {
    cadence: { kind: 'relative', gapSec: p.cadence.gapSec },
    lapBound: p.lapBound,
    carryOver: p.carryOver,
    ...(p.loopNote ? { loopNote: p.loopNote } : {}),
    ...(p.summaryPrompt ? { summaryPrompt: p.summaryPrompt } : {}),
  };
}
