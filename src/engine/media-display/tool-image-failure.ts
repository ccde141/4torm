import { backendFetch } from '../../lib/backend-client';
import type { MessageKey } from '../../i18n/locale';

export type ToolImageFailure = 'missing' | 'forbidden' | 'authentication' | 'unavailable' | 'network';

/** An img error has no HTTP status. Only its failed read is followed by a bounded, body-free check. */
export async function inspectToolImageFailure(
  url: string, signal: AbortSignal, request: typeof fetch = backendFetch,
): Promise<ToolImageFailure> {
  try {
    const response = await request(url, {
      method: 'HEAD', signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    });
    if (signal.aborted) throw signal.reason;
    if (response.status === 404 || response.status === 410) return 'missing';
    if (response.status === 401) return 'authentication';
    if (response.status === 403) return 'forbidden';
    return 'unavailable';
  } catch (error) {
    if (signal.aborted) throw error;
    return 'network';
  }
}

export function toolImageFailureKey(failure: ToolImageFailure | 'checking', original = false): MessageKey {
  if (failure === 'checking') return 'chat.images.checking';
  if (failure === 'missing') return 'chat.images.sourceMissing';
  if (failure === 'forbidden') return 'chat.images.forbidden';
  if (failure === 'authentication') return 'chat.images.authenticationRequired';
  if (failure === 'network') return 'chat.images.connectionFailed';
  return original ? 'chat.images.originalUnavailable' : 'chat.images.previewUnavailable';
}
