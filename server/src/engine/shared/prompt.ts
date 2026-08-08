import { buildTextToolProtocol } from './text-tool-prompt.js';

export interface ToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface SelfManagementOptions {
  allowToolRegistration?: boolean;
  native?: boolean;
}

export { buildTextToolProtocol } from './text-tool-prompt.js';

function buildRegistrationStep(options: SelfManagementOptions): string {
  if (!options.allowToolRegistration) {
    return '4. 当前入口不提供独立全局工具注册；可以完成执行器和定义草稿，交由季风会话或气旋工位私聊注册';
  }
  if (options.native) {
    return `4. 判断执行生命周期：默认选 \`sync\`；只有耗时、可安全中止、响应 \`ctx.signal\` 且允许稍后取结果的执行器才选 \`detachable\`
5. 调用 \`register_tool\` 提交工具名称、描述、危险性、executionMode、执行器文件名和参数 JSON Schema
6. 系统校验通过后会向人类显示「注册 / 取消」，确认前不会修改全局注册表`;
  }
  return `4. 判断执行生命周期：默认选 \`sync\`；只有耗时、可安全中止、响应 \`ctx.signal\` 且允许稍后取结果的执行器才选 \`detachable\`
5. 调用 \`register_tool\` 提交工具定义，例如：
\`{"type":"tool_call","name":"register_tool","arguments":{"name":"my_tool","description":"用途","dangerous":"false","executionMode":"sync","executorFile":"my_tool","parameters":"{\\"type\\":\\"object\\",\\"properties\\":{}}"}}\`
6. 系统校验通过后会向人类显示「注册 / 取消」，确认前不会修改全局注册表`;
}

export function buildSelfManagementSection(options: SelfManagementOptions = {}): string {
  return `
## 能力扩展（工具 / 技能 / MCP）

你可以查看框架内已注册的能力，也能为自己创建新工具和新技能。详细指南在 \`docs/extend/\` 下。

### 查看当前已注册的能力
- 框架工具：固定清单在 \`server/src/tools/framework/catalog.json\`，只读且不能被用户数据覆盖
- 自定义工具：定义在 \`data/tools/registry.json\`；执行器在 \`data/tools/executors/*.js\`
- 技能：用 list_directory 列 \`data/skills/\`；各技能正文在 \`data/skills/{名称}/SKILL.md\`
- MCP：读 \`data/mcp/servers.json\`；其工具以 \`mcp:服务名:工具名\` 注入，用 \`mcp:服务名:*\` 通配引用

### 创建新工具（Tool）
详细参考 \`docs/extend/tools.md\`，简要步骤：
1. 用 list_directory 探索项目结构，确认 \`data/tools/\` 目录存在
2. 读取 \`data/tools/registry.json\` 查看已有自定义工具定义（JSON 数组）
3. 创建执行器文件 \`data/tools/executors/{tool名称}.js\`：
   - 格式: \`export default async function(args, ctx) { ... }\`
   - \`args\`: 工具调用参数字典
   - \`ctx\`: { dataDir, workspaceDir, projectDir, sandboxLevel }
   - 若选择 \`detachable\`，执行器必须监听 \`ctx.signal\`，并通过 \`ctx.onOutput?.('stdout'|'stderr', text)\` 报告过程；不满足时必须选择 \`sync\`
${buildRegistrationStep(options)}

### 创建新技能（Skill）
详细参考 \`docs/extend/skills.md\`，简要步骤：
1. 创建目录 \`data/skills/{技能名称}/\`
2. 创建 \`config.json\` + \`SKILL.md\`
3. 可选: \`tools.json\` + \`executors/\` 目录
4. 新技能自动被系统发现，无需重启

### 接入 MCP 外部服务
详细参考 \`docs/extend/mcp.md\`。在 \`data/mcp/servers.json\` 追加一项（name/command/args/env），连上后其工具以 \`mcp:服务名:*\` 提供。

### 重要提示
- 创建 executor 文件前先读取一个已有的执行器（如 \`data/tools/executors/read_file.js\`）作为模板
- 只能新建尚不存在的 executor 草稿；普通文件工具不能覆盖或删除已有工具与技能执行器
- 相对路径统一基于工作区；访问项目目录时使用明确的绝对路径
- Agent/工具注册表、已有执行器、潮汐任务表、工作流 graph/meta 属于控制面，不能用普通文件工具直接写`;
}

export function buildSystemPrompt(tools: ToolDef[], options: SelfManagementOptions = {}): string {
  return `${buildTextToolProtocol(tools)}\n${buildSelfManagementSection(options)}`;
}
