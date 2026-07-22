# 工具 · 使用与制作

工具决定 Agent 能够执行哪些实际操作。一个本地工具由工具定义和执行器组成：工具定义告诉模型何时调用、需要哪些参数；执行器负责真正读取文件、运行命令或访问外部服务。

全局工具、技能附带工具和 MCP 工具最终都会进入 Agent 的可用工具列表，但来源和管理方式不同。

## 使用工具

工具在控制台的 Agent 配置页面中启用。

新建 Agent 时，框架内置工具默认处于选中状态，自定义工具和 MCP 工具需要手动选择；技能附带的工具会随技能自动加入，不需要在全局工具列表中重复选择。

工具旁的危险标记表示它具备写入、删除或命令执行等能力，主要用于能力识别和气旋 `plan` 模式的只读限制，不代表每次调用前都会再次请求确认。

## 内置工具

| 工具 | 用途 |
|------|------|
| `read_file` | 读取文件内容 |
| `write_file` | 创建或覆盖文件 |
| `edit_file` | 精确替换文件中的内容 |
| `delete_file` | 删除文件或目录 |
| `list_directory` | 查看目录内容 |
| `search_content` | 递归搜索文件内容 |
| `run_command` | 在当前工作区执行命令 |
| `webfetch` | 获取网页或 API 文本 |
| `use_skill` | 按需加载已经启用的技能说明 |

`ask`、`delegate`、任务板等由功能区提供的系统工具不属于全局工具，不会出现在 Tools 管理页面中。

## 创建和管理工具

![全局工具注册表](/images/extend/tool-registry.webp)

在 Tools 管理页面中点击「注册工具」，可以填写工具名称、用途、参数格式、危险标记和执行方式。

工具定义决定 Agent 如何理解并调用它：

- **工具名称**是模型调用时使用的稳定名称，应保持简短且不与现有工具重复。
- **功能描述**用于说明工具能做什么、适合在什么情况下使用。
- **参数 Schema**使用 JSON Schema 描述参数名称、类型和必填项。
- **危险标记**用于标明写入、删除或命令执行能力。
- **执行方式**可以选择命令模板或自定义 JavaScript。

编辑工具定义后，新的定义会从 Agent 下一次装配工具列表时生效；删除工具只会移除注册信息，不会自动删除已有执行器文件或历史工具记录。

### 由 Agent 创建工具

季风会话和气旋工位私聊中的 Agent 可以根据任务需要创建独立工具，Agent 会先完成 JavaScript 执行器和工具定义，再通过当前会话提交注册请求；从零创建工具时，当前 Agent 需要已经具备文件写入能力。

提交时，系统会检查工具名称、参数格式、执行器文件，以及是否与全局工具或技能附带工具重名；检查通过后，会使用当前会话的确认卡片询问是否注册，确认前不会修改全局工具列表。

注册成功后，工具会出现在 Tools 管理页面和 Agent 配置页面中，但不会自动加入已有 Agent 保存的显式工具清单；需要使用时，应回到控制台为对应 Agent 启用。

潮汐、信风和对流不提供工具注册；气旋群聊、会长私聊以及无人联络回合也不会触发注册确认。

工具注册表属于框架控制面，新增、编辑或删除工具定义时，应使用 Tools 管理页面或 Agent 的注册流程，不建议直接修改 `data/tools/registry.json`。

### 最小创建流程

无论由人类还是 Agent 创建自定义工具，都应按以下顺序进行：

1. 确定工具名称。名称必须以小写字母开头，只能包含小写字母、数字和下划线，最长 64 个字符。
2. 在 `data/tools/executors/` 中创建 JavaScript 执行器。
3. 明确工具描述、危险标记和参数 Schema。
4. 检查执行器能够正常加载，再提交工具定义。
5. 注册完成后，在控制台中为需要使用它的 Agent 启用。

Agent 提交注册时使用 `register_tool`：

```json
{
  "name": "word_count",
  "description": "统计文本文件的字符数和行数",
  "dangerous": "false",
  "executorFile": "word_count",
  "parameters": "{\"type\":\"object\",\"properties\":{\"filePath\":{\"type\":\"string\",\"description\":\"文件路径\"}},\"required\":[\"filePath\"]}"
}
```

`executorFile` 不包含 `.js`，`parameters` 需要传入序列化后的 JSON Schema 字符串；执行器不存在、参数格式错误或工具名称重复时，注册会被拒绝。

## 工具定义

工具参数使用 JSON Schema 描述：

```json
{
  "name": "word_count",
  "description": "统计文本文件的字符数和行数",
  "category": "custom",
  "dangerous": false,
  "executorType": "custom",
  "executorFile": "word_count",
  "parameters": {
    "type": "object",
    "properties": {
      "filePath": {
        "type": "string",
        "description": "需要统计的文件路径"
      }
    },
    "required": ["filePath"]
  }
}
```

