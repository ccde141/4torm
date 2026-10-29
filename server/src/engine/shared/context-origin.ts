import type { ContextMessage } from './types.js';
import { parseTextToolResult } from './text-tool-protocol.js';

/** Legacy envelopes stay recognizable until their owners persist explicit origin metadata. */
const FRAMEWORK_ENVELOPE = /^(?:\[System[:：]|\[系统(?:信息|提示|：)|【系统|\[工作队|\[历史(?:压缩|上下文)|\[已记录的 |\[框架|\[协作信息[:：]|\[Agent |\[公共会议[:：](?!人类\]))/;

export function isHumanContextMessage(message: ContextMessage): boolean {
  if (message.origin) return message.origin === 'human';
  if (('dispatchId' in message && typeof message.dispatchId === 'string' && message.dispatchId)
    || ('supervisorInboxId' in message && typeof message.supervisorInboxId === 'string' && message.supervisorInboxId)
    || ('supervisorInternal' in message && message.supervisorInternal === true)) return false;
  if (message.role !== 'user' || parseTextToolResult(message.content)) return false;
  return !FRAMEWORK_ENVELOPE.test(message.content.trimStart());
}

/** Local metadata survives storage but does not change message roles or tool pairing. */
export function contextOrigin(message: ContextMessage): 'human' | 'framework' {
  return isHumanContextMessage(message) ? 'human' : 'framework';
}
