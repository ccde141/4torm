# 技能（Skills）构建与注册参考手册

## 一、概述

Skill 是 Agent 的**领域专长模块**，向 Agent 提供专业提示词和（可选的）专属工具。Skill = `SKILL.md`（提示词注入）+ `tools.json`（专属工具定义，可选）+ `executors/`（工具执行器，可选）。

**生命周期：** 创建 → 写入 `data/skills/{skillId}/` → 分配给 Agent → 运行时 Agent 通过 `use_skill` 工具按需加载 SKILL.md 提示词 + 读取 tools.json 合并工具列表。

---

## 二、SkillMeta 接口

**定义位置:** `src/types/index.ts:63-71`

```typescript
export interface SkillMeta {
  id: string;          // 目录名, 唯一标识 (如 "code-review")
  name: string;        // 显示名称
  description: string; // 功能描述
  category: string;    // 分类 (自由文本)
  version: string;     // 版本号
  author: string;      // 作者
  hasTools: boolean;   // 是否包含 tools.json (服务端动态检测)
}
```

---

## 三、存储布局

```
data/skills/
  {skillId}/                    ← 每 skill 一个目录, 目录名 = skill id
    config.json                 ← SkillMeta (不含 hasTools, 服务端动态检测)
    SKILL.md                    ← 提示词内容 (Markdown, LLM 可见)
    tools.json                  ← (可选) 工具定义数组, 格式同 ToolDef
    executors/                  ← (可选) 工具执行器
      {toolName}.js             ← export default async function(args, ctx) { ... }
```

**实际示例 — code-review：**
```
data/skills/
  code-review/
    config.json    ← { name:"Code Review", description:"...", category:"开发", version:"1.0.0", author:"System" }
    SKILL.md       ← 审查维度 + 输出格式 的提示词 (28 行 Markdown)
```

---

## 四、SKILL.md 提示词内容

`SKILL.md` 是技能的核心——定义 Agent 如何使用该技能的指令。Agent 通过内置 `use_skill` 工具按需加载，Skill 指令以 tool result 形式出现在对话中，用完即过。

**文件格式：** 纯 Markdown，无特定格式约束。推荐包含：
- **角色定义** — "你是 XXX 专家"
- **工作流程** — 分析步骤
- **输出格式** — 期望的输出结构
- **约束规则** — 注意事项

**示例 — code-review/SKILL.md：**
```markdown
# Code Review 技能

你是代码审查专家。接收代码或 PR 描述后，按以下标准审查：

## 审查维度（按严重程度排序）

### Critical（阻断性）
- 安全漏洞（SQL 注入、XSS、硬编码密钥）
...

## 输出格式
每条问题：`[严重程度] 文件:行号 — 问题描述 + 修复建议`

## 最终输出评估报告
1. 总体评分（1-10）
2. 问题数量统计
3. 关键建议摘要
```

---

## 五、创建新技能

### 方式一：UI 创建（推荐）

1. 进入 **Skills 管理页面**（`/skills`）
2. 填写表单：
   - **Skill ID**— 目录名，字母数字
   - **名称 / 分类 / 描述** — 元数据
   - **SKILL.md** — 提示词内容 (textarea)
3. 点击创建 → 调用 `createSkill(id, meta, skillMd)`

**代码路径**（`src/store/skills.ts:26-31`）：
```typescript
async function createSkill(skillId, meta, skillMd) {
  await ensureDir(`skills/${skillId}`);
  await writeJson(`skills/${skillId}/config.json`, meta);
  await writeText(`skills/${skillId}/SKILL.md`, skillMd);
}
```

### 方式二：文件系统直接创建

直接在 `data/skills/` 下创建目录和文件：

```bash
mkdir -p data/skills/my-skill/executors
echo '{"name":"My Skill","description":"...","category":"custom","version":"1.0.0","author":"Me"}' > data/skills/my-skill/config.json
echo '# My Skill\n\n你是...' > data/skills/my-skill/SKILL.md
```

刷新页面或调用 `listSkills()` 即可发现。

---

## 六、技能工具（Skill Tools）

Skill 可通过 `tools.json` 和 `executors/` 目录携带专属工具。

### 6.1 tools.json 格式

