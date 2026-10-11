import type { ModuleTransportHandler, ModuleTransportManifest } from
  '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { ConvectionConferenceEvent, ConvectionConferenceFeed } from
  '../application/conference-feed.js';
import type { ConvectionDiscussionService, DiscussionView } from
  '../application/discussion-service.js';
import type { ConvectionSessionService } from '../application/session-service.js';

type Rooms = Awaited<ReturnType<ConvectionSessionService['list']>>;

export interface PreparedConvectionFeed {
  subscribe(listener: (event: ConvectionConferenceEvent) => void): () => void;
  snapshot(): Promise<{ sessions: Rooms; live?: DiscussionView; chairLive?: DiscussionView;
    missingSessionId?: string }>;
}

export function convectionFeedManifest(): ModuleTransportManifest {
  return { id: 'conferenceFeed', permission: 'observe', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false,
      properties: { sessionId: { type: 'string' } } } };
}

export function convectionFeedHandler(
  sessions: ConvectionSessionService,
  discussions: ConvectionDiscussionService,
  feed: ConvectionConferenceFeed,
): ModuleTransportHandler {
  return { parse: parseFeedInput, prepare: async (_context, input) => {
    const { sessionId } = input as { sessionId?: string };
    return {
      subscribe: listener => feed.subscribe(event => {
        if (event.type === 'session-changed' || event.sessionId === sessionId) listener(event);
      }),
      snapshot: async () => {
        const rooms = await sessions.list();
        if (!sessionId) return { sessions: rooms };
        if (!rooms.some(room => room.id === sessionId)) {
          return { sessions: rooms, missingSessionId: sessionId };
        }
        const budget = { items: 30, textChars: 16_000, textLines: 320 };
        const live = await discussions.read(sessionId, budget);
        return { sessions: rooms, live,
          ...(live.activeRound?.round === 'chair' ? {
            chairLive: await discussions.read(sessionId, budget, 'chair'),
          } : {}) };
      },
    } satisfies PreparedConvectionFeed;
  } };
}

function parseFeedInput(value: unknown): { sessionId?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidFeed();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== 'sessionId')) throw invalidFeed();
  if (record.sessionId === undefined) return {};
  if (typeof record.sessionId !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(record.sessionId)) throw invalidFeed();
  return { sessionId: record.sessionId };
}

function invalidFeed(): Error {
  return frameworkError({ code: 'CONVECTION_FEED_INPUT_INVALID', kind: 'validation',
    message: '会议订阅参数无效', source: 'convection.feed', retryable: false });
}
