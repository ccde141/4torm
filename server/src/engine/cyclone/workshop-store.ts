import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../shared/atomic-io.js';
import { frameworkError } from '../shared/framework-error.js';
import { cycloneRoot } from '../../services/data-paths.js';
import type { WorkshopData, WorkshopSummary } from './types.js';

const indexQueues = new Map<string, Promise<void>>();
const workshopQueues = new Map<string, Promise<void>>();
const loadedSnapshots = new WeakMap<WorkshopData, WorkshopData>();

export function workshopDir(dataDir: string, id: string): string {
  return cycloneRoot(dataDir, id);
}

export function workshopIndexFile(dataDir: string): string {
  return path.join(cycloneRoot(dataDir), '_index.json');
}

export function workshopMetaFile(dataDir: string, id: string): string {
  return path.join(workshopDir(dataDir, id), 'meta.json');
}

export function workshopWorkspace(dataDir: string, id: string): string {
  return path.join(workshopDir(dataDir, id), 'workspace');
}

export async function createWorkshop(
  dataDir: string,
  options: { title?: string; chairAgentId?: string } = {},
): Promise<WorkshopData> {
  const workshop = await createWorkshopDraft(dataDir, options);
  try {
    await publishWorkshop(dataDir, workshop.id);
    return track(workshop);
  } catch (error) {
    await fs.rm(workshopDir(dataDir, workshop.id), { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function createWorkshopDraft(
  dataDir: string,
  options: { title?: string; chairAgentId?: string } = {},
): Promise<WorkshopData> {
  const id = nextId();
  const now = new Date().toISOString();
  const workshop: WorkshopData = {
    id,
    title: options.title || `工作室 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    chairAgentId: options.chairAgentId,
    seatIds: [], roomIds: [], createdAt: now, updatedAt: now,
  };
  const directory = workshopDir(dataDir, id);
  try {
    await fs.mkdir(workshopWorkspace(dataDir, id), { recursive: true });
    await fs.mkdir(path.join(directory, 'seats'), { recursive: true });
    await atomicWriteFile(workshopMetaFile(dataDir, id), JSON.stringify(workshop, null, 2));
    return track(workshop);
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function publishWorkshop(dataDir: string, id: string): Promise<void> {
  await enqueue(workshopQueues, workshopMetaFile(dataDir, id), async () => {
    if (!await loadWorkshop(dataDir, id)) {
      throw storeError('CYCLONE_WORKSHOP_DRAFT_NOT_FOUND', '待发布工作室不存在');
    }
    await mutateIndex(dataDir, index => index.includes(id) ? index : [...index, id]);
  });
}

export async function loadWorkshop(dataDir: string, id: string): Promise<WorkshopData | null> {
  const workshop = await readJson(workshopMetaFile(dataDir, id), isWorkshop);
  return workshop ? track(workshop) : null;
}

export async function saveWorkshop(dataDir: string, workshop: WorkshopData): Promise<void> {
  const desired = structuredClone(workshop);
  const snapshot = loadedSnapshots.get(workshop);
  const saved = await mutateWorkshop(dataDir, workshop.id, current => {
    if (snapshot) mergeChanges(current, snapshot, desired);
    else Object.assign(current, desired);
  });
  if (!saved) throw frameworkError({
    code: 'CYCLONE_WORKSHOP_NOT_FOUND', kind: 'not_found', message: '工作室不存在',
    source: 'cyclone.store', retryable: false,
  });
  Object.assign(workshop, saved);
  track(workshop);
}

export async function mutateWorkshop(
  dataDir: string,
  id: string,
  mutate: (workshop: WorkshopData) => void,
): Promise<WorkshopData | null> {
  let result: WorkshopData | null = null;
  const file = workshopMetaFile(dataDir, id);
  await enqueue(workshopQueues, file, async () => {
    const current = await readJson(file, isWorkshop);
    if (!current) return;
    mutate(current);
    current.updatedAt = new Date().toISOString();
    await atomicWriteFile(file, JSON.stringify(current, null, 2));
    result = track(current);
  });
  return result;
}

export async function listWorkshops(dataDir: string): Promise<WorkshopSummary[]> {
  const summaries: WorkshopSummary[] = [];
  for (const id of await readIndex(dataDir)) {
    const workshop = await loadWorkshop(dataDir, id);
    if (!workshop) continue;
    summaries.push({
      id: workshop.id, title: workshop.title,
      seatCount: workshop.seatIds.length, roomCount: workshop.roomIds.length,
      createdAt: workshop.createdAt, updatedAt: workshop.updatedAt,
    });
  }
  return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function deleteWorkshop(dataDir: string, id: string): Promise<void> {
  await enqueue(workshopQueues, workshopMetaFile(dataDir, id), async () => {
    await readIndex(dataDir);
    await fs.rm(workshopDir(dataDir, id), { recursive: true, force: true });
    await mutateIndex(dataDir, index => index.filter(item => item !== id));
  });
}

export async function renameWorkshop(dataDir: string, id: string, title: string): Promise<void> {
  await mutateWorkshop(dataDir, id, workshop => { workshop.title = title; });
}

export async function setChair(
  dataDir: string,
  id: string,
  chairAgentId: string,
): Promise<WorkshopData | null> {
  return mutateWorkshop(dataDir, id, workshop => {
    workshop.chairAgentId = chairAgentId || undefined;
  });
}

async function readIndex(dataDir: string): Promise<string[]> {
  const value = await readJson(workshopIndexFile(dataDir), isStringArray);
  return value ?? [];
}

async function mutateIndex(dataDir: string, mutate: (index: string[]) => string[]): Promise<void> {
  const file = workshopIndexFile(dataDir);
  await enqueue(indexQueues, file, async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, JSON.stringify(mutate(await readIndex(dataDir))));
  });
}

async function readJson<T>(file: string, validate: (value: unknown) => value is T): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await assertNoLegacyQuarantine(file);
      return null;
    }
    throw error;
  }
  try {
    const value: unknown = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    if (!validate(value)) throw new Error('schema mismatch');
    return value;
  } catch (cause) {
    throw storeError('CYCLONE_STORE_CORRUPT', '气旋持久化数据已损坏', cause);
  }
}

async function assertNoLegacyQuarantine(file: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(path.dirname(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (names.some(name => name.startsWith(`${path.basename(file)}.corrupt-`))) {
    throw storeError('CYCLONE_STORE_CORRUPT', '气旋持久化数据已损坏并隔离');
  }
}

async function enqueue(
  queues: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queues.set(key, current);
  try { await current; } finally { if (queues.get(key) === current) queues.delete(key); }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isWorkshop(value: unknown): value is WorkshopData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && typeof item.title === 'string'
    && isStringArray(item.seatIds) && isStringArray(item.roomIds)
    && typeof item.createdAt === 'string' && typeof item.updatedAt === 'string'
    && (item.chairAgentId === undefined || typeof item.chairAgentId === 'string');
}

function track(workshop: WorkshopData): WorkshopData {
  loadedSnapshots.set(workshop, structuredClone(workshop));
  return workshop;
}

function mergeChanges(current: WorkshopData, before: WorkshopData, after: WorkshopData): void {
  if (after.title !== before.title) current.title = after.title;
  if (after.chairAgentId !== before.chairAgentId) current.chairAgentId = after.chairAgentId;
  if (after.createdAt !== before.createdAt) current.createdAt = after.createdAt;
  current.seatIds = mergeIds(current.seatIds, before.seatIds, after.seatIds);
  current.roomIds = mergeIds(current.roomIds, before.roomIds, after.roomIds);
}

function mergeIds(current: string[], before: string[], after: string[]): string[] {
  const original = new Set(before);
  const desired = new Set(after);
  const merged = current.filter(id => !original.has(id) || desired.has(id));
  const present = new Set(merged);
  for (const id of after) {
    if (original.has(id) || present.has(id)) continue;
    merged.push(id);
    present.add(id);
  }
  return merged;
}

function nextId(): string {
  return `cyc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function storeError(code: string, message: string, cause?: unknown) {
  return frameworkError({ code, kind: 'io', message, source: 'cyclone.store', retryable: false },
    cause === undefined ? undefined : { cause });
}
