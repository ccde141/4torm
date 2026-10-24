import type { ConvectionSessionData } from '../infrastructure/session-store.js';
import { buildConvectionChairContext } from './chair-context.js';
import { buildConvectionChairPrompt } from './prompt-profiles.js';

/** Shared by the real assistant request and its read-only input projection. */
export function buildConvectionChairMessages(session: ConvectionSessionData, chairName: string) {
  return buildConvectionChairContext(session, { role: 'system',
    content: buildConvectionChairPrompt({ chairName, topic: session.topic }) });
}
