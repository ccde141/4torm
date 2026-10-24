import path from 'node:path';
import fs from 'node:fs/promises';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { parseModelUsageProgress, type ModelUsageProgress } from '../../../engine/shared/model-request-usage.js';
import { convectionSessionDir } from '../../../services/data-paths.js';
import { readConvectionJson } from './quarantined-json.js';

export type ConvectionModelUsage = Partial<Record<'publicModelUsage' | 'chairModelUsage', ModelUsageProgress>>;

/** Metering commits independently from conversation/compaction transactions. */
export async function writeConvectionModelUsage(dataDir: string, sessionId: string,
  kind: 'public' | 'chair', usage: ModelUsageProgress): Promise<void> {
  const dir = convectionSessionDir(dataDir, sessionId);
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteFile(path.join(dir, `${kind}-model-usage.json`), JSON.stringify(usage));
}

export async function readConvectionModelUsage(dataDir: string, sessionId: string): Promise<ConvectionModelUsage> {
  const dir = convectionSessionDir(dataDir, sessionId);
  const [publicModelUsage, chairModelUsage] = await Promise.all(['public', 'chair'].map(kind =>
    readConvectionJson<ModelUsageProgress>(path.join(dir, `${kind}-model-usage.json`))));
  return { ...(publicModelUsage ? { publicModelUsage: parseModelUsageProgress(publicModelUsage) } : {}),
    ...(chairModelUsage ? { chairModelUsage: parseModelUsageProgress(chairModelUsage) } : {}) };
}
