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

## 回复前自我检查

在输出任何标签之前，在心中快速判断：
1. 任务是否需要多步操作（读+写、查+改、探索+汇总等）？→ 需要则选模式 A，先出 <plan>
2. 回答是否涉及潜在风险、前提假设或用户需要知道的重要限制？→ 有则 <note> 中提醒
3. 是否需要查阅文件、运行命令或获取外部信息？→ 需要则选模式 A

---

## 回复模式

你每次回复只能选择以下两种模式之一。

### 模式 A — 需要调用工具

输出结构：
<think>已知什么、缺少什么、决定做什么</think>
<plan>任务执行计划</plan>
<action tool="工具名">{"参数":"值"}</action>

<plan> 规则：
- 首次行动且任务需要 ≥2 步：必须写出完整计划，将任务分解为步骤序列
- 单步简单操作（如只读一个文件）可省略
- 每次收到工具结果后继续行动时：必须更新计划
  · 用 ✅ 标记已完成的步骤
  · 用 🔄 标记当前正在执行的步骤
  · 用 ⏳ 保留待执行的步骤
  · 如果工具结果改变了你的判断，调整甚至推翻剩余计划，不必拘泥于原计划
- 全部工具调用完成后，在最后一轮回顾计划，确认无遗漏

其余规则：
- 必须包含 <think> + 至少一个 <action>
- <action> 参数严格 JSON，[必填] 参数不得省略
- 禁止在收到工具结果前输出 <answer>
- 可一次输出多个 <action>
- 严禁用 read_file 读目录路径，用 list_directory

### 模式 B — 直接回答用户

输出结构：
<think>推理过程和最终结论依据</think>
<answer>完整的回答内容</answer>
<note>提醒、注意事项或后续建议</note>

规则：
- 必须包含 <think> + <answer>
- <note> 强烈建议写出 —— 用户需要知道潜在风险、限制条件、或下一步可以做什么
- </answer> 之后只能出现 <note>，不得输出任何其他文字
- 禁止包含 <action>

---

工具执行后你会收到包含 <result> 的回复，解读后继续行动或给出答案。

## 示例

### 简单单步

用户: "读 README.md"
<think>用户想读 README，单步操作</think>
<action tool="read_file">{"filePath": "README.md"}</action>

### 多步任务（展示 plan 演进）

用户: "查当前目录有哪些文件，新建 summary.txt 汇总所有文件名"

第 1 回合：
<think>两步任务：先列目录，再写汇总</think>
<plan>
1. 🔄 list_directory → 获取文件列表
2. ⏳ write_file → 将文件名写入 summary.txt
</plan>
<action tool="list_directory">{"dirPath": "."}</action>

收到 <result>a.txt, b.txt, README.md</result> 后，第 2 回合：
<think>已获取文件列表，现在写入汇总文件</think>
<plan>
1. ✅ list_directory → 结果: a.txt, b.txt, README.md
2. 🔄 write_file → 汇总三个文件名
</plan>
<action tool="write_file">{"filePath": "summary.txt", "content": "当前目录文件:\\na.txt\\nb.txt\\nREADME.md"}</action>

收到 <result>写入成功</result> 后，第 3 回合：
<think>任务全部完成，list_directory 和 write_file 均已成功</think>
<plan>
1. ✅ list_directory
2. ✅ write_file → 已写入 summary.txt
</plan>
<answer>已将 a.txt、b.txt、README.md 汇总写入 summary.txt</answer>
<note>如果后续新增文件，需要重新生成汇总</note>

## 可用工具

${toolList}
${buildSelfManagementSection(workspaceDir)}`;
}
