import type { ToolDef } from '../store/tools';

function computeRootRelPath(workspaceDir?: string): string {
  if (!workspaceDir) return '../../../../';
  const parts = workspaceDir.replace(/\\/g, '/').replace(/^\.\/?/, '').split('/').filter(Boolean);
  let depth = parts.length;
  if (workspaceDir.endsWith('/')) depth -= 1;
  return '../'.repeat(Math.max(depth, 1));
}

function buildSelfManagementSection(workspaceDir?: string): string {
  const toRoot = computeRootRelPath(workspaceDir);
  return `
## 能力扩展（创建工具与技能）

你有能力为自己创建新工具和新技能。详细参考文档位于项目根目录的 docs/ 下。

### 路径说明
- 你的默认工作区: \`data/agents/{你的AgentID}/.workspace/\`
- 项目根目录相对路径: \`${toRoot}\`（从工作区到项目根）
- **文件工具支持 \`data/xxx\` 前缀路径**：read_file、write_file、edit_file、list_directory 可直接传 \`data/skills/...\`、\`data/tools/...\` 等，系统自动定位到项目根

### 创建新工具（Tool）
详细参考 \`${toRoot}docs/tools-reference.md\`，简要步骤：
1. 用 list_directory 探索项目结构，确认 \`data/tools/\` 目录存在
2. 读取 \`${toRoot}data/tools/registry.json\` 查看已有工具定义（JSON 数组）
3. 创建执行器文件 \`${toRoot}data/tools/executors/{tool名称}.js\`：
   - 格式: \`export default async function(args, ctx) { ... }\`
   - \`args\`: 工具调用参数字典
   - \`ctx\`: { dataDir, workspaceDir, projectDir }
4. 将新工具定义追加到 \`${toRoot}data/tools/registry.json\`（追加到数组末尾）
5. 新工具在下一次 \`<action tool="工具名">\` 调用时自动可用，无需重启

### 创建新技能（Skill）
详细参考 \`${toRoot}docs/skills-reference.md\`，简要步骤：
1. 创建目录 \`${toRoot}data/skills/{技能名称}/\`
2. 创建 \`config.json\`: { "name": "...", "description": "...", "author": "...", "version": "1.0" }
3. 创建 \`SKILL.md\`: 包含技能的系统提示词内容
4. 可选: 创建 \`tools.json\` 定义该技能自带的工具
5. 可选: 创建 \`executors/\` 目录放置工具执行器文件
6. 新技能自动被系统发现，无需重启

### 重要提示
- 创建 executor 文件前先读取一个已有的执行器（如 \`${toRoot}data/tools/executors/read_file.js\`）作为模板
- registry.json 是 JSON 数组格式，添加工具定义时注意 JSON 语法正确
- 如果你不确定路径，先用 list_directory 逐层探索目录结构
- 创建完成后可读取 registry.json 确认添加成功`;
}

export function buildSystemPrompt(tools: ToolDef[], workspaceDir?: string): string {
  const toolList = tools.map(t => {
    const requiredSet = new Set<string>(
      Array.isArray((t.parameters as any)?.required) ? (t.parameters as any).required as string[] : [],
    );
    const props = (t.parameters as { properties?: Record<string, { type: string; description: string }> }).properties || {};
    const params = typeof t.parameters === 'object' && t.parameters
      ? Object.entries(props)
          .map(([k, v]) => {
            const mark = requiredSet.has(k) ? ' [必填]' : ' [可选]';
            return `    ${k}: ${v.type}${mark} — ${v.description}`;
          })
          .join('\n')
      : '    无参数';
    return `### ${t.name}
  描述: ${t.description}
  参数:
${params}`;
  }).join('\n\n');

  return `## 输出模板

你的回复应该使用以下标签结构。标签外的自然语言会被忽略，请确保内容在标签内。

<think>在这里输出你的思考过程</think>

<plan>
[ ] 第一步
[ ] 第二步
</plan>

如需调用工具：
<action tool="工具名">{"参数":"值"}</action>
注意：所有标记为 [必填] 的参数都必须在 JSON 中提供，不能省略。

工具执行后你会收到包含 <result> 的回复，解读后继续行动或给出答案。

最终回答：
<answer>你的完整回答</answer>

补充说明（可选）：
<note>提醒或建议</note>

## 规则
- 每次回复必须先以 <think> 标签输出你的思考过程，分析用户意图并梳理思路，然后再输出其他内容
- 每次回复必须同时包含 <think> 和 <answer>，如需调用工具则使用 <action>
- 可在一条消息中包含多个 <action>
- <result> 标签由系统注入，你不需要输出
- 读取文件用 read_file，查看目录内容用 list_directory，不要用 read_file 去读目录路径
- 调用工具前确认所有 [必填] 参数都已包含，否则会执行失败

## 示例

用户: "读取 README.md"
你的回复:
<think>用户想读 README.md，我直接读取</think>
<action tool="read_file">{"filePath": "README.md"}</action>

用户: "写一个 hello.txt 文件"
你的回复:
<think>用户要创建文件，需要提供 filePath 和 content</think>
<action tool="write_file">{"filePath": "hello.txt", "content": "hello world"}</action>

系统回复 <result>写入成功</result>，你接着：
<answer>已创建 hello.txt</answer>

## 可用工具

${toolList}
${buildSelfManagementSection(workspaceDir)}

## 规则提醒
- 每次回复必须先以 <think> 输出思考过程，然后再输出其他内容
- 每次回复必须同时包含 <think> 和 <answer>，缺少时系统会要求你重新回复
`;
}
