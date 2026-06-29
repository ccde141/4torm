# MCP 接入

MCP(Model Context Protocol)让 4torm 接入**外部 MCP 服务器**,把它们的工具并入统一工具池,供任意 Agent 调用。无需为每个外部能力单独写执行器。

> 实现位于 `server/src/engine/shared/mcp-manager.ts`(连接与工具注入)与 `server/src/routes/mcp.ts`(管理路由,前缀 `/api/mcp`)。手写的 stdio + JSON-RPC 客户端,无额外 SDK 依赖。

## 工作原理

- **传输** —— 通过标准输入输出(stdio)启动外部 MCP 服务器进程,以 JSON-RPC 通信
- **工具注入** —— 每个外部工具以全局唯一名 `mcp:{服务名}:{工具名}` 注入统一工具池
- **通配调用** —— Agent 配置里写 `mcp:{服务名}:*` 即可调用该服务器的全部工具
- **工具名净化** —— 注入 LLM 前,把 `mcp:服务:工具` 这类含 `:` 的非法函数名**可逆净化**(兼容 OpenAI 函数命名),返回时还原,避免越权 / 串名

## 接入一个 MCP 服务器

1. 侧栏进入 **「MCP」页**
2. 点击添加,填写:
   - **服务器名** —— 即上面 `mcp:{服务名}:*` 里的服务名
   - **启动命令** + **参数** —— 以 stdio 拉起该服务器进程的命令行
3. 保存后自动连接;页面实时显示**连接状态**与**可用工具数**
4. 支持启用 / 停用、删除、一键重连

导入的工具自动并入工具池。要让某个 Agent 用上,在它的工具列表里加 `mcp:{服务名}:*`(或具体的 `mcp:{服务名}:{工具名}`)。

## 给 Agent 授权 MCP 工具

在 Agent 配置的工具列表中引用:

| 写法 | 含义 |
|------|------|
| `mcp:{服务名}:*` | 该服务器的**全部**工具(通配) |
| `mcp:{服务名}:{工具名}` | 该服务器的**单个**指定工具 |

Agent 调用时与普通工具无异——`<action tool="mcp:服务名:工具名">{...}</action>`,服务端经 MCP 管理器转发到外部服务器并取回结果。

## 配置存储

- 配置文件:`data/mcp/servers.json`
- **不入仓库**(已 gitignore),与 `data/providers.json`(API key)同等对待——属于本地敏感配置

```jsonc
// data/mcp/servers.json(示意)
[
  {
    "name": "filesystem",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/some/path"],
    "enabled": true
  }
]
```

> 仅 `enabled: true` 且 `transport: 'stdio'` 的服务器会被连接。

## 管理 API

所有端点前缀 `/api/mcp`:

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/list` | 列出已配置服务器及连接状态 |
| `POST` | `/add` | 添加服务器 |
| `POST` | `/remove` | 删除服务器 |
| `POST` | `/toggle` | 启用 / 停用 |
| `POST` | `/reconnect` | 一键重连 |
| `GET` | `/tools` | 列出已注入工具(`mcp:服务:工具` 全名) |

## 注意点

- MCP 工具与[全局工具](./tools)、[技能工具](./skills)同处一个工具池,Agent 一视同仁地调用
- 工具名净化是**可逆**的,LLM 看到的是净化名,执行时还原为 `mcp:服务:工具`,不会越权到别的服务器
- 服务器进程随 4torm 服务端生命周期管理,删除 / 停用即断开
