export function normalizeDelegateProgressAtToolBoundary(content: string): string {
  const visible = content.trim();
  return visible ? `${visible}\n` : '';
}

export function visibleDelegateProgress(content: string | undefined): string {
  return content?.trim() ?? '';
}