与 `tools/registry.json` 中的 `ToolDef` 结构完全一致，但不要求包含 `ToolDef` 接口中 TypeScript 层面的所有字段。重要字段：

```json
[
  {
    "name": "my_skill_tool",
    "description": "专属工具描述",
    "category": "custom",
    "dangerous": false,
    "executorType": "builtin",
    "executorFile": "my_skill_tool",
    "parameters": {
      "type": "object",
      "properties": {
        "param1": { "type": "string", "description": "参数说明" }
      },
      "required": ["param1"]
    }
  }
]
```

### 6.2 执行器文件放置

```
data/skills/{skillId}/executors/{executorFile}.js
```

文件格式与全局工具执行器一致——`export default async function(args, ctx)`。

### 6.3 服务端工具查找顺序（skill 工具 shadowing）

当 Agent 调用工具时，服务端按以下顺序查找：

```
1. findToolInRegistry(tool)           → data/tools/registry.json
2. findToolInSkills(tool)             → 遍历所有 data/skills/*/tools.json
   └── 找到后标记 _skillId = entry.name  → 执行器查找时优先查 skill executors
```

**执行器加载优先级**（`vite.config.ts:388-393`）：
```
1. data/skills/{_skillId}/executors/{fileName}.js   ← skill 自身执行器 (优先)
2. data/tools/executors/{fileName}.js                 ← 全局执行器 (回退)
```

这意味着 Skill 工具可以**覆盖**全局同名执行器：如果 skill 中的 `executorFile` 与全局工具相同，skill 的 `executors/` 版本优先。

### 6.4 与全局工具的区别

| 特性 | 全局工具 (registry.json) | Skill 工具 (tools.json) |
|------|------------------------|------------------------|
| 存储位置 | `data/tools/` | `data/skills/{id}/` |
| 独立存在 | ✅ 是 | ❌ 否（必须属于 skill） |
| 面板可见 | Tools 页面 | Skills 页面（含 🔧 标记） |
| 注册表共享 | 直接注册 | 通过 skill 间接合并 |
| 执行器 shadowing | N/A | 优先查找自身 executors/ |

---

## 七、Agent → Skill 分配

### 数据模型

`AgentConfig` 接口（`src/types/index.ts:74-83`）：
```typescript
{
  skills?: string[];   // Skill ID 列表, 如 ["code-review", "web-search"]
  tools?: string[];    // 工具名列表
}
```

### 配置方式

1. **Agent 配置面板**（`AgentConfigModal.tsx` → "技能" 标签页）：以 toggle 卡片形式展示所有已安装 skill，勾选即关联
2. **保存路径**：写入 `data/agents/{agentId}/.workspace/config.json` 的 `skills` 字段
3. **关联 logic**（`src/store/agent.ts:106`）：`skills: config.skills || []` 保存到 config.json

### 含工具标记

如果 skill 目录下存在 `tools.json`，服务端在 `/api/skills/list` 返回时设置 `hasTools: true`（`vite.config.ts:240`），UI 显示 "🔧 含工具" 徽章。

---

## 八、运行时加载机制

### 8.1 技能提示词加载 — `use_skill` 按需注入

Skill 的提示词通过内置的 `use_skill` 工具按需加载。Agent 被分配 Skill 后不会自动注入 SKILL.md 到系统提示词，而是由 Agent **自行判断何时需要**并主动调用 `use_skill("技能名")`。

**路径提示：** 文件工具（`write_file`/`read_file` 等）支持以 `data/` 开头的路径，Agent 可直接写 `data/skills/baidu-search/SKILL.md` 来创建/编辑公共技能。旧语法 `../../../skills/xxx/` 仍然兼容。

**设计考量：**
- **省 Token** — Skill 指令仅在 Agent 调用时以 `<result>` 形式出现在对话中，`/compact` 后可被压缩，不会永久占用上下文。
- **按需触发** — 与任务无关的 Skill 不会被加载，Agent 自行判断时机。
- **复用机制** — Chat 与 Sandbox 共用同一套 `use_skill` 执行器，Agent 配置中的技能列表同步生效。

**执行器路径：** `data/tools/executors/use_skill.js` — 读取 `data/skills/{name}/SKILL.md` 并返回内容。

