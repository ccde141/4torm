interface LocalTool {
  name: string;
  executorType: string;
}

export function getEffectiveLocalTools<T extends LocalTool>(
  allTools: readonly T[],
  selectedNames: ReadonlySet<string>,
): T[] {
  if (selectedNames.size === 0) {
    return allTools.filter(tool => tool.executorType === 'builtin');
  }
  return allTools.filter(tool => selectedNames.has(tool.name));
}
