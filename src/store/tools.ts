import { readJson, writeJson } from '../api/storage';

export interface ToolDef {
  name: string;
  description: string;
  category: 'io' | 'system' | 'custom';
  dangerous: boolean;
  parameters: Record<string, unknown>;
  executorType: 'builtin' | 'template' | 'custom';
  executorFile?: string;
  executorTemplate?: string;
}

export interface ToolDefForm {
  name: string;
  description: string;
  category: ToolDef['category'];
  dangerous: boolean;
  executorType: ToolDef['executorType'];
  executorFile?: string;
  executorTemplate?: string;
  parametersJson: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  io: '文件读写',
  system: '系统命令',
  custom: '自定义',
};

const REGISTRY_FILE = 'tools/registry.json';

export function buildToolsPrompt(tools: ToolDef[]): string {
  if (tools.length === 0) return '';
  const lines = ['## 可用工具', ''];
  for (const t of tools) {
    lines.push(`### ${t.name}`);
    lines.push(`- 描述: ${t.description}`);
    lines.push(`- 参数: \`${JSON.stringify(t.parameters)}\``);
    lines.push(`- 危险: ${t.dangerous ? '是' : '否'}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function toolsToOpenAI(tools: ToolDef[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export async function getTools(): Promise<ToolDef[]> {
  const data = await readJson<ToolDef[]>(REGISTRY_FILE);
  return data || [];
}

export async function saveTools(tools: ToolDef[]): Promise<void> {
  await writeJson(REGISTRY_FILE, tools);
}

export async function seedTools() {
  const existing = await getTools();
  const names = new Set(existing.map(t => t.name));
  let changed = false;
  for (const t of BUILTIN_TOOLS) {
    if (!names.has(t.name)) {
      existing.push(t);
      changed = true;
    }
  }
  if (changed || existing.length === 0) {
    await saveTools(existing);
  }
}

export async function getToolsByNames(names: string[]): Promise<ToolDef[]> {
  const all = await getTools();
  return all.filter(t => names.includes(t.name));
}

export const BUILTIN_TOOLS: ToolDef[] = [
  {
    name: 'read_file',
    description: '读取文件内容，返回全文',
    category: 'io', dangerous: false, executorType: 'builtin', executorFile: 'read_file',
    parameters: { type: 'object', properties: { filePath: { type: 'string', description: '相对于工作区根目录的文件路径' } }, required: ['filePath'] },
  },
  {
    name: 'write_file',
    description: '创建或覆盖文件',
    category: 'io', dangerous: true, executorType: 'builtin', executorFile: 'write_file',
    parameters: { type: 'object', properties: { filePath: { type: 'string', description: '相对于工作区根目录的文件路径' }, content: { type: 'string', description: '要写入的完整内容' } }, required: ['filePath', 'content'] },
  },
  {
    name: 'edit_file',
    description: '精确替换文件中的一段文本',
    category: 'io', dangerous: true, executorType: 'builtin', executorFile: 'edit_file',
    parameters: { type: 'object', properties: { filePath: { type: 'string', description: '文件路径' }, oldString: { type: 'string', description: '要被替换的原文本（必须精确匹配）' }, newString: { type: 'string', description: '替换后的新文本' } }, required: ['filePath', 'oldString', 'newString'] },
  },
  {
    name: 'list_directory',
    description: '列出目录中的所有文件和子目录',
    category: 'io', dangerous: false, executorType: 'builtin', executorFile: 'list_directory',
    parameters: { type: 'object', properties: { dirPath: { type: 'string', description: '目录路径，留空则为工作区根目录' } }, required: [] },
  },
  {
    name: 'run_command',
    description: '在终端执行一条系统命令',
    category: 'system', dangerous: true, executorType: 'builtin', executorFile: 'run_command',
    parameters: { type: 'object', properties: { command: { type: 'string', description: '要执行的 shell 命令' } }, required: ['command'] },
  },
  {
    name: 'webfetch',
    description: '获取网页或 API 的文本内容',
    category: 'system', dangerous: false, executorType: 'builtin', executorFile: 'webfetch',
    parameters: { type: 'object', properties: { url: { type: 'string', description: '完整 URL 地址' } }, required: ['url'] },
  },
];
