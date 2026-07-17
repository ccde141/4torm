export function appendReasoning(current: string, chunk: string): string {
  return current + chunk;
}

export function combineReasoning(nativeReasoning?: string, taggedReasoning?: string): string {
  const nativeText = nativeReasoning?.trim() ?? '';
  const taggedText = taggedReasoning?.trim() ?? '';
  if (!nativeText) return taggedText;
  if (!taggedText || nativeText === taggedText) return nativeText;
  return `${nativeText}\n\n${taggedText}`;
}
