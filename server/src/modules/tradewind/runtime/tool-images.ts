import fs from 'node:fs/promises';
import path from 'node:path';
import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { missingToolImage, parseToolImageLookup, withToolImageTransport } from '../../../engine/collaboration/tool-image-transport.js';
import { activeNodeRunners } from '../../../engine/tradewind/nodes/agent.js';
import { activeMeetings } from '../../../engine/tradewind/nodes/meeting.js';
import { sameTradewindDataRoot } from '../../../services/tradewind-execution-registry.js';
import { tradewindRunDir } from '../../../services/data-paths.js';
import { readRunMeta } from './history-storage.js';
import { getMeetingFileName, getMeetingsDir } from '../../../engine/tradewind/foundation/archive-paths.js';

export function withTradewindToolImages(module: FeatureModule, dataDir: string): FeatureModule {
  return withToolImageTransport(module, dataDir, {
    parse: value => {
      const input = parseToolImageLookup(value, ['workflowId', 'executionId', 'nodeId', 'kind'], ['round']);
      if (!['node', 'meeting'].includes(input.target.kind!)) return missingToolImage();
      if (input.target.round !== undefined && !/^\d{1,9}$/.test(input.target.round)) return missingToolImage();
      return input;
    },
    sources: async target => {
      const { workflowId, executionId, nodeId, kind } = target;
      const runner = activeNodeRunners.get(nodeId!, executionId);
      if (kind === 'node' && runner && sameTradewindDataRoot(runner.getDataDir(), dataDir)
        && runner.getIdentity().workflowId === workflowId) return runner.getSnapshot();
      const meeting = activeMeetings.get(nodeId!, executionId);
      if (kind === 'meeting' && meeting && sameTradewindDataRoot(meeting.dataDir, dataDir)
        && meeting.workflowId === workflowId
        && (target.round === undefined || Number(target.round) === meeting.session.round)) return meeting.session;
      await readRunMeta(dataDir, { workflowId: workflowId!, executionId: executionId! });
      const root = tradewindRunDir(dataDir, workflowId!, executionId!);
      const file = kind === 'node' ? path.join(root, 'nodes', nodeId!, 'messages.json')
        : target.round === undefined ? undefined
          : path.join(getMeetingsDir(root), getMeetingFileName(nodeId!, Number(target.round)));
      if (!file) return [];
      try {
        let current = root;
        const segments = path.relative(root, file).split(path.sep);
        for (const [index, segment] of segments.entries()) {
          current = path.join(current, segment);
          const stat = await fs.lstat(current);
          if (stat.isSymbolicLink() || (index === segments.length - 1
            ? !stat.isFile() || stat.size > 64 * 1024 * 1024 : !stat.isDirectory())) return missingToolImage();
        }
        return JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },
  });
}
