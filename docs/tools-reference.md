# 工具（Tools）构建与注册参考手册

## 一、概述

工具是 Agent 与外部世界交互的能力单元。一个 Tool 由 **元数据定义**（`ToolDef`）和 **执行器**（`executor.js`）两部分组成。Agent 通过 ReAct 循环中的 `<action tool="...">` 标签调用工具，系统在服务端解析执行器并返回 `<result>`。

**生命周期：** 定义 → 注册到 `tools/registry.json` → 分配给 Agent → 使用时 `buildSystemPrompt()` 注入提示词 → ReAct 解析调用 → 服务端执行。

---

## 二、ToolDef 接口

**定义位置:** `src/store/tools.ts:3-12`

```typescript
export interface ToolDef {
  name: string;                           // 唯一标识，LLM 在 <action tool="name"> 中引用
  description: string;                    // LLM 可见的工具描述
  category: 'io' | 'system' | 'custom';   // 分类（仅 UI 展示用）
  dangerous: boolean;                     // 危险工具需权限确认（write/edit/run）
  parameters: Record<string, unknown>;    // JSON Schema 对象, 含 type/properties/required
  executorType: 'builtin' | 'template' | 'custom';  // 执行方式
  executorFile?: string;                  // 执行器文件名（不含 .js）, builtin/custom 必填
  executorTemplate?: string;              // Shell 模板（template 类型用）, 支持 {{param}} 占位
}
```

### parameters 字段标准格式（JSON Schema Object）

```json
{
  "type": "object",
  "properties": {
    "filePath": { "type": "string", "description": "文件路径" },
    "content":  { "type": "string", "description": "文件内容" }
  },
  "required": ["filePath", "content"]
}
```

**必填/可选标注：** `buildSystemPrompt()` 会从 `parameters.required` 数组自动提取并标注 `[必填]` / `[可选]`。

---

## 三、存储布局

```
data/
  tools/
    registry.json          ← [ToolDef, ToolDef, ...] — 所有工具的定义注册表
    executors/
      read_file.js         ← export default async function(args, ctx) { ... }
      write_file.js
      edit_file.js
      list_directory.js
      run_command.js
      webfetch.js
      use_skill.js       ← 按需加载 Skill 提示词
    permissions.json       ← { [agentId]: { [toolName]: "always" | "ask" } }
```

---

## 四、内置工具（BUILTIN_TOOLS）

**定义位置:** `src/store/tools.ts:82-119`

| 名称 | 分类 | 危险 | 执行器 | 说明 |
|------|------|------|--------|------|
| `read_file` | io | ❌ | read_file.js | 读取文件全文 |
| `write_file` | io | ✅ | write_file.js | 创建或覆盖文件 |
| `edit_file` | io | ✅ | edit_file.js | 精确替换文本 |
| `list_directory` | io | ❌ | list_directory.js | 列出目录内容 |
| `run_command` | system | ✅ | run_command.js | 执行 shell 命令（cwd = 项目根，自动 `chcp 65001` UTF-8） |
| `webfetch` | system | ❌ | webfetch.js | HTTP GET 获取文本 |
| `use_skill` | system | ❌ | use_skill.js | 按需加载指定 Skill 的专业提示词 |

**种子机制：** 启动时 `seedTools()` 自动将 `BUILTIN_TOOLS` 中未被注册的工具补充到 `registry.json`（`src/store/tools.ts:62-75`）。

---

## 五、创建新工具

### 方式一：UI 创建（推荐）

1. 进入 **Tools 管理页面**（`/tools`）
2. 填写表单（`ToolDefForm` 接口）：
   - **名称** (`name`) — 工具唯一标识，如 `my_tool`
   - **描述** (`description`) — LLM 看到的功能说明
   - **分类** (`category`) — io / system / custom
   - **危险** — 是否需要权限确认
   - **参数 JSON** (`parametersJson`) — 标准 JSON Schema
   - **执行器类型** (`executorType`) — builtin / template / custom
   - **执行器文件** — builtin/custom 必填
   - **Shell 模板** — template 类型用，`{{param}}` 占位
3. 保存 → 工具写入 `tools/registry.json`