`required` 中列出的参数必须提供；其他参数均为可选。参数描述会直接提供给模型，应明确写出格式、单位和适用范围。

## 执行器类型

### 内置执行器

内置执行器由框架提供，位于 `data/tools/executors/`，负责文件读写、命令执行、网页读取和技能加载等基础能力，通常不需要修改。

### 命令模板

命令模板通过 `{{参数名}}` 将参数填入 Shell 命令：

```json
{
  "name": "curl_fetch",
  "executorType": "template",
  "executorTemplate": "curl -s {{url}}"
}
```

命令会从当前工作区启动，最长执行 15 秒。参数会直接进入命令字符串，因此模板只适合参数范围明确的短操作，不适合任意外部输入、长下载或复杂脚本。

### 自定义 JavaScript

自定义执行器位于：

`data/tools/executors/{executorFile}.js`

执行器必须默认导出一个异步函数：

```javascript
export default async function (args, ctx) {
  return '执行结果'
}
```

返回值通常是字符串，也可以返回 `{ result, meta }`：`result` 会交给 Agent，`meta` 只用于前端展示，不会进入模型上下文。

执行器文件修改后会在下一次调用时重新加载，不需要重启 4torm。

## 长时间任务

普通构建、安装或下载可以使用 `run_command`。它默认等待两分钟，也可以通过可选的 `timeout` 参数设置 `1000` 至 `600000` 毫秒：

```json
{
  "command": "npm run build",
  "timeout": 600000
}
```

超过十分钟、需要流式写入文件或需要专门进度管理的任务，更适合使用自定义 JavaScript 执行器，通过 `spawn`、文件流或网络流完成。自定义执行器不受命令模板的 15 秒限制。

工具执行期间，界面会持续显示工具名称、处理目标和经过时间，因此长任务即使暂时没有文本输出，也可以判断 Agent 仍在运行。

## 执行器上下文

JavaScript 执行器会收到以下上下文：

```typescript
{
  dataDir: string
  workspaceDir: string
  projectDir: string
  sandboxLevel: 'project' | 'unrestricted'
}
```

- `dataDir` 指向 4torm 的本地数据目录。
- `workspaceDir` 是当前会话实际使用的工作区。
- `projectDir` 是 4torm 项目根目录。
- `sandboxLevel` 是当前 Agent 的执行权限。

框架内置文件工具会自动执行路径校验，相对路径从当前工作区解析；项目级允许访问 4torm 项目和当前工作区，无限制则允许访问其他外部路径。

`run_command` 和命令模板同样从当前工作区启动，但不使用内置文件工具的路径守卫，需要切换位置时可以使用绝对路径或在命令中明确 `cd`。

写文件、编辑和删除工具会阻止直接修改 Agent 注册表、工具注册表、潮汐任务表和工作流控制文件；工作流自己的 `workspace/` 不受影响。

自定义执行器属于本地可信代码，可以直接调用 Node.js 能力，不会因为收到 `ctx` 就自动获得路径限制。制作文件工具时，需要主动调用统一路径辅助函数 `resolvePath`：

```javascript
import { resolvePath } from './_resolve.js'

const file = resolvePath(args.filePath, ctx, { write: true })
```

`resolvePath` 会应用当前执行权限，其中 `{ write: true }` 还会启用框架控制面写保护；自定义执行器若绕过该辅助函数直接操作文件系统，需要自行承担路径处理和写入边界。

## 技能附带工具

技能可以通过自己的 `tools.json` 和 `executors/` 提供专用工具。启用技能后，这些工具会自动加入 Agent 的工具列表。

技能工具会优先从该技能目录下的 `executors/` 加载执行器；找不到时再回退到全局执行器目录。全局工具和不同技能之间应避免使用相同名称。

完整结构见[技能 · 使用与制作](./skills)。

## MCP 工具

MCP 工具由 MCP 页面中的外部服务提供，不使用本地 `registry.json` 和 JavaScript 执行器。连接 MCP 服务后，需要在 Agent 配置中明确选择对应工具。

MCP 工具名称使用 `mcp:服务名:工具名` 的形式，以免与本地工具重名。调用时会直接交给对应的 MCP 服务执行。

完整配置见[MCP 接入](./mcp)。

## 存储与接口

本地工具使用以下目录：

```text
data/tools/
  registry.json
  executors/
    {executorFile}.js
```

主要接口：

| 方法 | 路径 | 用途 |
|------|------|------|
| `GET` | `/api/storage/read?path=tools/registry.json` | 读取工具列表 |
| `PUT` | `/api/storage/write?path=tools/registry.json` | Tools 页面保存工具列表 |
| `POST` | `/api/tools/exec` | 执行本地工具 |

工具装配和执行的主要代码位于：

- `src/store/tools.ts`
- `server/src/engine/shared/tool-defs-loader.ts`
- `server/src/services/tool-executor.ts`
- `server/src/routes/tools.ts`
