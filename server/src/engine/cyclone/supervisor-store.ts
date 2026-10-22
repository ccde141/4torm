import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../shared/atomic-io.js';
import { frameworkError } from '../shared/framework-error.js';
import { readJsonSafe, workshopDir } from './paths.js';
import { loadWorkshop } from './workshop-store.js';
import type { SeatData, SeatContextMessage } from './types.js';

export const SUPERVISOR_ID = 'supervisor';
export type SupervisorGoalOrigin = { kind: 'human' }
  | { kind: 'agent'; agentId: string; sessionId: string };
export interface SupervisorMessage extends SeatContextMessage {
  supervisorInboxId?: string;
  supervisorSourceTitle?: string;
  supervisorInternal?: true;
  supervisorGoalOrigin?: SupervisorGoalOrigin;
}
export interface SupervisorData extends Pick<SeatData,
  'rolePrompt' | 'tokenUsage' | 'pending' | 'compactState' | 'compaction' | 'compactionNotice'> {
  id: typeof SUPERVISOR_ID;
  title: string;
  agentId?: string;
  messages: SupervisorMessage[];
  revision: number;
  memory: Array<{ id: string; title: string; content: string; updatedAt: string }>;
  memoryRevision: number;
  followUpPaused?: boolean;
  humanIntentEstablished?: boolean;
  goalOrigin?: SupervisorGoalOrigin;
  /** Reset tombstones commit with the cleared context, including receipts not yet consumed. */
  clearedInformationIds?: string[];
  createdAt: string;
  updatedAt: string;
}
export function hasEstablishedSupervisorGoal(value: Pick<SupervisorData, 'goalOrigin' | 'humanIntentEstablished'>): boolean {
  return Boolean(value.goalOrigin || value.humanIntentEstablished);
}
export interface SupervisorInformation {
  id: string;
  sourceKind: 'seat' | 'dispatch' | 'contact';
  sourceId: string;
  sourceTitle: string;
  content: string;
  createdAt: string;
  consumedAt?: string;
}

