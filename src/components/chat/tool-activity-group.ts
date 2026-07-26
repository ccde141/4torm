const FRAMEWORK_TOOLS = new Set([
  'ask', 'delegate', 'contact', 'dispatch', 'bulletin', 'task_board',
  'register_tool', 'register_skill', 'review_changes', 'list_agents',
  'create_workflow', 'list_workflows', 'update_workflow', 'complete_task',
  'create_automation', 'update_automation', 'list_automations',
  'envelope_add', 'envelope_remove', 'envelope_list',
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
