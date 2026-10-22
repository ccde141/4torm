import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../shared/atomic-io.js';
import { frameworkError } from '../shared/framework-error.js';

/** Contact has no module run handle; retain its lifecycle without copying conversation text. */
export interface SeatJournalRecord {
  id: string;
  workshopId: string;
  seatId: string;
  agentId: string;
  sourceSeatId: string;
  sourceTitle: string;
  kind: 'contact';
  title: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'crashed';
  startedAt: string;
  updatedAt: string;
  error?: string;
  communicationId?: string;
}

type ContactInput = Pick<SeatJournalRecord,
  'workshopId' | 'seatId' | 'agentId' | 'sourceSeatId' | 'sourceTitle' | 'title' | 'communicationId'>;
type TerminalStatus = 'completed' | 'failed' | 'aborted';
type Listener = (record: SeatJournalRecord) => void;
const journals = new Map<string, SeatEventJournal>();
const listeners = new Map<string, Set<Listener>>();

export async function beginSeatContact(dataDir: string, input: ContactInput): Promise<{
  finish(status: TerminalStatus, error?: string): Promise<void>;
}> {
  const journal = getJournal(dataDir, input.workshopId);
  const record = await journal.begin(input);
  let ended = false;
  let finishing: Promise<void> | undefined;
  return {
    async finish(status, error) {
      if (ended) return;
      finishing ??= journal.finish(record.id, status, error).then(() => { ended = true; });
      try { await finishing; } finally { finishing = undefined; }
    },
  };
}

export function readSeatEvents(dataDir: string, workshopId: string): Promise<SeatJournalRecord[]> {
  return getJournal(dataDir, workshopId).history();
}

export function subscribeSeatEvents(dataDir: string, listener: Listener): () => void {
  const key = path.resolve(dataDir);
  const subscriptions = listeners.get(key) ?? new Set<Listener>();
  subscriptions.add(listener);
  listeners.set(key, subscriptions);
  return () => {
    subscriptions.delete(listener);
    if (!subscriptions.size) listeners.delete(key);
  };
}

function getJournal(dataDir: string, workshopId: string): SeatEventJournal {
  const key = path.join(path.resolve(dataDir), 'cyclone', identifier(workshopId), 'seat-events');
  let journal = journals.get(key);
  if (!journal) {
    journal = new SeatEventJournal(key, workshopId, record => {
      for (const listener of listeners.get(path.resolve(dataDir)) ?? []) {
        try { listener(structuredClone(record)); } catch { /* Notifications never replace durable facts. */ }
      }
    });
    journals.set(key, journal);
  }
  return journal;
}

class SeatEventJournal {
  private readonly records = new Map<string, SeatJournalRecord>();
  private initialized = false;
  private initializing?: Promise<void>;

  constructor(
    private readonly directory: string,
    private readonly workshopId: string,
    private readonly publish: Listener,
  ) {}

  async history(): Promise<SeatJournalRecord[]> {
    await this.initialize();
    return [...this.records.values()].map(record => structuredClone(record));
  }

  async begin(input: ContactInput): Promise<SeatJournalRecord> {
    await this.initialize();
    for (const value of [input.seatId, input.agentId, input.sourceSeatId]) identifier(value);
    if (input.workshopId !== this.workshopId) throw storageError('气旋联络记录归属不匹配');
    const now = new Date().toISOString();
    const record: SeatJournalRecord = {
      ...input, id: randomUUID(), kind: 'contact', status: 'running',
      title: input.title.slice(0, 300), sourceTitle: input.sourceTitle.slice(0, 120),
      startedAt: now, updatedAt: now,
    };
    await this.persist(record);
    this.records.set(record.id, record);
    this.publish(record);
    return record;
  }

  async finish(id: string, status: TerminalStatus, error?: string): Promise<void> {
    const previous = this.records.get(id);
    if (!previous) throw storageError('气旋联络记录不存在');
    const record: SeatJournalRecord = {
      ...previous, status, updatedAt: new Date().toISOString(),
      ...(error ? { error: error.slice(0, 1_000) } : {}),
    };
    await this.persist(record);
    this.records.set(id, record);
    this.publish(record);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initializing ??= this.load();
    try { await this.initializing; } finally { this.initializing = undefined; }
  }

  private async load(): Promise<void> {
    let files: string[];
    try { files = await fs.readdir(this.directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw storageError('读取气旋联络记录失败', error);
      this.initialized = true;
      return;
    }
    // Validate the entire set first. A damaged file must never become an empty history.
    const records = await Promise.all(files.filter(name => name.endsWith('.json')).map(async file => {
      try {
        const raw = await fs.readFile(path.join(this.directory, file), 'utf8');
        return parseRecord(JSON.parse(raw.replace(/^\uFEFF/, '')), this.workshopId, file);
      } catch (error) { throw storageError('气旋联络记录损坏，原文件已保留', error); }
    }));
    for (const record of records) {
      if (record.status === 'running') {
        record.status = 'crashed';
        record.updatedAt = new Date().toISOString();
        record.error = '服务重启前联络未正常结束';
        await this.persist(record);
      }
      this.records.set(record.id, record);
    }
    this.initialized = true;
  }

  private async persist(record: SeatJournalRecord): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await atomicWriteFile(path.join(this.directory, `${record.id}.json`), JSON.stringify(record, null, 2));
    } catch (error) { throw storageError('保存气旋联络记录失败', error); }
  }
}

function parseRecord(value: unknown, workshopId: string, file: string): SeatJournalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('record');
  const r = value as SeatJournalRecord;
  for (const id of [r.id, r.workshopId, r.seatId, r.agentId, r.sourceSeatId]) identifier(id);
  if (r.communicationId !== undefined) identifier(r.communicationId);
  if (r.workshopId !== workshopId || file !== `${r.id}.json` || r.kind !== 'contact'
    || !['running', 'completed', 'failed', 'aborted', 'crashed'].includes(r.status)
    || typeof r.title !== 'string' || typeof r.sourceTitle !== 'string'
    || !Number.isFinite(Date.parse(r.startedAt)) || !Number.isFinite(Date.parse(r.updatedAt))
    || (r.error !== undefined && typeof r.error !== 'string')) throw new Error('fields');
  return r;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw storageError('气旋联络记录标识无效');
  }
  return value;
}

function storageError(message: string, cause?: unknown) {
  return frameworkError({ code: 'CYCLONE_SEAT_EVENT_STORE_FAILED', kind: 'io', message,
    source: 'cyclone.seat-events', retryable: false }, cause === undefined ? undefined : { cause });
}
