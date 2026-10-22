import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { missingToolImage, parseToolImageLookup, withToolImageTransport } from '../../../engine/collaboration/tool-image-transport.js';
import type { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';

export function withMonsoonToolImages(module: FeatureModule, dataDir: string,
  sessions: FileMonsoonSessionRepository): FeatureModule {
  return withToolImageTransport(module, dataDir, {
    parse: value => parseToolImageLookup(value, ['agentId', 'sessionId']),
    sources: async target => {
      const session = await sessions.get(target.agentId!, target.sessionId!);
      if (!session) return missingToolImage();
      return session;
    },
  });
}
