import fs from 'node:fs/promises';
import path from 'node:path';
import { EMBEDDING_BATCH_SIZE, embedTexts, embeddingFingerprint, validVector } from '../../../model-runtime/embeddings.js';
import { recallDirectory, recallHash, recallObject, readRecallJson, writeRecallJson } from './storage.js';
import type { RecallRecord } from './contracts.js';

export interface VectorIndex {
  file(record: RecallRecord): string;
  has(record: RecallRecord): boolean;
  read(record: RecallRecord): Promise<number[] | null>;
  add(records: RecallRecord[], signal: AbortSignal): Promise<void>;
}

/** Inventory once: a large, partially indexed library must not open one missing file per record. */
export async function openVectorIndex(dataDir: string, agentId: string, model: string): Promise<VectorIndex> {
  const directory = path.join(recallDirectory(dataDir, agentId), 'vectors');
  const fingerprint = await embeddingFingerprint(dataDir, model);
  let names: string[];
  try { names = await fs.readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; names = []; }
  const present = new Set(names);
  const name = (record: RecallRecord) => `${recallHash(`${fingerprint}:${record.id}:${record.revision}`)}.json`;
  const file = (record: RecallRecord) => path.join(directory, name(record));
  return {
    file, has: record => present.has(name(record)),
    read: async record => {
      const cached = await readRecallJson(file(record), (value): value is { vector: number[] } =>
        recallObject(value) && validVector(value.vector));
      return cached?.vector ?? null;
    },
    add: async (records, signal) => {
      for (let offset = 0; offset < records.length; offset += EMBEDDING_BATCH_SIZE) {
        signal.throwIfAborted();
        const batch = records.slice(offset, offset + EMBEDDING_BATCH_SIZE);
        const vectors = await embedTexts(dataDir, model, batch.map(record => `${record.title}\n${record.summary}`.slice(0, 3500)), signal);
        signal.throwIfAborted();
        await Promise.all(batch.map(async (record, i) => {
          await writeRecallJson(file(record), { vector: vectors[i] }); present.add(name(record));
        }));
      }
    },
  };
}

/** Idle work builds all missing vectors, with bounded batches and cancellation between requests. */
export async function completeRecallIndex(dataDir: string, agentId: string, records: RecallRecord[], model: string,
  signal: AbortSignal): Promise<void> {
  const index = await openVectorIndex(dataDir, agentId, model);
  signal.throwIfAborted();
  await index.add(records.filter(record => !record.archived && !index.has(record)), signal);
}
