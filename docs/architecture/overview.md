# 总体架构

4torm 是单仓库的前后端分离应用:浏览器前端(React 19 + Vite)经 HTTP / SSE 访问服务端(Fastify),服务端统一驱动所有 Agent 协作模式,数据全部落在本地文件系统。

## 分层架构

```
┌─────────────────────────────────────────────────────────┐
│                  浏览器 (Vite + React 19)                 │
│                                                           │
│  季风 │ 对流 │ 气旋 │ 信风 │ 潮汐 │ 控制台 │ 工具/技能/MCP   │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / SSE
┌────────────────────────┴────────────────────────────────┐
│                服务端 (Fastify 5 + TypeScript)            │
│                                                           │
│  路由层: /api/chat · /api/convection · /api/cyclone ·     │
│          /api/tradewind · /api/tide · /api/mcp ...        │
│                                                           │
│  引擎层: conversation · convection · cyclone ·            │
│          tradewind · services/tide                        │
│                                                           │
│  共享层: llm-bridge · agent-queue · agent-lock ·          │
│          tool-defs-loader · mcp-manager · prompt          │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────┴────────────────────────────────┐
│              LLM 提供商 (OpenAI 兼容接口)                  │
│              DeepSeek / OpenAI / Claude / 本地            │
└─────────────────────────────────────────────────────────┘
```

## 模块间关系

所有协作模式共享同一套 Agent 实体与 ReAct 引擎,区别只在「如何组织这批 Agent」:

```
                    ┌──────────┐
                    │  Agent   │  ← 所有模式共享同一套 Agent 实体 + ReAct
                    └────┬─────┘
      ┌──────────┬───────┼───────┬──────────┐
      │          │       │       │          │
 ┌────▼───┐ ┌───▼───┐ ┌─▼────┐ ┌▼──────┐ ┌─▼─────┐
 │  季风  │ │  对流 │ │ 气旋 │ │ 信风  │ │ 潮汐  │
 │ 1对1   │ │ 会议  │ │工作室│ │工作流 │ │自动化 │
 └────────┘ └───────┘ └──────┘ └───────┘ └───────┘
```

- **季风** 是基础——所有模式的 Agent 执行都复用 `SessionRunner` + ReAct 循环
- **对流** 是季风的多人版——多个 Agent 共享公共上下文,串行发言,会长私聊参谋
- **气旋** 是常驻工作室——工位私聊(季风式延续性)+ 群聊房间(对流式讨论)+ 会长参谋,共享工作区
- **信风** 是编排层——通过 DAG 定义 Agent 间的数据流转顺序,信封流转
- **潮汐** 是时间驱动层——复用季风的执行能力,加上调度器和滚动归档

## 共享基础设施

| 组件 | 职责 | 位置 |
|------|------|------|
| `llm-bridge` | 统一的 LLM 调用层(流式 / 非流式,token 统计;全局 3 路并发信号量) | `server/src/engine/shared/` |
| `agent-queue` | 按-Agent 串行队列(withAgentTurn):同一 Agent 被多处驱动时排队依次执行 | `server/src/engine/shared/` |
| `agent-lock` | Agent busy 短锁(产出期防重入) | `server/src/engine/shared/` |
| `tool-executor` | 工具执行派发(注册表查找 → 执行器加载 → 沙箱校验) | `server/src/services/` |
| `tool-defs-loader` | 工具装配(registry + skill + MCP 合并去重) | `server/src/engine/shared/` |
| `mcp-manager` | MCP 服务器连接与工具注入 | `server/src/engine/shared/` |
| `prompt` | 系统提示词构建(角色 + 工具列表 + 输出模板) | `server/src/engine/shared/` |

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + Vite + XY Flow(画布) |
| 服务端 | Fastify 5 + TypeScript + tsx |
| 桌面 | Electron 42(可选外壳,原生文件路径 + 生产自托管) |
| LLM 通信 | 原生 fetch,OpenAI Chat Completions 兼容格式 |
| 流式 | SSE(`text/event-stream`)全程推送 |
| 扩展协议 | MCP(stdio + JSON-RPC,手写客户端,无额外 SDK 依赖) |
| 数据存储 | 文件系统 JSON,无数据库依赖 |
| 进程模型 | 开发态 `concurrently` 并发起服务端 + Vite;生产态 Fastify(`@fastify/static`)单进程自托管 |

## 项目结构

```
4torm/
├── electron/                     ← 桌面外壳(main.cjs + preload.cjs,原生文件路径)
├── src/                          ← 前端 (React 19 + Vite)
│   ├── engine/                   ← 客户端引擎(解析、prompt、流式)
│   ├── convection/ui/            ← 对流会议页面
│   ├── cyclone/ui/               ← 气旋工作室页面(工位 / 群聊房间 / 会长抽屉)
│   ├── tradewind/ui/             ← 信风画布 + 节点 + 面板
│   ├── tide/ui/                  ← 潮汐管理面板
│   └── components/               ← 控制台、工具、技能、MCP 管理页
├── server/                       ← 服务端 (Fastify 5 + TypeScript)
│   └── src/
│       ├── engine/
│       │   ├── shared/           ← 共享层(llm-bridge, agent-queue, agent-lock, tool-defs-loader, mcp-manager)
│       │   ├── conversation/     ← 季风对话引擎(SessionRunner + ReAct)
│       │   ├── convection/       ← 对流会议引擎
│       │   ├── cyclone/          ← 气旋工作室引擎(seat / room / chair / contact runner)
│       │   └── tradewind/        ← 信风工作流引擎(orchestrator + 节点)
│       ├── services/             ← tool-executor、tide 调度器 + runner
│       └── routes/               ← HTTP 路由层(含 /api/mcp)
├── data/                         ← 运行时数据(JSON 文件存储,无数据库)
└── docs/                         ← 本文档站(VitePress)
```

> 数据目录细节见[数据目录](./data-layout),安全机制见[安全与隔离](./security),桌面端见[桌面化](./desktop)。