const queues = new Map<string, Promise<unknown>>();
const locks = new Set<string>();
function file(dataDir: string, workshopId: string, name = 'supervisor.json'): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(workshopId)) throw invalid('工作室标识无效');
  return path.join(workshopDir(dataDir, workshopId), name);
}
export function supervisorTaskboardFile(dataDir: string, workshopId: string): string {
  return file(dataDir, workshopId, 'supervisor.taskboard.json');
}
export function tryAcquireSupervisorLock(dataDir: string, workshopId: string): (() => void) | null {
  const key = path.resolve(file(dataDir, workshopId));
  if (locks.has(key)) return null;
  locks.add(key);
  let released = false;
  return () => { if (!released) { released = true; locks.delete(key); } };
}
export function isSupervisorBusy(dataDir: string, workshopId: string): boolean {
  return locks.has(path.resolve(file(dataDir, workshopId)));
}
async function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.then(action, action);
  queues.set(key, current);
  try { return await current; } finally { if (queues.get(key) === current) queues.delete(key); }
}
export async function loadSupervisor(dataDir: string, workshopId: string): Promise<SupervisorData> {
  const workshop = await loadWorkshop(dataDir, workshopId);
  if (!workshop) throw invalid('工作室不存在', 'not_found');
  const value = await readJsonSafe<SupervisorData>(file(dataDir, workshopId));
  if (value === null) {
    const now = workshop.createdAt;
    return { id: SUPERVISOR_ID, title: '工作室主管', rolePrompt: '', messages: [], revision: 0,
      memory: [], memoryRevision: 0, createdAt: now, updatedAt: now };
  }
  if (value.id !== SUPERVISOR_ID || !Array.isArray(value.messages) || !Array.isArray(value.memory)
    || !Number.isSafeInteger(value.revision) || typeof value.rolePrompt !== 'string'
    || (value.agentId !== undefined && typeof value.agentId !== 'string')
    || (value.goalOrigin !== undefined && !validGoalOrigin(value.goalOrigin))
    || (value.clearedInformationIds !== undefined && (!Array.isArray(value.clearedInformationIds)
      || value.clearedInformationIds.some(id => typeof id !== 'string' || !id)))) {
    throw invalid('主管资料已损坏，原文件已保留', 'io');
  }
  return value;
}
function validGoalOrigin(value: unknown): value is SupervisorGoalOrigin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.kind === 'human' || (item.kind === 'agent' && typeof item.agentId === 'string'
    && Boolean(item.agentId.trim()) && typeof item.sessionId === 'string' && Boolean(item.sessionId.trim()));
}
/** Field updates commit against the latest record; incoming information has a separate owner file. */
export async function mutateSupervisor<T>(dataDir: string, workshopId: string,
  change: (current: SupervisorData) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
  const target = file(dataDir, workshopId);
  return serial(target, async () => {
    signal?.throwIfAborted();
    const current = await loadSupervisor(dataDir, workshopId);
    const result = await change(current);
    signal?.throwIfAborted();
    current.revision++;
    current.updatedAt = new Date().toISOString();
    await atomicWriteFile(target, JSON.stringify(current, null, 2), signal);
    return result;
  });
}
export async function readSupervisorInbox(dataDir: string, workshopId: string): Promise<SupervisorInformation[]> {
  const records = await readJsonSafe<SupervisorInformation[]>(file(dataDir, workshopId, 'supervisor-inbox.json'));
  if (records !== null && (!Array.isArray(records) || records.some(item => !item
    || typeof item.id !== 'string' || typeof item.content !== 'string' || typeof item.createdAt !== 'string'))) {
    throw invalid('主管收件记录已损坏，原文件已保留', 'io');
  }
  return records ?? [];
}
export async function readPendingSupervisorInformation(dataDir: string, workshopId: string): Promise<SupervisorInformation[]> {
  const supervisor = await loadSupervisor(dataDir, workshopId);
  const cleared = new Set(supervisor.clearedInformationIds ?? []);
  return (await readSupervisorInbox(dataDir, workshopId)).filter(item => !item.consumedAt && !cleared.has(item.id));
}
export async function enqueueSupervisorInformation(dataDir: string, workshopId: string,
  input: Omit<SupervisorInformation, 'id' | 'createdAt'> & { id?: string }): Promise<SupervisorInformation> {
  const target = file(dataDir, workshopId, 'supervisor-inbox.json');
  return serial(target, async () => {
    const supervisor = await loadSupervisor(dataDir, workshopId);
    if (!supervisor.agentId) throw invalid('工作室尚未配置主管', 'not_found');
    const records = await readSupervisorInbox(dataDir, workshopId);
    const existing = input.id ? records.find(item => item.id === input.id) : undefined;
    if (existing) return existing;
    const item = { ...input, id: input.id ?? `info-${randomUUID()}`, createdAt: new Date().toISOString() };
    records.push(item);
    await atomicWriteFile(target, JSON.stringify(records, null, 2));
    return item;
  });
}
export async function consumeSupervisorInformation(dataDir: string, workshopId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const target = file(dataDir, workshopId, 'supervisor-inbox.json');
  await serial(target, async () => {
    const records = await readSupervisorInbox(dataDir, workshopId);
    const selected = new Set(ids);
    const now = new Date().toISOString();
    for (const item of records) if (selected.has(item.id)) item.consumedAt = now;
    await atomicWriteFile(target, JSON.stringify(records, null, 2));
  });
}
export async function archiveSupervisorContext(dataDir: string, workshopId: string, data: unknown): Promise<string> {
  const target = file(dataDir, workshopId, path.join('bak', `supervisor-${Date.now()}-${randomUUID()}.json`));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await atomicWriteFile(target, JSON.stringify(data, null, 2));
  return target;
}
function invalid(message: string, kind: 'validation' | 'not_found' | 'io' = 'validation') {
  return frameworkError({ code: 'CYCLONE_SUPERVISOR_INVALID', kind, message,
    source: 'cyclone.supervisor-store', retryable: false });
}
