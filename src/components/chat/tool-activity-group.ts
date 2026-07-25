const FRAMEWORK_TOOLS = new Set([
  'ask', 'delegate', 'contact', 'dispatch', 'task_board',
  'register_tool', 'register_skill', 'list_agents', 'create_workflow', 'complete_task',
]);

export interface ToolActivityLike { tool: string }

export interface ToolActivityPart<T extends ToolActivityLike> {
  kind: 'single' | 'group';
  items: T[];
}

export function isFrameworkTool(name: string): boolean {
  return FRAMEWORK_TOOLS.has(name.trim().toLowerCase());
}

export function partitionToolActivity<T extends ToolActivityLike>(items: T[]): ToolActivityPart<T>[] {
  const parts: ToolActivityPart<T>[] = [];
  let ordinary: T[] = [];
  const flush = () => {
    if (!ordinary.length) return;
    parts.push({ kind: ordinary.length > 1 ? 'group' : 'single', items: ordinary });
    ordinary = [];
  };
  for (const item of items) {
    if (isFrameworkTool(item.tool)) {
      flush();
      parts.push({ kind: 'single', items: [item] });
    } else {
      ordinary.push(item);
    }
  }
  flush();
  return parts;
}
