import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { parseToolImageLookup, withToolImageTransport } from '../../../engine/collaboration/tool-image-transport.js';
import type { ConvectionSessionService } from '../application/session-service.js';

export function withConvectionToolImages(module: FeatureModule, dataDir: string,
  sessions: ConvectionSessionService): FeatureModule {
  return withToolImageTransport(module, dataDir, {
    parse: value => parseToolImageLookup(value, ['sessionId']),
    sources: target => sessions.require(target.sessionId!),
  });
}