**安全检查：** `use_skill` 执行器仅接受纯字母数字的 skillId（`/`、`\`、`..` 均被拦截），防止路径遍历攻击。

**动态描述：** Agent 被分配技能后，`use_skill` 工具的 description 字段会自动更新为「加载技能指令。当前可用技能: code-review, web-search」，Agent 从工具列表中即可获知可加载哪些技能。

> **注意：** 之前设计中 SKILL.md 直接注入系统提示词的方式已被废弃，改为 `use_skill` 工具按需加载。旧设计中 ChatPage 通过 `rolePrompt` 间接注入、Sandbox 通过 `agentRole` 手动编辑的方式不再使用。

### 8.2 技能工具合并

在 Agent 执行前，收集该 Agent 所有 skill 的工具定义并合并到工具列表：

**Chat 模式**（`ChatPage.tsx:277-289`）：
```typescript
const skillIds = agent?.config?.skills || [];
for (const skillId of skillIds) {
  const skillTools = await readSkillToolDefs(skillId);
  for (const st of skillTools) {
    if (!toolDefs.some(t => t.name === st.name)) {
      toolDefs.push(st as ToolDef);  // 按名称去重
    }
  }
}
```

**沙盒模式**（`executor.ts:567-579`）：相同逻辑，但在 `register('agent')` 注册函数中执行。

### 8.3 readSkillToolDefs()

**定义位置:** `src/store/skills.ts:22-24`

```typescript
async function readSkillToolDefs(skillId: string) {
  return readJson(`skills/${skillId}/tools.json`);
}
```

返回值是一个部分 `ToolDef` 数组——缺少 TypeScript `ToolDef` 接口的完整类型约束，但在合并时通过 `st as ToolDef` 强转为 `ToolDef`。

---

## 九、API 参考

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 技能列表 | `GET` | `/api/skills/list` | 扫描 `data/skills/`，返回 `SkillMeta[]` |
| Skill 文件读取 | `GET` | `/api/storage/read?path=skills/{id}/SKILL.md` | 一般存储 API |
| Skill 创建 | — | 调用 `writeJson`+`writeText` | 客户端 store 写入 config.json + SKILL.md |
| Skill 删除 | `DELETE` | `/api/storage/delete?path=skills/{id}` | 递归删除目录 |
| Skill 工具注册检索 | — | 服务端内部 `findToolInSkills()` | 工具执行时自动回退查找 |

### 客户端 store 函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `listSkills()` | `src/store/skills.ts:6` | 调用 `/api/skills/list` 获取所有 skill 元数据 |
| `getSkillMeta(id)` | `src/store/skills.ts:13` | 获取单个 skill 元数据 |
| `readSkillFile(id, file)` | `src/store/skills.ts:18` | 读取 skill 下任意文件 |
| `readSkillToolDefs(id)` | `src/store/skills.ts:22` | 读取 skill 的 tools.json（工具定义） |
| `createSkill(id, meta, md)` | `src/store/skills.ts:26` | 创建新 skill（config.json + SKILL.md） |
| `deleteSkill(id)` | `src/store/skills.ts:33` | 删除整个 skill 目录 |

---

## 十、快速上手示例

### 示例 1：纯提示词 Skill（无工具）

**目标：** 创建一个 SQL 专家 skill，分析 SQL 查询并给出优化建议。

**1. 创建 `data/skills/sql-expert/` 目录结构：**

**config.json：**
```json
{
  "name": "SQL Expert",
  "description": "SQL 查询分析和优化技能 — 分析查询计划、索引策略、重写建议",
  "category": "开发",
  "version": "1.0.0",
  "author": "DBA Team"
}
```

**SKILL.md：**
```markdown
# SQL Expert 技能

你是 SQL 优化专家。收到 SQL 查询后，按以下流程分析：

## 分析步骤
1. 识别查询类型（SELECT / JOIN / SUBQUERY / AGGREGATE）
2. 检查索引使用情况
3. 评估扫描行数
4. 给出重写建议

## 输出格式
\`\`\`
【查询类型】...
【问题】...
【建议】...
【重写后查询】
  SELECT ...
【预估性能提升】...
\`\`\`

## 原则
- 优先减少全表扫描
- 推荐合适的索引策略
- 避免 SELECT * 和 N+1 查询
```

**2. 分配给 Agent：** 在 Agent 配置面板 → 技能标签页 → 勾选 "SQL Expert" → 保存