### 方式二：直接编码（注册 BUILTIN_TOOLS）

在 `src/store/tools.ts` 的 `BUILTIN_TOOLS` 数组中添加条目：
```typescript
{
  name: 'my_tool',
  description: '我的自定义工具',
  category: 'custom', dangerous: false, executorType: 'builtin',
  executorFile: 'my_tool',
  parameters: {
    type: 'object',
    properties: { param1: { type: 'string', description: '参数1' } },
    required: ['param1'],
  },
}
```
然后在 `data/tools/executors/` 下创建 `my_tool.js`。

### 方式三：直接写入 registry.json

在 `data/tools/registry.json` 中追加 `ToolDef` 对象。下次启动不会被清理（`seedTools` 只追加不删除）。

---

## 六、执行器类型详解

### 6.1 builtin（内置）

执行器文件位于 `data/tools/executors/{executorFile}.js`。

**文件格式 — `export default async function(args, ctx)`:**
```javascript
// data/tools/executors/my_tool.js
import { readFileSync } from 'fs'
import { resolve } from 'path'

// 推荐模式：支持 data/ 前缀和相对路径两种写法
function resolvePath(fp, workspaceDir, projectDir) {
  if (fp.replace(/\\/g, '/').startsWith('data/')) {
    return resolve(projectDir, fp)
  }
  return resolve(workspaceDir, fp)
}

export default async function (args, ctx) {
  // args: Record<string, string> — 工具调用时传入的参数字典
  // ctx:  { dataDir: string, workspaceDir: string, projectDir: string }
  const fp = args.filePath || args.file_path
  const resolved = resolvePath(fp, ctx.workspaceDir, ctx.projectDir)
  return readFileSync(resolved, 'utf-8')
}
```

**服务端加载流程**（`vite.config.ts:386-413`）：
1. 工具来自 skill 且有 `_skillId` → 先查 `data/skills/{skillId}/executors/{file}.js`
2. 回退到 `data/tools/executors/{file}.js`
3. 动态 `import()` 加载 → 调用 `mod.default(args, ctx)` → 返回结果字符串

### 6.2 template（模板执行）

通过 shell 模板字符串 + `{{param}}` 占位符替换实现。

**定义示例：**
```json
{
  "name": "curl_fetch",
  "executorType": "template",
  "executorTemplate": "curl -s {{url}} | head -100"
}
```

**执行流程**（`vite.config.ts:373-383`）：
1. 遍历 `args`，将模板中所有 `{{key}}` 替换为实际值
2. `execSync(cmd, { cwd: workspaceDir, timeout: 30000 })` 执行
3. 返回 stdout 或 stderr

### 6.3 custom（自定义）

与 `builtin` 完全相同的执行器加载机制，仅在语义上区分来源。

---

## 七、执行器上下文 (ctx)

执行器函数第二个参数 `ctx` 的结构：

```typescript
{
  dataDir: string;       // 指向 data/ 目录
  workspaceDir: string;  // Agent 的工作区目录（agents/{id}/.workspace）
  projectDir: string;    // 项目根目录
}
```

**路径解析规则（v2.1+）：**

| 工具 | cwd / 基准路径 | 说明 |
|------|--------------|------|
| `read_file` | `workspaceDir`（默认）或 `projectDir`（路径以 `data/` 开头时） | 支持 `data/skills/xxx` 和 `../../../skills/xxx` 两种写法 |
| `write_file` | 同上 | 同上 |
| `edit_file` | 同上 | 同上 |
| `list_directory` | 同上 | 同上 |
| `run_command` | `projectDir`（项目根） | 可直接传 `python data/skills/xxx/scripts/xxx.py` |
| `webfetch` | N/A | 不涉及文件系统 |
| `use_skill` | `dataDir` | 仅接受纯字母数字的技能名 |

**工作区解析**（`vite.config.ts`）：
- 先查 `agents/registry.json` 中该 Agent 的 `config.workspace` 配置
- 未配置则使用默认 `data/agents/{agentId}/.workspace`
- `projectDir` 固定为项目根目录

---

## 八、Agent → 工具分配

### 数据模型

