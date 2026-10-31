import { backendUrl } from '../lib/backend-client';

/** Durable tool output. Image bytes stay behind the owning feature's read port. */
export interface ToolImageRef {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

export type ToolMediaScope =
  | { feature: 'monsoon'; agentId: string; sessionId: string }
  | { feature: 'convection'; sessionId: string }
  | { feature: 'cyclone'; workshopId: string; kind: 'seat' | 'room' | 'chair' | 'supervisor'; targetId: string }
  | { feature: 'tradewind'; workflowId: string; executionId: string; nodeId: string;
      kind: 'node' | 'meeting'; round?: string }
  | ({ feature: 'tide' } & ({ taskId: string; runId: string } | { agentId: string; sessionId: string }));

export function toolImageUrl(scope: ToolMediaScope, imageId: string): string {
  return mediaUrl(scope, imageId, false);
}

/** Display-sized media only; loading a failed preview must never fall back to original bytes. */
export function toolImagePreviewUrl(scope: ToolMediaScope, imageId: string): string {
  return mediaUrl(scope, imageId, true);
}

function mediaUrl(scope: ToolMediaScope, imageId: string, preview: boolean): string {
  const { feature, ...identity } = scope;
  const query = new URLSearchParams(Object.entries(identity)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  if (preview) query.set('preview', '1');
  return backendUrl(`/api/tool-media/${feature}/${encodeURIComponent(imageId)}?${query}`);
}
