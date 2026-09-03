import fs from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteFile } from './atomic-io.js';

export interface CompactionSequenceState {
  archiveSeq: number;
}

export interface CompactionArchiveOptions {
  archiveDir: string;
  fileName: (sequence: number) => string;
  payload: unknown;
}

export type CompactionArchiveResult =
  | { ok: true; archivePath: string; sequence: number }
  | { ok: false; error: Error };

export async function prepareCompactionArchive(
  state: CompactionSequenceState,
  options: CompactionArchiveOptions,
): Promise<CompactionArchiveResult> {
  const sequence = state.archiveSeq + 1;
  const archivePath = path.join(options.archiveDir, options.fileName(sequence));
  try {
    await fs.mkdir(options.archiveDir, { recursive: true });
    await atomicWriteFile(archivePath, JSON.stringify(options.payload, null, 2));
    state.archiveSeq = sequence;
    return { ok: true, archivePath, sequence };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
