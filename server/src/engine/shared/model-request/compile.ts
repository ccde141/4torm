import type { ContextMessage } from '../types.js';
import { normalizeSystemMessages } from '../system-messages.js';
import { projectChatToolImages } from './tool-image-projection.js';
import {
  mapProviderMessages,
} from '../provider-messages.js';
import type { ProviderModelIdentity } from '../provider-normalization.js';
import {
  completeHistoricalToolNameMap,
  downgradeIncompleteNativeToolHistory,
  encodeNativeToolHistoryForText,
  restoreTextToolHistory,
} from './tool-history.js';

export interface ModelRequestMessageOptions {
  identity: ProviderModelIdentity;
  forwardToolNames: Map<string, string>;
  toolTransport?: 'native' | 'text';
}

/** Compile canonical session messages for the currently selected model. */
export function compileModelMessages(
  messages: ContextMessage[],
  options: ModelRequestMessageOptions,
): Array<Record<string, unknown>> {
  const providerSafeMessages = normalizeSystemMessages(messages);
  if (options.toolTransport === 'text') {
    return mapProviderMessages(
      projectChatToolImages(encodeNativeToolHistoryForText(providerSafeMessages, options.forwardToolNames)),
      options.forwardToolNames, options.identity,
    );
  }
  const restoredHistory = restoreTextToolHistory(providerSafeMessages);
  const historyNames = completeHistoricalToolNameMap(restoredHistory, options.forwardToolNames);
  const safeHistory = downgradeIncompleteNativeToolHistory(restoredHistory, historyNames)
    .map(message => message.role === 'tool' && message.toolOk === false
      ? { ...message, content: message.content.startsWith('Error: ')
        ? message.content : `Error: ${message.content}` }
      : message);
  return mapProviderMessages(
    projectChatToolImages(safeHistory),
    historyNames,
    options.identity);
}
