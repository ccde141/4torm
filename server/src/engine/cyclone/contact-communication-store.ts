import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, ensureDir, readJsonSafe, workshopDir } from './paths.js';
import { frameworkError } from '../shared/framework-error.js';
import { listWorkshops } from './workshop-store.js';

export type ContactPartyKind = 'seat' | 'supervisor';
export type ContactStatus = 'waiting' | 'running' | 'completed' | 'failed' | 'busy' | 'aborted' | 'crashed';
export interface ContactCommunication {
  id: string;
  workshopId: string;
  sourceId: string;
  sourceKind: ContactPartyKind;
  sourceTitle: string;
  targetId: string;
  targetKind: ContactPartyKind;
  targetTitle: string;
  status: ContactStatus;
  delivered: boolean;
  admissionDeadlineAt: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
  response?: string;
  error?: string;
}
type NewContact = Omit<ContactCommunication, 'id' | 'status' | 'delivered' | 'createdAt' | 'updatedAt'>;
const mutations = new Map<string, Promise<unknown>>();
type ContactListener = (item: ContactCommunication) => void;
const listeners = new Map<string, Set<ContactListener>>();

export function subscribeContactCommunications(dataDir: string, listener: ContactListener): () => void {
  const key = path.resolve(dataDir);
  const group = listeners.get(key) ?? new Set<ContactListener>();
  group.add(listener);
  listeners.set(key, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}

function directory(dataDir: string, workshopId: string): string {
  identifier(workshopId);
  return path.join(workshopDir(dataDir, workshopId), 'contacts');
}
function file(dataDir: string, workshopId: string, id: string): string {
  identifier(id);
  return path.join(directory(dataDir, workshopId), `${id}.json`);
}

export async function createContactCommunication(dataDir: string, input: NewContact): Promise<ContactCommunication> {
  const now = new Date().toISOString();
  const record: ContactCommunication = { ...input, id: `contact-${randomUUID()}`,
    sourceTitle: input.sourceTitle.slice(0, 120), targetTitle: input.targetTitle.slice(0, 120),
    status: 'waiting', delivered: false, createdAt: now, updatedAt: now };
  validate(record, input.workshopId, record.id);
  await persist(dataDir, record);
  return record;
}

export async function readContactCommunication(
  dataDir: string, workshopId: string, id: string,
): Promise<ContactCommunication | null> {
  const record = await readJsonSafe<ContactCommunication>(file(dataDir, workshopId, id));
  if (record) validate(record, workshopId, id);
  return record;
}

export async function listWorkshopContactCommunications(dataDir: string, workshopId: string): Promise<ContactCommunication[]> {
  let names: string[];
  try { names = await fs.readdir(directory(dataDir, workshopId)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const records = await Promise.all(names.filter(name => name.endsWith('.json'))
    .map(name => readContactCommunication(dataDir, workshopId, name.slice(0, -5))));
  return records.filter((item): item is ContactCommunication => item !== null);
}

/** Admission, withdrawal and terminal facts share one serialized durable owner. */
export async function mutateContactCommunication(
  dataDir: string, workshopId: string, id: string,
  change: (current: ContactCommunication) => ContactCommunication,
  signal?: AbortSignal,
): Promise<ContactCommunication> {
  const key = file(dataDir, workshopId, id);
  const previous = mutations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const before = await readContactCommunication(dataDir, workshopId, id);
    if (!before) throw storageError('联络记录不存在');
    const next = change(before);
    if (next === before) return before;
    validate(next, workshopId, id);
    await persist(dataDir, next, signal);
    return next;
  });
  mutations.set(key, current);
  try { return await current; }
  finally { if (mutations.get(key) === current) mutations.delete(key); }
}

/** Never replay a contact after restart, whether or not its delivery had begun. */
export async function recoverCycloneContacts(dataDir: string): Promise<number> {
  let recovered = 0;
  for (const workshop of await listWorkshops(dataDir)) {
    let names: string[];
    try { names = await fs.readdir(directory(dataDir, workshop.id)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const name of names.filter(value => value.endsWith('.json'))) {
      const record = await readContactCommunication(dataDir, workshop.id, name.slice(0, -5));
      if (!record || !['waiting', 'running'].includes(record.status)) continue;
      await mutateContactCommunication(dataDir, workshop.id, record.id, current => ({ ...current,
        status: current.delivered ? 'crashed' : 'busy', updatedAt: new Date().toISOString(),
        error: current.delivered ? '服务在联络执行期间关闭，未自动重试' : '服务关闭前联络未接入，本次已撤回，不会稍后投递' }));
      recovered++;
    }
  }
  return recovered;
}

async function persist(dataDir: string, record: ContactCommunication, signal?: AbortSignal): Promise<void> {
  await ensureDir(directory(dataDir, record.workshopId));
  await atomicWrite(file(dataDir, record.workshopId, record.id), JSON.stringify(record, null, 2), signal);
  for (const listener of listeners.get(path.resolve(dataDir)) ?? []) {
    try { listener({ ...record }); } catch { /* Notifications never replace durable facts. */ }
  }
}

function validate(record: ContactCommunication, workshopId: string, id: string): void {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw storageError('联络记录损坏');
  for (const value of [record.id, record.workshopId, record.sourceId, record.targetId]) identifier(value);
  if (record.id !== id || record.workshopId !== workshopId
    || !['seat', 'supervisor'].includes(record.sourceKind) || !['seat', 'supervisor'].includes(record.targetKind)
    || !['waiting', 'running', 'completed', 'failed', 'busy', 'aborted', 'crashed'].includes(record.status)
    || typeof record.delivered !== 'boolean' || typeof record.sourceTitle !== 'string' || typeof record.targetTitle !== 'string'
    || ![record.createdAt, record.updatedAt, record.admissionDeadlineAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    || (record.acceptedAt !== undefined && !Number.isFinite(Date.parse(record.acceptedAt)))
    || (record.response !== undefined && typeof record.response !== 'string')
    || (record.error !== undefined && typeof record.error !== 'string')) throw storageError('联络记录损坏');
}
function identifier(value: unknown): void {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw storageError('联络标识无效');
}
function storageError(message: string): Error {
  return frameworkError({ code: 'CYCLONE_CONTACT_STORE_ERROR', kind: 'io', message,
    source: 'cyclone.contact-store', retryable: false });
}
