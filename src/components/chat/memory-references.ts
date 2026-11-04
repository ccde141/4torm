import type { ChatMessage } from '../../types';

export interface MemoryReference {
  id: string; revision: string; title: string; text: string;
  level: 'L1' | 'L2'; kind: 'memory' | 'work'; scope?: string; date?: string; sequence?: number;
}

/** Message IDs supply the variation; rerenders and reloads keep the same wording. */
export function memoryRecallLabel(messageId: string): 'recall.used' | 'recall.thisRecall' {
  let hash = 2166136261;
  for (let index = 0; index < messageId.length; index++) hash = Math.imul(hash ^ messageId.charCodeAt(index), 16777619);
  return ((hash ^ (hash >>> 16)) & 1) === 0 ? 'recall.used' : 'recall.thisRecall';
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function references(content: string): MemoryReference[] {
  const prefix = '[框架记忆参考]\n';
  if (!content.startsWith(prefix) || content.length > 65536) return [];
  try {
    const payload: unknown = JSON.parse(content.slice(prefix.length));
    if (!record(payload) || !Array.isArray(payload.records)) return [];
    return payload.records.slice(0, 8).flatMap((item: unknown) => {
      if (!record(item) || !['id', 'revision', 'title', 'text'].every(key => typeof item[key] === 'string')
        || !['L1', 'L2'].includes(String(item.level)) || !['memory', 'work'].includes(String(item.kind))) return [];
      return [{ id: String(item.id), revision: String(item.revision), title: String(item.title).slice(0, 200),
        text: String(item.text).slice(0, 32000), level: item.level as MemoryReference['level'], kind: item.kind as MemoryReference['kind'],
        ...(typeof item.scope === 'string' ? { scope: item.scope.slice(0, 200) } : {}),
        ...(typeof item.date === 'string' ? { date: item.date.slice(0, 40) } : {}),
        ...(Number.isSafeInteger(item.sequence) && Number(item.sequence) > 0 ? { sequence: Number(item.sequence) } : {}) }];
    });
  } catch { return []; }
}

/** The saved input checkpoint is the delivery evidence; pending candidates never enter this view. */
const assistantReferences = new WeakMap<ChatMessage, {
  previousHuman: string | undefined; sources: Map<string, MemoryReference[]>;
}>();

export function memoryReferencesByHuman(messages: readonly ChatMessage[]): Map<string, MemoryReference[]> {
  const result = new Map<string, MemoryReference[]>();
  let previousHuman: string | undefined;
  for (const message of messages) {
    if (message.role === 'user') previousHuman = message.id;
    if (message.role !== 'assistant') continue;
    let cached = assistantReferences.get(message);
    if (!cached || cached.previousHuman !== previousHuman) {
      cached = { previousHuman, sources: readAssistantReferences(message, previousHuman) };
      assistantReferences.set(message, cached);
    }
    for (const [target, found] of cached.sources) mergeReferences(result, target, found);
  }
  return result;
}

function readAssistantReferences(message: ChatMessage, previousHuman: string | undefined): Map<string, MemoryReference[]> {
  const result = new Map<string, MemoryReference[]>();
  let target = previousHuman, cursor = 0;
  for (const item of message.nativeContext ?? []) {
    if (item.role === 'user' && item.origin === 'human') {
      const inputs = message.humanInputs ?? [];
      const index = inputs.findIndex((input, i) => i >= cursor && input.state === 'included' && input.content === item.content);
      target = index < 0 ? undefined : inputs[index].id;
      if (index >= 0) cursor = index + 1;
    }
    if (!target || item.role !== 'user' || item.origin !== 'framework') continue;
    const found = references(item.content);
    if (!found.length) continue;
    mergeReferences(result, target, found);
  }
  return result;
}

function mergeReferences(result: Map<string, MemoryReference[]>, target: string, found: MemoryReference[]): void {
  const merged = [...(result.get(target) ?? [])];
  for (const source of found) {
    const index = merged.findIndex(old => old.id === source.id && old.revision === source.revision);
    if (index < 0) { merged.push(source); continue; }
    const old = merged[index];
    if (old.text.includes(source.text)) continue;
    merged[index] = { ...source, level: old.level === 'L2' ? old.level : source.level,
      text: (source.text.includes(old.text) ? source.text : `${old.text}\n\n${source.text}`).slice(0, 32000) };
  }
  result.set(target, merged.slice(0, 8));
}
