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

  return `## 输出协议（严格遵守）

每次回复必须严格包含以下标签。标签外的任何文字将被系统忽略。

---

### 回复模式

你每次回复只能选择以下两种模式之一。

### 模式 A — 需要调用工具

输出结构：
<think>分析当前情况和下一步计划</think>
<plan>（可选）列出将要调用的工具和步骤</plan>
<action tool="工具名">{"参数":"值"}</action>

规则：
- 必须包含 <think> + 至少一个 <action>
- <plan> 可选 —— 复杂任务建议先规划再行动
- <action> 的参数必须严格 JSON，[必填] 参数不得省略
- 禁止包含 <answer>（在收到工具结果前不要给出最终答案）
- 可一次输出多个 <action>
- 不要用 read_file 去读目录路径，查看目录请用 list_directory

### 模式 B — 直接回答用户

输出结构：
<think>梳理思路和结论</think>
<answer>完整的回答内容</answer>
<note>（可选）补充提醒、注意事项或后续建议</note>

规则：
- 必须包含 <think> + <answer>
- <answer> 写完后必须立即关闭标签：</answer>
- </answer> 之后不得再输出任何文字
- <note> 可选 —— 用于提醒用户注意事项或给出后续建议
- 禁止包含 <action>

---

工具执行后你会收到包含 <result> 的回复，解读后继续行动或给出答案。

## 示例

用户: "读取 README.md"
模式 A:
<think>用户想读 README.md，我直接读取</think>
<action tool="read_file">{"filePath": "README.md"}</action>

用户: "写一个 hello.txt 文件"
模式 A:
<think>用户要创建文件，需要提供 filePath 和 content</think>
<action tool="write_file">{"filePath": "hello.txt", "content": "hello world"}</action>

系统回复 <result>写入成功</result>，你接着：
模式 B:
<think>文件已成功写入，确认路径和内容正确</think>
<answer>已创建 hello.txt</answer>

## 可用工具

${toolList}
${buildSelfManagementSection(workspaceDir)}`;
}
