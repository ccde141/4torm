/**
 * 文件执行策略 prompt 段落生成器。
 * 旧 sandboxLevel 仅为数据兼容保留，所有 Agent 使用同一执行策略。
 */

export type SandboxLevel = 'strict' | 'relaxed' | 'unrestricted';

export interface SandboxPromptParams {
  workspaceAbs: string;
  projectDir: string;
  sandboxLevel: SandboxLevel;
  workspaceLabel?: string;
}

export function buildSandboxSection(params: SandboxPromptParams): string {
  const { workspaceAbs, projectDir } = params;
  const label = params.workspaceLabel || '你的工作区';

  return `## 工作区（基地）

- ${label}: \`${workspaceAbs}\`
- 项目根目录: \`${projectDir}\`
- 文件工具相对路径基于工作区解析（\`./xxx\` 或不带前缀）
- \`../\` 会按普通相对路径解析，不做越权拦截
- 文件工具接受绝对路径；访问项目根或其他目录时应明确写绝对路径
- \`run_command\` 默认在工作区启动，可自行使用 \`cd\` 切换目录

## 唯一写保护：框架控制面

不得通过普通文件工具直接改写 Agent/工具注册表、潮汐任务表、工作流 graph/meta 等控制面数据；工作流自己的 \`workspace/\` 仍可正常写入。需要修改控制面时使用对应专用工具。`;
}
