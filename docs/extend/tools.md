# 工具制作

工具是 Agent 与外部世界交互的能力单元。一个 Tool 由 **元数据定义**(`ToolDef`)和 **执行器**(`{name}.js`)两部分组成。Agent 通过 ReAct 循环中的 `<action tool="...">` 标签调用工具,服务端解析执行器并返回 `<result>`。

> **代码坐标说明**:执行逻辑现位于服务端 `server/`(Fastify),早期版本散在 `vite.config.ts` 的内容已迁移。本文引用当前文件路径,不锁定行号(行号易随改动失效)。

**生命周期:** 定义 → 注册到 `data/tools/registry.json` → 分配给 Agent → 使用时由服务端 `buildSystemPrompt()` 注入提示词 → ReAct 解析调用 → 服务端执行。

## ToolDef 接口

类型定义(客户端):`src/store/tools.ts`

```typescript
export interface ToolDef {
  name: string;                           // 唯一标识,LLM 在 <action tool="name"> 中引用
  description: string;                    // LLM 可见的工具描述
  category: 'io' | 'system' | 'custom';   // 分类(仅 UI 展示用)
  dangerous: boolean;                     // 危险工具需权限确认(write/edit/run)
  parameters: Record<string, unknown>;    // JSON Schema 对象, 含 type/properties/required
  executorType: 'builtin' | 'template' | 'custom';  // 执行方式
  executorFile?: string;                  // 执行器文件名(不含 .js), builtin/custom 必填
  executorTemplate?: string;              // Shell 模板(template 类型用), 支持 {{param}} 占位
}
```

### parameters 字段标准格式(JSON Schema Object)

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

`buildSystemPrompt()` 会从 `parameters.required` 数组自动提取并标注 `[必填]` / `[可选]`。

## 存储布局

```
data/
  tools/
    registry.json          ← [ToolDef, ...] — 所有工具的定义注册表
    executors/
      read_file.js         ← export default async function(args, ctx) { ... }
      write_file.js
      edit_file.js
      list_directory.js
      run_command.js
      webfetch.js
      use_skill.js         ← 按需加载 Skill 提示词
    permissions.json       ← { [agentId]: { [toolName]: "always" | "ask" } }
```

## 内置工具

种子定义在 `src/store/tools.ts` 的 `BUILTIN_TOOLS`;启动时由 `seedTools()` 把未注册的补进 `registry.json`(只追加不删除)。

| 名称 | 分类 | 危险 | 说明 |
|------|------|------|------|
| `read_file` | io | ❌ | 读取文件全文 |
| `write_file` | io | ✅ | 创建或覆盖文件 |
| `edit_file` | io | ✅ | 精确替换文本 |
| `list_directory` | io | ❌ | 列出目录内容 |
| `run_command` | system | ✅ | 执行 shell 命令(cwd = 项目根,自动 `chcp 65001` UTF-8) |
| `webfetch` | system | ❌ | HTTP GET 获取文本 |
| `use_skill` | system | ❌ | 按需加载指定 Skill 的专业提示词 |
| `delete_file` | io | ✅ | 删除文件或目录(沙箱校验,目录默认递归) |
| `search_content` | io | ❌ | 递归搜索文本/正则,返回文件:行号,支持文件名过滤 |

## 创建新工具

### 方式一:UI 创建(推荐)

1. 进入 **Tools 管理页面**(`/tools`)
2. 填写表单:名称 / 描述 / 分类 / 危险 / 参数 JSON(JSON Schema)/ 执行器类型 / 执行器文件(或 Shell 模板)
3. 保存 → 工具写入 `data/tools/registry.json`

### 方式二:注册 BUILTIN_TOOLS

在 `src/store/tools.ts` 的 `BUILTIN_TOOLS` 数组中添加条目,再在 `data/tools/executors/` 下创建同名 `.js`。

### 方式三:直接写入 registry.json

在 `data/tools/registry.json` 追加 `ToolDef` 对象。下次启动不会被清理(`seedTools` 只追加不删除)。

## 执行器类型

### builtin(内置)

执行器文件位于 `data/tools/executors/{executorFile}.js`,签名 `export default async function(args, ctx)`:

```javascript
// data/tools/executors/my_tool.js
import { readFileSync } from 'fs'
import { resolve } from 'path'

// 推荐模式:支持 data/ 前缀和相对路径两种写法
function resolvePath(fp, workspaceDir, projectDir) {
  if (fp.replace(/\\/g, '/').startsWith('data/')) {
    return resolve(projectDir, fp)
  }
  return resolve(workspaceDir, fp)
}

export default async function (args, ctx) {
  // args: Record<string, string> — 工具调用时传入的参数字典
  // ctx:  { dataDir, workspaceDir, projectDir }
  const fp = args.filePath || args.file_path
  return readFileSync(resolvePath(fp, ctx.workspaceDir, ctx.projectDir), 'utf-8')
}
```

**服务端加载流程**(`server/src/services/tool-executor.ts`):

1. 工具来自 skill 且有 `_skillId` → 先查 `data/skills/{skillId}/executors/{file}.js`
2. 回退到 `data/tools/executors/{file}.js`
3. 动态 `import()` 加载 → 调用 `mod.default(args, ctx)` → 返回结果字符串

### template(模板执行)

通过 shell 模板字符串 + `{{param}}` 占位符替换实现:

```json
{
  "name": "curl_fetch",
  "executorType": "template",
  "executorTemplate": "curl -s {{url}} | head -100"
}
```

执行流程(`server/src/services/tool-executor.ts`):遍历 `args` 把 `{{key}}` 替换为实际值 → `execSync(cmd, { cwd, timeout })` → 返回 stdout / stderr。

### custom(自定义)

与 `builtin` 完全相同的执行器加载机制,仅在语义上区分来源。

## 执行器上下文 ctx

```typescript
{
  dataDir: string;       // 指向 data/ 目录
  workspaceDir: string;  // Agent 的工作区目录(agents/{id}/.workspace)
  projectDir: string;    // 项目根目录
}
```

**路径解析规则:**

| 工具 | 基准路径 | 说明 |
|------|----------|------|
| `read_file` / `write_file` / `edit_file` / `list_directory` | `workspaceDir`(默认)或 `projectDir`(路径以 `data/` 开头时) | 支持 `data/skills/xxx` 和 `../../../skills/xxx` 两种写法 |
| `run_command` | `projectDir`(项目根) | 可直接传 `python data/skills/xxx/scripts/xxx.py` |
| `webfetch` | N/A | 不涉及文件系统 |
| `use_skill` | `dataDir` | 仅接受纯字母数字的技能名 |

## Agent → 工具分配

`AgentConfig`(`src/types/index.ts`)的 `tools?: string[]` 字段保存工具名列表。

1. **Agent 配置面板**(`AgentConfigModal.tsx`):以 toggle 按钮展示所有已注册工具,勾选即关联
2. **保存路径**:`data/agents/{agentId}/.workspace/config.json` 的 `tools` 字段

### 运行时工具解析

服务端在 Agent 执行前由 `loadAgentToolDefs()`(`server/src/engine/shared/tool-defs-loader.ts`)装配工具集:读 `registry.json` 命中配置的工具,再合并该 Agent 各 skill 的 `tools.json`(按名称去重),并注入 MCP 工具。所有协作模式共用这一套装配逻辑。

## 工具权限系统

| 等级 | 行为 |
|------|------|
| `always` | 自动允许,不弹窗 |
| `ask` | 每次调用前弹出确认对话框 |
| `never` | 跳过不执行 |

- 存储:`data/tools/permissions.json` — `{ [agentId]: { [toolName]: "always" | "ask" } }`
- 危险工具列表 `DANGEROUS_TOOLS = ['write_file', 'edit_file', 'run_command']`(`src/api/tools-executor.ts`)
- 自动化(潮汐 / 沙盒)执行时危险工具检查被**跳过**(全自动允许)

## 工具执行完整流程

```
Agent 执行
  │
  ├── 1. 工具装配 ── loadAgentToolDefs() → registry 工具 + skill 工具 + MCP 工具
  │
  ├── 2. 提示词注入 ── buildSystemPrompt(toolDefs) → 系统提示词(工具列表 + 输出模板)
  │
  ├── 3. LLM 调用 ── 经 LLM 桥接层(/api/llm)
  │
  ├── 4. 输出解析 ── 解析 <action> / <answer>;无 action 无 answer → 注入 hint 计数(≥3 则 break)
  │
  ├── 5. 工具调用 ── executeTool(toolName, args, agentId)(server/src/services/tool-executor.ts)
  │     ├── findToolInRegistry(tool) → data/tools/registry.json
  │     ├── findToolInSkills(tool)   → data/skills/*/tools.json 回退查找
  │     ├── workspaceDir 解析
  │     └── 按 executorType 派发:template → execSync;builtin/custom → import(executorFile)
  │
  └── 6. 结果注入 ── <result>...</result> 注入对话 → 回到步骤 3
```

| 环节 | 当前文件 |
|------|----------|
| 工具装配 / skill 合并 | `server/src/engine/shared/tool-defs-loader.ts` |
| 系统提示词 | `server/src/engine/shared/prompt.ts`(客户端镜像 `src/engine/prompt.ts`) |
| 服务端执行(注册表查找 / skill 查找 / 模板 / 执行器加载) | `server/src/services/tool-executor.ts` |
| 工具执行路由 `POST /api/tools/exec` | `server/src/routes/tools.ts` |
| 客户端执行调用 | `src/api/tools-executor.ts` |
| 工具 store(getTools / getToolsByNames / seedTools) | `src/store/tools.ts` |

## API 参考

| 接口 | 方法 | 路径 |
|------|------|------|
| 工具列表读取 | `GET` | `/api/storage/read?path=tools/registry.json` |
| 工具注册表写入 | `PUT` | `/api/storage/write?path=tools/registry.json` |
| 工具执行 | `POST` | `/api/tools/exec`(`{ tool, args, agentId }`) |
| 权限读取 | `GET` | `/api/tools/permissions?agentId=xxx` |
| 权限写入 | `PUT` | `/api/tools/permissions?agentId=xxx` |

## 快速上手示例

### 示例:builtin 文件追加工具

**1. 在 `data/tools/registry.json` 添加定义:**

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

**2. 创建 `data/tools/executors/append_file.js`:**

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

**3. 分配给 Agent:** 配置面板勾选工具名 → 保存(写入 `config.json`)。

> 想让工具随技能一起分发,见[技能制作](./skills);想接入外部工具,见 [MCP 接入](./mcp)。