`AgentConfig` 接口（`src/types/index.ts:74-83`）：
```typescript
{
  tools?: string[];    // 工具名列表, 如 ["read_file", "write_file"]
  skills?: string[];   // 技能 ID 列表
  // ...
}
```

### 配置方式

1. **Agent 配置面板**（`AgentConfigModal.tsx` → "提示词" 标签页）：以 toggle 按钮形式展示所有已注册工具，勾选即关联
2. **保存路径**：写入 `data/agents/{agentId}/.workspace/config.json` 的 `tools` 字段
3. **关联 logic**（`src/store/agent.ts:103-105`）：`tools: config.tools || []` 保存到 config.json

### 运行时工具解析

**Chat 模式**（`ChatPage.tsx:273-289`）：
```typescript
const toolDefs = config.tools?.length ? await getToolsByNames(config.tools) : [];

// 合并 skill 工具（去重）
for (const skillId of config.skills) {
  const skillTools = await readSkillToolDefs(skillId);
  for (const st of skillTools) {
    if (!toolDefs.some(t => t.name === st.name)) {
      toolDefs.push(st as ToolDef);
    }
  }
}
```

**沙盒模式**（`executor.ts:563-579`）：相同逻辑。

---

## 九、工具权限系统

**定义位置:** `src/api/tools-permissions.ts`, 服务端路由 `vite.config.ts:276-303`

### 权限等级

| 等级 | 行为 |
|------|------|
| `always` | 自动允许，不弹窗 |
| `ask` | 每次调用前弹出确认对话框 |
| `never` | 跳过不执行 |

### 存储

`data/tools/permissions.json` — `{ [agentId]: { [toolName]: "always" | "ask" } }`

### API

| 操作 | 方法 | 路径 |
|------|------|------|
| 读取 | `GET` | `/api/tools/permissions?agentId=xxx` |
| 写入 | `PUT` | `/api/tools/permissions?agentId=xxx` |

### 危险工具列表

**定义位置:** `src/api/tools-executor.ts:17`
```typescript
export const DANGEROUS_TOOLS = ['write_file', 'edit_file', 'run_command'];
```

> 注意：沙盒自动化执行时危险工具检查被**跳过**（全自动允许）。

---

## 十、工具执行完整流程

```
Agent 执行
  │
  ├── 1. 工具解析 ── getToolsByNames(config.tools) + readSkillToolDefs(skillId) → toolDefs[]
  │
  ├── 2. 提示词注入 ── buildSystemPrompt(toolDefs) → 系统提示词（含工具列表+输出模板）
  │
  ├── 3. LLM 调用 ── POST /chat/completions（通过 LLM Proxy）
  │
  ├── 4. 输出解析 ── parseStructuredOutput(content, toolDefs)
  │     ├── <answer> → 最终答案, 跳出循环
  │     ├── <action tool="x"> → 提取工具名和参数
  │     ├── 📋tool_name({...}) 旧格式兼容（历史会话泄漏兜底）
  │     └── 无 action 无 answer → 注入 hint + formatFailures 计数（>=3 则 break）
  │
  ├── 5. 工具调用 ── executeTool(toolName, args, agentId)
  │     │
  │     └── 服务端:
  │           ├── findToolInRegistry(tool) → 全局工具注册表
  │           ├── findToolInSkills(tool)   → 所有 skills/*/tools.json 回退查找
  │           ├── workspaceDir 解析
  │           └── 按 executorType 派发:
  │                 ├── template → {{param}} 替换 → execSync()
  │                 └── builtin/custom → import(executorFile) → fn(args, ctx)
  │
  └── 6. 结果注入 ── <result>...</result> 注入对话 → 回到步骤 3
```

### 相关代码位置

| 环节 | 文件 | 行号 |
|------|------|------|
| 工具解析 | `ChatPage.tsx` | 273-289 |
| 沙盒工具解析 | `executor.ts` | 563-579 |
| 系统提示词 | `src/engine/prompt.ts` | 3-72 |
| 结构化解析 | `src/engine/parser.ts` | 12-48 |
| 客户端执行调用 | `src/api/tools-executor.ts` | 3-15 |
| 服务端执行路由 | `vite.config.ts` | 255-416 |
| 注册表查找 | `vite.config.ts` | 334-339 |
| Skill 备选查找 | `vite.config.ts` | 341-359 |
| 模板执行 | `vite.config.ts` | 373-383 |
| 执行器加载 | `vite.config.ts` | 386-413 |

