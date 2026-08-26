export function selectionAfterProviderRemoval(
  providers: Array<{ id: string }>,
  selectedId: string | null,
  removedId: string,
): string | null {
  if (selectedId !== removedId) return selectedId;
  const index = providers.findIndex(provider => provider.id === removedId);
  if (index < 0) return selectedId;
  return providers[index + 1]?.id ?? providers[index - 1]?.id ?? null;
}
