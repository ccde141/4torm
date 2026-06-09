/**
 * 沙箱 prompt 段落生成器
 *
 * 职责：根据 agent 的 sandboxLevel 生成两段 prompt：
 *   1. 「基地」段 — 工作区绝对路径，相对路径基于此解析
 *   2. 「沙箱」段 — 活动范围说明（strict / relaxed / unrestricted）
 *
 * 三个执行模块（普通对话/信风/对流）的工作区不同，但沙箱级别语义一致：
 *   - strict        仅工作区内
 *   - relaxed       工作区或项目根（默认）
 *   - unrestricted  文件系统任意位置
 */

export type SandboxLevel = 'strict' | 'relaxed' | 'unrestricted';

export interface SandboxPromptParams {
  /** 工作区绝对路径（agent 的「基地」） */
  workspaceAbs: string;
  /** 项目根绝对路径 */
  projectDir: string;
  /** 沙箱级别 */
  sandboxLevel: SandboxLevel;
  /** 工作区语境标签（可选）：例如「你的工作区」「工作流共享工作区」「会话工作区」 */
  workspaceLabel?: string;
}

/**
 * 生成「基地 + 沙箱」组合段落。
 * 直接拼到 system prompt 中。
 */
export function buildSandboxSection(params: SandboxPromptParams): string {
  const { workspaceAbs, projectDir, sandboxLevel } = params;
  const label = params.workspaceLabel || '你的工作区';

  const baseSection = `## 工作区（基地）

- ${label}: \`${workspaceAbs}\`
- 项目根目录: \`${projectDir}\`
- 文件工具相对路径基于工作区解析（\`./xxx\` 或不带前缀）
- \`data/\` 开头的路径会被解析到项目根（如 \`data/skills/...\`）`;

  return `${baseSection}\n\n${buildSandboxRange(sandboxLevel, workspaceAbs, projectDir)}`;
}

function buildSandboxRange(level: SandboxLevel, ws: string, proj: string): string {
  if (level === 'strict') {
    return `## 文件系统访问范围（沙箱级别：strict）

你的活动范围**严格限制**在工作区内：
- 允许路径: \`${ws}\` 及其子目录
- 工具会拒绝任何工作区外的路径，包括 \`../\` 越权和绝对路径
- 即使尝试访问 \`data/\`、\`docs/\` 等项目级目录也会失败
- run_command 在工作区内启动；shell 内 \`cd ..\` 仍可越权（OS 级，工具不控）

如果任务需要访问工作区外的文件，请明确告知用户该 agent 当前为 strict 沙箱，需调整配置后重试。`;
  }

  if (level === 'unrestricted') {
    return `## 文件系统访问范围（沙箱级别：unrestricted）

你拥有**完整文件系统**读写权限：
- 可以使用任意绝对路径，例如 \`C:/Users/...\`、\`/etc/...\`、\`/home/user/...\`
- 可以访问工作区外的任何文件，包括系统目录、其他项目目录
- 不做 \`../\` 越权检查
- read_file / write_file / edit_file / list_directory 都接受绝对路径
- run_command 默认在项目根启动，但可以 \`cd\` 到任意位置

**重要**：你具备这个权限是因为用户主动配置了 unrestricted 级别。当任务涉及工作区外的文件时，**直接使用绝对路径**，不要假设自己只能在工作区活动。`;
  }

  // relaxed (default)
  return `## 文件系统访问范围（沙箱级别：relaxed，默认）

你的活动范围覆盖**工作区**与**项目根**：
- 允许路径 1: \`${ws}\` 及其子目录
- 允许路径 2: \`${proj}\` 及其子目录（包括 \`data/\`、\`docs/\`、\`server/\` 等）
- 工具会拒绝越出项目根的路径（如系统目录、其他磁盘）
- run_command 默认在项目根启动

需要读写项目级文件（registry、配置、文档）时直接传相对路径如 \`data/tools/registry.json\`，无需 \`../../\`。`;
}