---

## 十一、prompt 集成细节

### buildSystemPrompt() 输出模板

`src/engine/prompt.ts:3-72` — 为 LLM 生成如下结构的系统提示词：

```
## 输出模板

<think>分析...、梳理...，不做冗余寒暄</think>
<plan>
[ ] 第一步
[ ] 第二步
</plan>
<action tool="工具名">{"参数":"值"}</action>
<answer>你的完整回答</answer>
<note>提醒或建议</note>

## 规则
- 每次回复必须包含 <action> 或 <answer>, 至少其一
- 可在一条消息中包含多个 <action>
- <result> 标签由系统注入, 你不需要输出
- 读取文件用 read_file, 查看目录内容用 list_directory
- 调用工具前确认所有 [必填] 参数都已包含

## 可用工具

### {tool.name}
  描述: {tool.description}
  参数:
    {key}: {type} [必填]/[可选] — {description}

## 示例
...
```

---

## 十二、API 参考

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 工具列表 | `GET` | `/api/storage/read?path=tools/registry.json` | 读取全部工具定义 |
| 工具保存 | `PUT` | `/api/storage/write?path=tools/registry.json` | 写入注册表 |
| 工具执行 | `POST` | `/api/tools/exec` | `{ tool, args, agentId }` |
| 权限读取 | `GET` | `/api/tools/permissions?agentId=xxx` | 读取 Agent 工具权限 |
| 权限写入 | `PUT` | `/api/tools/permissions?agentId=xxx` | 保存 Agent 工具权限 |

### 客户端 store 函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `getTools()` | `src/store/tools.ts:53` | 读取全部工具 |
| `getToolsByNames(names)` | `src/store/tools.ts:77` | 按名称获取工具组 |
| `saveTools(tools)` | `src/store/tools.ts:58` | 保存全部工具 |
| `seedTools()` | `src/store/tools.ts:62` | 补充内置工具到注册表 |
| `buildToolsPrompt(tools)` | `src/store/tools.ts:33` | 生成人类可读的工具列表 |

---

## 十三、快速上手示例

### 示例 1：用模板创建系统 info 工具

**1. 在 `data/tools/registry.json` 添加定义：**
```json
{
  "name": "system_info",
  "description": "获取系统信息（操作系统、架构等）",
  "category": "system",
  "dangerous": false,
  "executorType": "template",
  "executorTemplate": "echo 操作系统: $(uname -s) && echo 架构: $(uname -m) && echo 主机名: $(hostname)",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
```

### 示例 2：用 builtin 创建文件追加工具

**1. 在 `data/tools/registry.json` 添加定义：**
```json
{
  "name": "append_file",
  "description": "向文件末尾追加内容",
  "category": "io",
  "dangerous": true,
  "executorType": "builtin",
  "executorFile": "append_file",
  "parameters": {
    "type": "object",
    "properties": {
      "filePath": { "type": "string", "description": "文件路径" },
      "content": { "type": "string", "description": "要追加的内容" }
    },
    "required": ["filePath", "content"]
  }
}
```

**2. 创建 `data/tools/executors/append_file.js`：**
```javascript
import { appendFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

export default async function (args, ctx) {
  const fp = args.filePath
  const content = args.content || ''
  if (!fp) throw new Error('缺少 filePath 参数')
  const resolved = resolve(ctx.workspaceDir, fp)
  mkdirSync(dirname(resolved), { recursive: true })
  appendFileSync(resolved, content, 'utf-8')
  return `追加成功: ${fp} (${content.length} 字符)`
}
```

### 示例 3：将工具分配给 Agent

1. 进入 Agent 配置面板 → **提示词** 标签页
2. 勾选目标工具名称
3. 保存 — 写入 `data/agents/{agentId}/.workspace/config.json`

---

> 完整架构参见 `docs/sandbox-nodes-reference.md` 的 ReAct 循环部分和 `docs/skills-reference.md`。
