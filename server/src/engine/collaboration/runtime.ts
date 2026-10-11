import { CollaborationRouter } from './router.js';
import type { FeatureModule } from './contracts.js';
import type { AgentPresencePort } from './presence.js';
import type { GlobalSettingsPort } from './global-settings-port.js';

export interface CollaborationRuntimeOptions {
  monsoonModule: FeatureModule;
  tideModule: FeatureModule;
  tradewindModule: FeatureModule;
  convectionModule: FeatureModule;
  cycloneModule: FeatureModule;
  presencePort?: AgentPresencePort;
  settingsPort?: GlobalSettingsPort;
}

export function createCollaborationRuntime(
  options: CollaborationRuntimeOptions,
): CollaborationRouter {
  return new CollaborationRouter([
    options.monsoonModule, options.convectionModule, options.cycloneModule,
    options.tradewindModule, options.tideModule,
  ], options.presencePort, options.settingsPort);
}
