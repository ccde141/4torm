/**
 * 潮汐 — 会话持久化与 Rolling-Window 归档
 *
 * 布局（v2 按任务隔离）：
 *   sessions-tide/{任务名_任务ID短}/                    ← 活跃会话
 *   sessions-tide/{任务名_任务ID短}/bak/                ← 归档
 *   sessions/                                          ← designated 模式（与季风共享）
 *
 * 旧结构兼容：sessions-tide/ 扁平文件在首次写入时自动迁移。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface TideMessage {
  id: string;
  role: string;
  content: string;
  timestamp?: string;
}

export interface TideSession {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  messages: TideMessage[];
  model: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

// ── 路径 ────────────────────────────────────────────────────────

function seasonDir(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'agents', agentId, 'sessions');
}

function tideRootDir(dataDir: string, agentId: string): string {
  return path.join(dataDir, 'agents', agentId, 'sessions-tide');
}

/** 任务子目录名：{任务名}_{taskId短}（剔除目录禁用字符） */
function taskDirName(taskName: string, taskId: string): string {
  const safe = taskName.replace(/[<>:"/\\|?*]/g, '_').slice(0, 40);
  const short = taskId.replace('tide-', '').slice(0, 12);
  return `${safe}_${short}`;
}

function taskSessionDir(dataDir: string, agentId: string, taskId: string, taskName: string): string {
  return path.join(tideRootDir(dataDir, agentId), taskDirName(taskName, taskId));
}

async function readJsonFile<T>(file: string, label: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`[tide] ${label} 读取失败（非缺失，请检查权限/IO）：${file}`, e);
    throw e;
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    const quarantine = `${file}.corrupt-${Date.now().toString(36)}`;
    try { await fs.rename(file, quarantine); } catch { /* 隔离失败也别让读崩，下面照样告警 */ }
    console.error(`[tide] ${label} JSON 损坏，已隔离为 ${quarantine}（原文件保留可恢复）：${(e as Error).message}`);
    return null;
  }
}

async function readDirIfExists(dir: string, label: string): Promise<string[] | null> {
  try { return await fs.readdir(dir); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`[tide] ${label} 读取目录失败（非缺失，请检查权限/IO）：${dir}`, e);
    throw e;
  }
}

async function statIfExists(targetPath: string, label: string): Promise<import('node:fs').Stats | null> {
  try { return await fs.stat(targetPath); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`[tide] ${label} stat 失败（非缺失，请检查权限/IO）：${targetPath}`, e);
    throw e;
  }
}

async function removeStrict(targetPath: string, opts?: { recursive?: boolean }): Promise<void> {
  try { await fs.rm(targetPath, { recursive: opts?.recursive ?? false, force: false }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
}

/** 原子写：先写 .tmp 再 rename 覆盖，防止进程中途被杀（关软件）时留下半截 JSON 损坏会话/索引。 */
async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data, 'utf-8');
  await fs.rename(tmp, filePath);
}

// ── 旧结构迁移 ──────────────────────────────────────────────────

/**
 * 检测根目录是否存在旧的扁平 .json 会话文件，
 * 若有则按 sessionId 中的 taskId 前缀归类搬移到对应任务子目录。
 */
