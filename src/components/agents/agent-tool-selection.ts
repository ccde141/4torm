interface LocalTool {
  name: string;
  executorType: string;
}

interface SkillItem {
  id: string;
}

export type ToolMode = 'all' | 'selected';

export function getInitialToolSelection<T extends LocalTool>(
  allTools: readonly T[],
  configuredNames: readonly string[],
  toolMode: ToolMode | undefined,
  isCreate: boolean,
): Set<string> {
  const legacyDefault = toolMode === undefined && configuredNames.length === 0;
  if (isCreate || toolMode === 'all' || legacyDefault) {
    return new Set(
      allTools.filter(tool => tool.executorType === 'builtin').map(tool => tool.name),
    );
  }
  return new Set(configuredNames);
}

export function getDefaultSkillSelection<T extends SkillItem>(
  allSkills: readonly T[],
  configuredIds: readonly string[],
  isCreate: boolean,
): Set<string> {
  return new Set(isCreate ? allSkills.map(skill => skill.id) : configuredIds);
}

export function getEffectiveLocalTools<T extends LocalTool>(
  allTools: readonly T[],
  selectedNames: ReadonlySet<string>,
): T[] {
  return allTools.filter(tool => selectedNames.has(tool.name));
}
