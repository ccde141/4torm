export function appendReasoning(current: string, chunk: string): string {
  return current + chunk;
}

export interface ChairStreamContent {
  content: string;
  reasoning: string;
}

export function appendChairStreamChunk(
  current: ChairStreamContent,
  type: 'chair-token' | 'chair-reasoning',
  chunk: string,
): ChairStreamContent {
  if (type === 'chair-reasoning') {
    return { ...current, reasoning: appendReasoning(current.reasoning, chunk) };
  }
  return { ...current, content: current.content + chunk };
}

export function combineReasoning(nativeReasoning?: string, taggedReasoning?: string): string {
  const nativeText = nativeReasoning?.trim() ?? '';
  const taggedText = taggedReasoning?.trim() ?? '';
  if (!nativeText) return taggedText;
  if (!taggedText || nativeText === taggedText) return nativeText;
  return `${nativeText}\n\n${taggedText}`;
}