async function migrateOldSessions(
  dataDir: string, agentId: string, knownTaskId: string, knownTaskName: string,
): Promise<void> {
  const root = tideRootDir(dataDir, agentId);
  const entries = await readDirIfExists(root, '潮汐根目录');
  if (!entries) return;

  for (const name of entries) {
    if (!name.endsWith('.json') || name === '_index.json') continue;
    const filePath = path.join(root, name);
    const stat = await statIfExists(filePath, '潮汐旧会话文件');
    if (!stat || !stat.isFile()) continue;

    const sid = name.replace(/\.json$/, '');
    // sessionId 格式：{agentId}-tide-{taskShortId}-{suffix}
    const taskShort = sid.split('-tide-')[1]?.split('-')[0] ?? '';
    if (!taskShort) continue;

    // 判断该 session 属于哪个已知任务
    const taskIdPrefix = knownTaskId.replace('tide-', '').slice(0, taskShort.length);
    if (taskShort !== taskIdPrefix) continue;

    const src = filePath;
    const dstDir = taskSessionDir(dataDir, agentId, knownTaskId, knownTaskName);
    await fs.mkdir(dstDir, { recursive: true });
    const dst = path.join(dstDir, name);
    try {
      await fs.rename(src, dst);
    } catch {
      await fs.copyFile(src, dst);
      await fs.unlink(src);
    }
    await updateIndex(dstDir, sid);
  }

  // 搬移旧 bak 文件
  const oldBakDir = path.join(root, 'bak');
  try {
    const bakFiles = await readDirIfExists(oldBakDir, '潮汐旧 bak 目录');
    if (!bakFiles) return;
    for (const name of bakFiles) {
      const filePath = path.join(oldBakDir, name);
      const stat = await statIfExists(filePath, '潮汐旧 bak 文件');
      if (!stat || !stat.isFile()) continue;

      const taskShort = name.split('-tide-')[1]?.split('-')[0] ?? '';
      if (!taskShort) continue;
      const taskIdPrefix = knownTaskId.replace('tide-', '').slice(0, taskShort.length);
      if (taskShort !== taskIdPrefix) continue;

      const src = filePath;
      const dstBakDir = path.join(taskSessionDir(dataDir, agentId, knownTaskId, knownTaskName), 'bak');
      await fs.mkdir(dstBakDir, { recursive: true });
      const dst = path.join(dstBakDir, name);
      try { await fs.rename(src, dst); } catch { await fs.copyFile(src, dst); await fs.unlink(src); }
    }
    // 尝试删除空的旧 bak 目录
    const remaining = await readDirIfExists(oldBakDir, '潮汐旧 bak 目录清理');
    if (remaining && remaining.length === 0) await fs.rmdir(oldBakDir);
  } catch (e) { console.warn('[tide] 旧 bak 迁移清理失败，已跳过', e); }

  // 尝试删除旧的 _index.json；缺失是预期，非缺失错误留证据但不阻断迁移
  try { await removeStrict(path.join(root, '_index.json')); } catch (e) { console.warn('[tide] 旧 _index.json 清理失败，已跳过', e); }
}

// ── _index.json 辅助 ────────────────────────────────────────────

async function updateIndex(dir: string, sessionId: string): Promise<void> {
  const indexFile = path.join(dir, '_index.json');
  const existing = await readJsonFile<string[]>(indexFile, '潮汐会话索引');
  const index = Array.isArray(existing) ? existing : [];
  if (!index.includes(sessionId)) {
    index.push(sessionId);
    await atomicWrite(indexFile, JSON.stringify(index, null, 2));
  }
}

// ── 读取 ────────────────────────────────────────────────────────

/** 读潮汐活跃会话（先查任务子目录，再回退旧扁平结构）。不存在返回 null */
export async function readTideSession(
  dataDir: string, agentId: string, sessionId: string,
): Promise<TideSession | null> {
  const root = tideRootDir(dataDir, agentId);
  const taskDirs = await readDirIfExists(root, '潮汐根目录');
  if (!taskDirs) return null;

  for (const name of taskDirs) {
    if (name === 'bak') continue;
    const dirPath = path.join(root, name);
    const stat = await statIfExists(dirPath, '潮汐任务目录');
    if (!stat || !stat.isDirectory()) continue;

    const file = path.join(dirPath, `${sessionId}.json`);
    const session = await readJsonFile<TideSession>(file, '潮汐会话');
    if (session) return session;
  }

  // 回退旧扁平结构
  const oldFile = path.join(root, `${sessionId}.json`);
  const oldSession = await readJsonFile<TideSession>(oldFile, '潮汐旧扁平会话');
  if (oldSession) return oldSession;

  // 活跃会话不存在 → 扫所有任务子目录的 bak/，找最新的归档
  return readLatestBak(root, sessionId);
}

