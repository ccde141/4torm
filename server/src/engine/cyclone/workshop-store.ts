/**
 * 气旋工作室容器 store —— 工作室级 CRUD
 *
 * 只 import shared/ 与本模块自身（paths/types），零交叉代码。
 */

import fs from 'node:fs/promises';
import type { WorkshopData, WorkshopSummary } from './types';
import {
  workshopDir, workshopIndexFile, workshopMetaFile, workshopWorkspace, seatsDir,
  readJsonSafe, ensureDir, atomicWrite, genId,
} from './paths';

/** 创建工作室（建目录骨架 + 写 meta + 维护索引） */
export async function createWorkshop(
  dataDir: string,
  opts: { title?: string; chairAgentId?: string } = {},
): Promise<WorkshopData> {
  const id = genId('cyc');
  const now = new Date().toISOString();
  const workshop: WorkshopData = {
    id,
    title: opts.title || `工作室 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    chairAgentId: opts.chairAgentId,
    seatIds: [],
    roomIds: [],
    createdAt: now,
    updatedAt: now,
  };
  // 先建目录骨架，再落 meta，最后才进索引——保证索引里的 id 一定可加载
  await ensureDir(workshopWorkspace(dataDir, id));
  await ensureDir(seatsDir(dataDir, id));
  await atomicWrite(workshopMetaFile(dataDir, id), JSON.stringify(workshop, null, 2));
  const index = (await readJsonSafe<string[]>(workshopIndexFile(dataDir))) || [];
  index.push(id);
  await atomicWrite(workshopIndexFile(dataDir), JSON.stringify(index));
  return workshop;
}

/** 加载工作室 meta（不存在返回 null） */
export async function loadWorkshop(dataDir: string, id: string): Promise<WorkshopData | null> {
  return readJsonSafe<WorkshopData>(workshopMetaFile(dataDir, id));
}

/** 保存工作室 meta（刷新 updatedAt） */
export async function saveWorkshop(dataDir: string, w: WorkshopData): Promise<void> {
  w.updatedAt = new Date().toISOString();
  await atomicWrite(workshopMetaFile(dataDir, w.id), JSON.stringify(w, null, 2));
}

/** 列出所有工作室摘要（按 updatedAt 降序） */
export async function listWorkshops(dataDir: string): Promise<WorkshopSummary[]> {
  const index = (await readJsonSafe<string[]>(workshopIndexFile(dataDir))) || [];
  const out: WorkshopSummary[] = [];
  for (const id of index) {
    const w = await loadWorkshop(dataDir, id);
    if (!w) continue; // 索引脏（目录被手删）时跳过，不崩
    out.push({
      id: w.id, title: w.title,
      seatCount: w.seatIds.length, roomCount: w.roomIds.length,
      createdAt: w.createdAt, updatedAt: w.updatedAt,
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 删除工作室（清整个目录 + 摘出索引） */
export async function deleteWorkshop(dataDir: string, id: string): Promise<void> {
  try { await fs.rm(workshopDir(dataDir, id), { recursive: true, force: true }); } catch {}
  const index = (await readJsonSafe<string[]>(workshopIndexFile(dataDir))) || [];
  await atomicWrite(workshopIndexFile(dataDir), JSON.stringify(index.filter(x => x !== id)));
}

/** 重命名工作室 */
export async function renameWorkshop(dataDir: string, id: string, title: string): Promise<void> {
  const w = await loadWorkshop(dataDir, id);
  if (!w) return;
  w.title = title;
  await saveWorkshop(dataDir, w);
}

/** 设置工作室会长 agent（空串 = 取消会长） */
export async function setChair(dataDir: string, id: string, chairAgentId: string): Promise<WorkshopData | null> {
  const w = await loadWorkshop(dataDir, id);
  if (!w) return null;
  w.chairAgentId = chairAgentId || undefined;
  await saveWorkshop(dataDir, w);
  return w;
}
