import type {
  ModuleTransportHandler, ModuleTransportManifest,
} from '../../../engine/collaboration/contracts.js';
import type { ConvectionRoundService, StartDiscussionRoundInput } from '../application/round-service.js';
import { parseDiscussionRoundInput } from './round-methods.js';

export function convectionStreamManifests(): ModuleTransportManifest[] {
  return [{ id: 'discussionRound', permission: 'execute', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false,
      required: ['sessionId', 'round', 'message'] } }];
}

export function convectionStreamHandlers(
  rounds: Pick<ConvectionRoundService, 'prepare'>,
): Record<string, ModuleTransportHandler> {
  return { discussionRound: {
    parse: parseDiscussionRoundInput,
    prepare: async (_context, input) => rounds.prepare(input as StartDiscussionRoundInput),
  } };
}
