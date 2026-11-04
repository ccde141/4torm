import type { GlobalSettingsPort } from '../../engine/collaboration/global-settings-port.js';
import { CompactionSettings } from './compaction-settings.js';
import { MemoryRecallSettingsService } from './memory-recall-settings.js';

export function createRuntimeSettingsPort(dataDir: string): GlobalSettingsPort {
  const compaction = new CompactionSettings(dataDir);
  const recall = new MemoryRecallSettingsService(dataDir);
  return { invoke(method, input, context) {
    if (method === 'readCompaction') return compaction.read();
    if (method === 'writeCompaction') return compaction.write(input);
    if (method === 'readMemoryRecall') return recall.read();
    if (method === 'writeMemoryRecall') return recall.write(input);
    if (method === 'testMemoryRecallModel') return recall.test(input, context.signal);
    return compaction.test(input);
  } };
}