/** 扫所有任务子目录的 bak/，找匹配 sessionId 的最新归档 */
async function readLatestBak(root: string, sessionId: string): Promise<TideSession | null> {
  const taskDirs = await readDirIfExists(root, '潮汐根目录 bak 查找');
  if (!taskDirs) return null;

  type Candidate = { file: string; mtime: number };
  const candidates: Candidate[] = [];

  for (const name of taskDirs) {
    const bakDir = path.join(root, name, 'bak');
    const bakFiles = await readDirIfExists(bakDir, '潮汐任务 bak 目录');
    if (!bakFiles) continue;
    // bak 文件名以 {sessionId} 开头，例如 agent-xxx-tide-tide-mpx-acc_2026年6月3日_1-5.json.bak.1
    for (const fname of bakFiles) {
      if (!fname.startsWith(sessionId)) continue;
      const full = path.join(bakDir, fname);
      const stat = await statIfExists(full, '潮汐 bak 文件');
      if (!stat) continue;
      candidates.push({ file: full, mtime: stat.mtimeMs });
    }
  }

  if (candidates.length === 0) return null;
  // 取 mtime 最大的（最新归档）
  candidates.sort((a, b) => b.mtime - a.mtime);
  return readJsonFile<TideSession>(candidates[0].file, '潮汐 bak 会话');
}

/** 读季风会话（designated 模式）；不存在返回 null */
export async function readSeasonSession(
  dataDir: string, agentId: string, sessionId: string,
): Promise<TideSession | null> {
  const file = path.join(seasonDir(dataDir, agentId), `${sessionId}.json`);
  return readJsonFile<TideSession>(file, '季风指定会话');
}

// ── 写入 ────────────────────────────────────────────────────────

/** 写潮汐活跃会话 → sessions-tide/{任务子目录}/ */
export async function writeTideSession(
  dataDir: string, session: TideSession,
  taskId: string, taskName: string,
): Promise<void> {
  // 首次写入时尝试迁移旧结构文件
  await migrateOldSessions(dataDir, session.agentId, taskId, taskName);

  const dir = taskSessionDir(dataDir, session.agentId, taskId, taskName);
  await fs.mkdir(dir, { recursive: true });
  await atomicWrite(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
  await updateIndex(dir, session.id);
}

/** 写季风会话（designated）→ sessions/ */
export async function writeSeasonSession(dataDir: string, session: TideSession): Promise<void> {
  const dir = seasonDir(dataDir, session.agentId);
  await fs.mkdir(dir, { recursive: true });
  await atomicWrite(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2));
  await updateIndex(dir, session.id);
}

/** 删除潮汐活跃会话（不删 bak 归档） */
export async function deleteTideSession(
  dataDir: string, agentId: string, sessionId: string,
  taskId: string, taskName: string,
): Promise<boolean> {
  const dir = taskSessionDir(dataDir, agentId, taskId, taskName);
  const file = path.join(dir, `${sessionId}.json`);
  await removeStrict(file);
  // 从 _index.json 移除
  const indexFile = path.join(dir, '_index.json');
  const index = await readJsonFile<string[]>(indexFile, '潮汐会话索引');
  if (Array.isArray(index)) {
    const updated = index.filter(id => id !== sessionId);
    await atomicWrite(indexFile, JSON.stringify(updated, null, 2));
  }
  return true;
}

/** 删除任务对应的整个会话目录（含活跃会话 + bak 归档） */
export async function deleteTaskSessionDir(
  dataDir: string, agentId: string, taskId: string, taskName: string,
): Promise<void> {
  const dir = taskSessionDir(dataDir, agentId, taskId, taskName);
  await removeStrict(dir, { recursive: true });
}

