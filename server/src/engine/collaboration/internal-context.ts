import type { CollaborationContext, CollaborationFeature } from './contracts.js';

export function internalContext(
  id: string, requestId: string, feature: CollaborationFeature,
): CollaborationContext {
  return {
    actor: { type: 'system', id, actingAs: 'system' },
    audience: 'internal', enabledFeatures: new Set([feature]),
    permissions: new Set(['observe', 'execute']), requestId,
  };
}
