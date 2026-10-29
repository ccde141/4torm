import { MonsoonCompactionService } from '../application/compaction-service.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { summarizeMonsoonCompaction } from '../runtime/compaction-summarizer.js';
import { buildMonsoonCompactionContext } from '../runtime/compaction-context.js';

/** Other islands delegate human compaction through the owner port and its lease. */
export function createMonsoonCompactionPort(dataDir: string): MonsoonCompactionService {
  return new MonsoonCompactionService(dataDir, new FileMonsoonSessionRepository(dataDir),
    summarizeMonsoonCompaction, undefined, buildMonsoonCompactionContext);
}
