/**
 * 文件执行策略 prompt 段落生成器。
 * 内置文件工具权限说明。旧 strict/relaxed 按项目级兼容。
 */

export type SandboxLevel = 'project' | 'unrestricted' | 'strict' | 'relaxed';

export interface SandboxPromptParams {
  workspaceAbs: string;
  projectDir: string;
  sandboxLevel: SandboxLevel;
  workspaceLabel?: string;
}

export function buildSandboxSection(params: SandboxPromptParams): string {
  const { workspaceAbs, projectDir } = params;
  const label = params.workspaceLabel || '你的工作区';
  const level = params.sandboxLevel === 'unrestricted' ? 'unrestricted' : 'project';
  const scope = level === 'unrestricted'
    ? '- 当前为无限制：内置文件工具可以访问外部路径'
    : '- 当前为项目级：内置文件工具只能访问项目目录和当前工作区';

  return `## 工作区（基地）

- ${label}: \`${workspaceAbs}\`
- 项目根目录: \`${projectDir}\`
- 文件工具相对路径基于工作区解析（\`./xxx\` 或不带前缀）
- 绝对路径和 \`../\` 仍须符合当前文件工具权限
${scope}
- \`run_command\` 默认在工作区启动，可自行使用 \`cd\` 切换目录
- 此处的路径限制只约束框架内置文件工具；命令、MCP 和自定义执行器按各自能力运行

## 唯一写保护：框架控制面

不得通过普通文件工具直接改写 Agent/工具注册表、潮汐任务表、工作流 graph/meta 等控制面数据；工作流自己的 \`workspace/\` 仍可正常写入。需要修改控制面时使用对应专用工具。`;
}