/** 列潮汐活跃会话列表（遍历所有任务子目录，仅摘要不含 messages） */
export async function listTideSessions(dataDir: string, agentId: string): Promise<TideSession[]> {
  const root = tideRootDir(dataDir, agentId);
  const taskDirs = await readDirIfExists(root, '潮汐根目录列表');
  if (!taskDirs) return [];

  const results: TideSession[] = [];

  for (const name of taskDirs) {
    if (name === 'bak') continue;
    const dirPath = path.join(root, name);
    const stat = await statIfExists(dirPath, '潮汐任务目录列表');
    if (!stat || !stat.isDirectory()) continue;

    const indexFile = path.join(dirPath, '_index.json');
    const index = await readJsonFile<string[]>(indexFile, '潮汐任务会话索引');
    if (!Array.isArray(index)) continue;

    for (const sid of index) {
      const session = await readJsonFile<TideSession>(path.join(dirPath, `${sid}.json`), '潮汐会话列表项');
      if (session) results.push(session);
    }
  }

  // 兼容旧扁平结构的 _index.json
  const oldIndex = await readJsonFile<string[]>(path.join(root, '_index.json'), '潮汐旧扁平索引');
  if (Array.isArray(oldIndex)) {
    for (const sid of oldIndex) {
      const session = await readJsonFile<TideSession>(path.join(root, `${sid}.json`), '潮汐旧扁平会话列表项');
      if (session) results.push(session);
    }
  }

  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ── Rolling-Window 归档 ─────────────────────────────────────────

function formatDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export interface ArchiveResult {
  archived: boolean;
  newRoundSeq: number;
  newBatch: number;
}

/**
 * Rolling-Window 归档检查。
 *
 * @param roundSeq 当前累计轮次（含本轮）
 * @param windowN  窗口大小（1 或 偶数）
 * @param batch    已归档批次
 *
 * N=1：每轮归档全部消息，活跃区清空。
 * N≥2：满 N 轮 → 取最老 N/2 轮写入 bak/，活跃区保留最新 N/2 轮。
 * 一轮 = 从一个 user 消息到下一个 user 消息之前的所有消息（含中间工具调用）。
 */
export async function archiveIfNeeded(
  dataDir: string, session: TideSession,
  roundSeq: number, windowN: number, batch: number,
  taskId: string, taskName: string,
): Promise<ArchiveResult> {
  const taskDir = taskSessionDir(dataDir, session.agentId, taskId, taskName);

  // N=1：每轮完成后直接归档全部，活跃区清空
  if (windowN === 1) {
    if (session.messages.length === 0) {
      return { archived: false, newRoundSeq: roundSeq, newBatch: batch };
    }
    const bakDir = path.join(taskDir, 'bak');
    await fs.mkdir(bakDir, { recursive: true });
    const roundLabel = `${roundSeq}`;
    const fname = `${session.id}_${formatDate(new Date())}_${roundLabel}.json.bak.${batch + 1}`;
    const bakSession: TideSession = { ...session, messages: [...session.messages] };
    await fs.writeFile(path.join(bakDir, fname), JSON.stringify(bakSession, null, 2), 'utf-8');
    session.messages = [];
    await writeTideSession(dataDir, session, taskId, taskName);
    return { archived: true, newRoundSeq: roundSeq, newBatch: batch + 1 };
  }

  // N≥2：不满窗口则跳过
  if (roundSeq < windowN) {
    return { archived: false, newRoundSeq: roundSeq, newBatch: batch };
  }

  const half = windowN / 2;
  // 找第 half+1 个 user 消息的位置 = 切割点（前面是要归档的 half 轮）
  let userCount = 0;
  let cutIdx = session.messages.length;
  for (let i = 0; i < session.messages.length; i++) {
    if (session.messages[i].role === 'user') {
      userCount++;
      if (userCount > half) { cutIdx = i; break; }
    }
  }

  const archivedMsgs = session.messages.slice(0, cutIdx);
  const remaining = session.messages.slice(cutIdx);

  // 写归档文件
  const startRound = batch * half + 1;
  const endRound = startRound + half - 1;
  const bakDir = path.join(taskDir, 'bak');
  await fs.mkdir(bakDir, { recursive: true });
  const fname = `${session.id}_${formatDate(new Date())}_${startRound}-${endRound}.json.bak.${batch + 1}`;
  const bakSession: TideSession = { ...session, messages: archivedMsgs };
  await fs.writeFile(path.join(bakDir, fname), JSON.stringify(bakSession, null, 2), 'utf-8');

  // 活跃会话只留剩余
  session.messages = remaining;
  await writeTideSession(dataDir, session, taskId, taskName);

  return { archived: true, newRoundSeq: roundSeq - half, newBatch: batch + 1 };
}
