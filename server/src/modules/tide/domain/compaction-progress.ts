import type { CompactionProgress } from '../../../engine/shared/compaction/index.js';

export function parseTideCompactionProgress(value: unknown): CompactionProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid compaction');
  const input = value as Record<string, unknown>;
  if (!['compact-start', 'compact-done', 'compact-failed'].includes(String(input.type))
    || typeof input.id !== 'string' || !input.id
    || !['compact', 'reset'].includes(String(input.operation))
    || !['manual', 'threshold', 'provider-overflow'].includes(String(input.reason))
    || typeof input.startedAt !== 'number' || !Number.isFinite(input.startedAt)
    || typeof input.updatedAt !== 'number' || !Number.isFinite(input.updatedAt)
    || (input.message !== undefined && typeof input.message !== 'string')
    || (input.aborted !== undefined && typeof input.aborted !== 'boolean')) {
    throw new Error('invalid compaction progress');
  }
  for (const field of ['summaryLength', 'archivedMessages']) {
    if (input[field] !== undefined && (!Number.isSafeInteger(input[field]) || Number(input[field]) < 0)) {
      throw new Error(`invalid compaction ${field}`);
    }
  }
  return structuredClone(input) as unknown as CompactionProgress;
}
