/** 工位记忆与绑定 Agent 分开归属；一次修改在同一路径内串行校验版本并原子提交。 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { atomicWrite, ensureDir, readJsonSafe, seatFile, seatsDir } from './paths.js';
import { loadSeat } from './seat-store.js';
import { loadWorkshop } from './workshop-store.js';
import { frameworkError } from '../shared/framework-error.js';
import { parseSeatHistory, seatMemoryHistoryRecord, type SeatHistoryRecord, type SeatHistorySource } from './seat-history.js';

export interface SeatMemoryEntry { id: string; title: string; content: string; updatedAt: string }
export interface SeatMemory { revision: number; entries: SeatMemoryEntry[] }
interface StoredSeatMemory extends SeatMemory { history?: SeatHistoryRecord[] }
export interface SeatMemoryInput { id?: string; title: string; content: string }
type Listener = (workshopId: string, seatId: string) => void;
const listeners = new Map<string, Set<Listener>>();
const queues = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 200;

function memoryError(code: string, kind: 'validation' | 'conflict' | 'not_found' | 'io', message: string) {
  return frameworkError({ code: `CYCLONE_SEAT_MEMORY_${code}`, kind, message,
    source: 'cyclone.seat-memory', retryable: false });
}

function identity(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw memoryError('INPUT_INVALID', 'validation', '工位记忆参数无效');
  }
}

export function seatMemoryFile(dataDir: string, workshopId: string, seatId: string): string {
  identity(workshopId); identity(seatId);
  return path.join(seatsDir(dataDir, workshopId), `${seatId}.memory.json`);
}

async function requireSeat(dataDir: string, workshopId: string, seatId: string): Promise<void> {
  const workshop = await loadWorkshop(dataDir, workshopId);
  if (!workshop?.seatIds.includes(seatId) || !await loadSeat(dataDir, workshopId, seatId)) {
    throw memoryError('SEAT_NOT_FOUND', 'not_found', '工位不存在');
  }
}

function serialize<T>(file: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  const current = previous.then(action, action);
  queues.set(file, current);
  return current.finally(() => { if (queues.get(file) === current) queues.delete(file); });
}

function parseMemory(value: unknown, workshopId: string, seatId: string): StoredSeatMemory {
  const board = value as Partial<StoredSeatMemory> | null;
  if (!board || !Number.isSafeInteger(board.revision) || board.revision! < 0
    || !Array.isArray(board.entries) || board.entries.length > MAX_ENTRIES
    || board.entries.some(entry => !entry || typeof entry.id !== 'string'
      || !entry.id || typeof entry.title !== 'string' || !entry.title.trim()
      || typeof entry.content !== 'string' || typeof entry.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(entry.updatedAt)))
    || new Set(board.entries.map(entry => entry.id)).size !== board.entries.length) {
    throw memoryError('CORRUPT', 'io', '工位记忆已损坏，原文件已保留');
  }
  if (board.history !== undefined) parseSeatHistory(board.history, workshopId, seatId, 'memory');
  return board as StoredSeatMemory;
}

async function readRaw(file: string, workshopId: string, seatId: string): Promise<StoredSeatMemory> {
  const value = await readJsonSafe<unknown>(file);
  return value === null ? { revision: 0, entries: [] } : parseMemory(value, workshopId, seatId);
}

export async function readSeatMemory(dataDir: string, workshopId: string, seatId: string): Promise<SeatMemory> {
  const file = seatMemoryFile(dataDir, workshopId, seatId);
  return serialize(file, async () => {
    await requireSeat(dataDir, workshopId, seatId);
    const board = await readRaw(file, workshopId, seatId);
    return { revision: board.revision, entries: board.entries };
  });
}

/** 概览只核实工位实体存在，不解析可能很大的私聊历史。 */
export async function readSeatMemorySummary(
  dataDir: string, workshopId: string, seatId: string,
): Promise<{ memoryCount: number }> {
  const file = seatMemoryFile(dataDir, workshopId, seatId);
  return serialize(file, async () => {
    const workshop = await loadWorkshop(dataDir, workshopId);
    if (!workshop?.seatIds.includes(seatId)) throw memoryError('SEAT_NOT_FOUND', 'not_found', '工位不存在');
    try { await fs.stat(seatFile(dataDir, workshopId, seatId)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw memoryError('SEAT_NOT_FOUND', 'not_found', '工位不存在');
      throw error;
    }
    return { memoryCount: (await readRaw(file, workshopId, seatId)).entries.length };
  });
}

export function validateSeatMemoryInput(value: SeatMemoryInput, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !value
    || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200
    || typeof value.content !== 'string' || !value.content.trim() || value.content.length > 50_000
    || (value.id !== undefined && (typeof value.id !== 'string' || !value.id || value.id.length > 160))) {
    throw memoryError('INPUT_INVALID', 'validation', '工位记忆参数无效');
  }
}

export async function saveSeatMemory(
  dataDir: string, workshopId: string, seatId: string, expectedRevision: number, input: SeatMemoryInput,
  source: SeatHistorySource = 'unknown',
): Promise<SeatMemory> {
  validateSeatMemoryInput(input, expectedRevision);
  const file = seatMemoryFile(dataDir, workshopId, seatId);
  return serialize(file, async () => {
    await requireSeat(dataDir, workshopId, seatId);
    const current = await readRaw(file, workshopId, seatId);
    if (current.revision !== expectedRevision) {
      throw memoryError('CONFLICT', 'conflict', '工位记忆已更新，请重新读取后合并修改');
    }
    const index = input.id === undefined ? -1 : current.entries.findIndex(entry => entry.id === input.id);
    if (input.id !== undefined && index < 0) throw memoryError('ENTRY_NOT_FOUND', 'not_found', '记忆条目不存在');
    if (index < 0 && current.entries.length >= MAX_ENTRIES) {
      throw memoryError('FULL', 'validation', '工位记忆条目已达上限，请先整理已有条目');
    }
    const entry: SeatMemoryEntry = { id: input.id ?? `mem-${randomUUID()}`,
      title: input.title.trim(), content: input.content.trim(), updatedAt: new Date().toISOString() };
    const entries = [...current.entries];
    if (index < 0) entries.push(entry); else entries[index] = entry;
    const revision = current.revision + 1;
    const history = [...(current.history ?? []), seatMemoryHistoryRecord(workshopId, seatId, entry, revision, source)];
    const updated: StoredSeatMemory = { revision, entries, history };
    await ensureDir(path.dirname(file));
    await atomicWrite(file, JSON.stringify(updated, null, 2));
    const group = listeners.get(path.resolve(dataDir));
    for (const listener of group ?? []) {
      try { listener(workshopId, seatId); } catch { group?.delete(listener); }
    }
    return { revision, entries };
  });
}

export function subscribeSeatMemoryChanges(dataDir: string, listener: Listener): () => void {
  const key = path.resolve(dataDir);
  const group = listeners.get(key) ?? new Set<Listener>();
  group.add(listener); listeners.set(key, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}
