import type { WorkflowRunArchive } from './records-client';
import type { ToolImageRef } from '../../../../engine/tool-media';

interface ArchiveMessage {
  content: string; source?: string; role?: string; timestamp?: string | number; envelopeId?: string;
  toolName?: string; scope?: 'public' | 'chair';
  toolImages?: ToolImageRef[];
}
type Display = { kind: 'messages'; items: ArchiveMessage[] } | { kind: 'fragment'; text: string } | { kind: 'unavailable' };

/** Never show an unprojected provider-context fragment, including responses from an older backend. */
export function archiveDisplay(text: string, complete: boolean, kind: WorkflowRunArchive['kind'],
  presentation?: 'public-conversation',
): Display {
  if (kind !== 'output' && presentation !== 'public-conversation') return { kind: 'unavailable' };
  if (complete) {
    try {
      const value: unknown = JSON.parse(text);
      if (Array.isArray(value) && value.length <= 200 && value.every(isMessage)) {
        const items = kind === 'output' ? value : value.filter(item => ['user', 'assistant', 'tool'].includes(item.role ?? ''));
        return { kind: 'messages', items };
      }
    } catch { /* A bounded, already projected segment can be displayed as text. */ }
  }
  return { kind: 'fragment', text };
}

function isMessage(value: unknown): value is ArchiveMessage {
  return !!value && typeof value === 'object' && 'content' in value && typeof value.content === 'string';
}
