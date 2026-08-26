export async function resolveConvectionPromptThreshold(
  modelKeys: readonly string[],
  resolveBudget: (modelKey: string) => Promise<number | undefined>,
): Promise<number | undefined> {
  const uniqueModels = [...new Set(modelKeys)];
  const budgets = await Promise.all(uniqueModels.map(resolveBudget));
  const discovered = budgets.filter((value): value is number => value !== undefined);
  return discovered.length > 0 ? Math.min(...discovered) : undefined;
}
