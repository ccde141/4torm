import type { GlobalSettingsPort } from '../../engine/collaboration/global-settings-port.js';
import { CompactionSettings } from './compaction-settings.js';

export function createRuntimeSettingsPort(dataDir: string): GlobalSettingsPort {
  const compaction = new CompactionSettings(dataDir);
  return { invoke(method, input) {
    if (method === 'readCompaction') return compaction.read();
    if (method === 'writeCompaction') return compaction.write(input);
    return compaction.test(input);
  } };
}
