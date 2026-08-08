export interface ToolDef {
  name: string;
  description: string;
  category: 'io' | 'system' | 'custom';
  dangerous: boolean;
  parameters: Record<string, unknown>;
  executorType: 'builtin' | 'template' | 'custom';
  executorFile?: string;
  executorTemplate?: string;
  executionMode?: 'sync' | 'detachable';
  source?: 'framework' | 'custom';
  readonly?: boolean;
}

export interface ToolDefForm {
  name: string;
  description: string;
  category: ToolDef['category'];
  dangerous: boolean;
  executorType: ToolDef['executorType'];
  executorFile?: string;
  executorTemplate?: string;
  executionMode: NonNullable<ToolDef['executionMode']>;
  parametersJson: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  io: '文件读写',
  system: '系统命令',
  custom: '自定义',
};

export function buildToolsPrompt(tools: ToolDef[]): string {
  if (tools.length === 0) return '';
  const lines = ['## 可用工具', ''];
  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    lines.push(`- 描述: ${tool.description}`);
    lines.push(`- 参数: \`${JSON.stringify(tool.parameters)}\``);
    lines.push(`- 危险: ${tool.dangerous ? '是' : '否'}`);
    lines.push(`- 执行生命周期: ${tool.executionMode === 'detachable' ? '可后台化' : '同步完成'}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function getTools(): Promise<ToolDef[]> {
  const response = await fetch('/api/tools/catalog');
  if (!response.ok) throw new Error(`加载工具目录失败: ${response.status}`);
  const body = await response.json() as { tools?: ToolDef[] };
  return Array.isArray(body.tools) ? body.tools : [];
}

/** 只保存用户自定义工具；框架工具由服务端固定清单维护。 */
export async function saveTools(tools: ToolDef[]): Promise<void> {
  const custom = tools.filter(tool => tool.source === 'custom' || tool.readonly === false);
  const response = await fetch('/api/tools/custom', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tools: custom }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `保存工具失败: ${response.status}`);
  }
}

export async function getToolsByNames(names: string[]): Promise<ToolDef[]> {
  const all = await getTools();
  const selected = new Set(names);
  return all.filter(tool => selected.has(tool.name));
}
