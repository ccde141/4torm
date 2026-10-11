import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../atomic-io.js';
import { frameworkError } from '../framework-error.js';
import { COMPACTION_AREAS, type CompactionPolicy } from './contracts.js';

export function defaultCompactionPolicy(): CompactionPolicy {
  return {
    version: 1, enabled: false, prefixRatio: 2 / 3, modelMode: 'current', fixedModel: null,
    thresholds: Object.fromEntries(COMPACTION_AREAS.map(area => [area, 240_000])) as CompactionPolicy['thresholds'],
  };
}

export function parseCompactionPolicy(value: unknown): CompactionPolicy {
  if (!isRecord(value) || value.version !== 1 || typeof value.enabled !== 'boolean') return invalid();
  if (typeof value.prefixRatio !== 'number' || !Number.isFinite(value.prefixRatio)
    || value.prefixRatio <= 0 || value.prefixRatio >= 1) return invalid();
  if (value.modelMode !== 'current' && value.modelMode !== 'fixed') return invalid();
  if (value.fixedModel !== null && (typeof value.fixedModel !== 'string'
    || !value.fixedModel.trim())) return invalid();
  if (value.modelMode === 'fixed' && value.fixedModel === null) return invalid();
  if (!isRecord(value.thresholds)) return invalid();
  const thresholds = {} as CompactionPolicy['thresholds'];
  for (const area of COMPACTION_AREAS) {
    const threshold = value.thresholds[area];
    if (!Number.isSafeInteger(threshold) || Number(threshold) < 1_000
      || Number(threshold) > 10_000_000) return invalid();
    thresholds[area] = Number(threshold);
  }
  return { version: 1, enabled: value.enabled, prefixRatio: value.prefixRatio,
    modelMode: value.modelMode, fixedModel: value.fixedModel as string | null, thresholds };
}

/** No process cache: a live turn observes the policy chosen at its next model boundary. */
export async function loadCompactionPolicy(dataDir: string): Promise<CompactionPolicy> {
  try {
    const raw = await fs.readFile(compactionPolicyFile(dataDir), 'utf8');
    return parseCompactionPolicy(JSON.parse(raw));
  } catch (error) {
    if (isMissing(error)) return defaultCompactionPolicy();
    throw error;
  }
}

export async function saveCompactionPolicy(dataDir: string, value: unknown): Promise<CompactionPolicy> {
  const policy = parseCompactionPolicy(value);
  await fs.mkdir(dataDir, { recursive: true });
  await atomicWriteFile(compactionPolicyFile(dataDir), JSON.stringify(policy, null, 2));
  return policy;
}

export function compactionPolicyFile(dataDir: string): string {
  return path.join(dataDir, 'compaction-policy.json');
}

function invalid(): never {
  throw frameworkError({ code: 'COMPACTION_POLICY_INVALID', kind: 'validation',
    message: '会话压缩设置无效', source: 'compaction-policy', retryable: false });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
