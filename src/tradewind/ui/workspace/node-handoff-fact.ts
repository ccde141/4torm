export function nodeHandoffFact<T extends { activationId: string; target: string }>(
  facts: readonly T[], nodeId: string, activationId?: string,
): T | undefined {
  return activationId ? facts.find(item => item.target === nodeId && item.activationId === activationId) : undefined;
}