### 示例 2：含工具 Skill

**目标：** 创建一个 Git 操作 skill，提供 `git_status` 和 `git_diff` 两个工具。

**1. 创建目录结构：**
```
data/skills/
  git-ops/
    config.json
    SKILL.md
    tools.json
    executors/
      git_status.js
      git_diff.js
```

**2. config.json：**
```json
{
  "name": "Git Ops",
  "description": "Git 操作技能 — 查看仓库状态、变更 diff、commit 历史",
  "category": "开发",
  "version": "1.0.0",
  "author": "DevOps"
}
```

**3. tools.json — 定义两个工具：**
```json
[
  {
    "name": "git_status",
    "description": "获取 Git 仓库的工作区状态（变更、暂存、未跟踪文件）",
    "category": "system",
    "dangerous": false,
    "executorType": "builtin",
    "executorFile": "git_status",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "git_diff",
    "description": "获取文件或所有文件的 Git diff",
    "category": "system",
    "dangerous": false,
    "executorType": "builtin",
    "executorFile": "git_diff",
    "parameters": {
      "type": "object",
      "properties": {
        "file": { "type": "string", "description": "可选，指定文件路径" }
      },
      "required": []
    }
  }
]
```

**4. executors/git_status.js：**
```javascript
import { execSync } from 'child_process'

export default async function (args, ctx) {
  const output = execSync('git status --short', {
    encoding: 'utf-8',
    cwd: ctx.workspaceDir,
    timeout: 10000,
  })
  return output || '(工作区干净)'
}
```

**5. executors/git_diff.js：**
```javascript
import { execSync } from 'child_process'

export default async function (args, ctx) {
  const file = args.file || ''
  const cmd = file ? `git diff -- ${file}` : 'git diff'
  const output = execSync(cmd, {
    encoding: 'utf-8',
    cwd: ctx.workspaceDir,
    timeout: 10000,
  })
  return output || '(无变更)'
}
```

**6. SKILL.md：**
```markdown
# Git Ops 技能

你是 Git 操作专家。使用 git_status 和 git_diff 工具查看仓库状态。

## 工作流程
1. 先用 git_status 查看整体状态
2. 根据需要读取具体文件的 diff
3. 总结变更内容
```

**7. 分配给 Agent 后，Agent 运行时：**
- `tools` = [configured_global_tools] + `git_status` + `git_diff`（自动合并去重）
- `git_status` 和 `git_diff` 的工具提示词出现在 `buildSystemPrompt()` 的 "可用工具" 部分
- 执行时服务端先查 `data/tools/executors/`，不存在则回退到 `data/skills/git-ops/executors/`

---

## 十一、架构关系图

```
┌──────────────────────────────────────────────────────────────┐
│                     AGENT                                    │
│  config.tools = ["read_file", "write_file"]                  │
│  config.skills = ["code-review", "git-ops"]                  │
│                                                              │
│  执行前工具合并:                                              │
│    global tools: getToolsByNames(["read_file","write_file"]) │
│    skill tools:  readSkillToolDefs("code-review") (maybe []) │
│                  readSkillToolDefs("git-ops") → [git_status, │
│                                                    git_diff] │
│    → mergedToolDefs = [..., git_status, git_diff]            │
│                                                              │
│  提示词:                                                     │
│    buildSystemPrompt(mergedToolDefs)                         │
│    + rolePrompt / agentRole                                  │
│                                                              │
│  技能加载:                                                   │
│    Agent 调用 use_skill("code-review")                       │
│    → 返回 SKILL.md 内容 → 上下文注入                          │
│                                                              │
│  ReAct 循环:                                                 │
│    <action tool="git_status"> ... </action>                  │
│    → executeTool("git_status", args, agentId)                │
│      → findToolInRegistry("git_status") → 未找到             │
│      → findToolInSkills("git_status") → 在 git-ops 中找到    │
│      → 加载 data/skills/git-ops/executors/git_status.js      │
│      → 执行 → 返回结果                                       │
└──────────────────────────────────────────────────────────────┘
```

---

> 完整架构参见 `docs/tools-reference.md`（工具构建）和 `docs/sandbox-nodes-reference.md`（沙盒 ReAct 循环）。
