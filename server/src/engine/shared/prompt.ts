import { buildTextToolProtocol } from './text-tool-prompt.js';
import { buildFrameworkNavigationSection } from './framework-navigation.js';

export interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface SelfManagementOptions {
  allowToolRegistration?: boolean;
  native?: boolean;
  includeNavigation?: boolean;
}

export { buildTextToolProtocol } from './text-tool-prompt.js';

function buildRegistrationStep(options: SelfManagementOptions): string {
  if (!options.allowToolRegistration) {
    return '当前入口不提供全局工具注册；可以准备执行器和定义草稿，交由季风会话或气旋工位私聊注册。';
  }
  return `选择 \`executionMode\` 时默认使用 \`sync\`；只有耗时、可安全中止并监听 \`ctx.signal\` 的执行器才使用 \`detachable\`。完成执行器和定义后，按本轮工具协议调用 \`register_tool\`；系统校验通过后交由人类确认。`;
}

export function buildSelfManagementSection(options: SelfManagementOptions = {}): string {
  const navigation = options.includeNavigation === false ? '' : buildFrameworkNavigationSection();
  const extension = `## 能力扩展（工具 / 技能 / MCP）

现有能力不足时，先按框架导航读取对应指南并检查已注册内容，避免重复创建。详细协议不常驻上下文，以当前文档和工具定义为准。

### 创建新工具（Tool）
先读取 \`docs/extend/tools.md\`，再检查框架工具清单和自定义注册表，确认不存在同类能力。新执行器放在 \`data/tools/executors/{工具名称}.js\`，不要直接写注册表。
${buildRegistrationStep(options)}

### 创建新技能（Skill）
先读取 \`docs/extend/skills.md\` 并参考一个现有技能。新技能放在 \`data/skills/{技能名称}/\`，至少包含 \`config.json\` 和 \`SKILL.md\`；系统会自动发现，但已有 Agent 仍需由人类启用。

### 接入 MCP 外部服务
详细参考 \`docs/extend/mcp.md\`。\`data/mcp/servers.json\` 用于查看当前配置；新增或修改服务由人类在 MCP 管理页面完成。可以准备配置草稿，但不要直接改写该控制面文件。连接后，工具以 \`mcp:服务名:*\` 提供。

### 重要提示
- 只能新建尚不存在的 executor 草稿；普通文件工具不能覆盖或删除已有工具与技能执行器
- 相对路径统一基于工作区；访问项目目录时使用明确的绝对路径
- Agent/工具注册表、已有执行器、MCP 配置、潮汐任务表和工作流定义属于控制面，不能用普通文件工具直接写`;
  return [navigation, extension].filter(Boolean).join('\n\n');
}

export function buildSystemPrompt(tools: ToolDef[], options: SelfManagementOptions = {}): string {
  return `${buildTextToolProtocol(tools)}\n${buildSelfManagementSection(options)}`;
}
