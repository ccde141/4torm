# 4torm

> 本地部署的多 Agent 协作平台 —— 让 AI 像公司员工一样长期存在，按需协作

<p align="center">
  <img src="./public/4TORM.png" alt="4torm" width="160" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/Fastify-5-000000?logo=fastify" alt="Fastify 5" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" />
</p>

<p align="center">
  季风对话 · 对流群聊 · 信风工作流 · 潮汐自动化
</p>

<p align="center">
  <a href="https://github.com/ccde141/4torm/issues">报告 Bug</a>
  ·
  <a href="https://github.com/ccde141/4torm">项目仓库</a>
  ·
  <a href="https://space.bilibili.com/406091025">B站空间</a>
</p>

---

## 设计哲学

4torm 的出发点很简单：Agent 更像是员工，而不是用完就扔的对话窗口。

一家公司里，老板招的人长期存在——有的活儿一个人干，有的得开会讨论，有的按流程接力，有的定时巡查。人是固定的那批人，变的只是协作方式。4torm 让 AI Agent 也这样工作：创建一次，能力配一次，哪里需要往哪里调。

**复用** — 同一个 Agent 今天对话、明天进工作流、后天被定时任务唤醒。工具和技能跨模式通用。

**灵活** — 四种模式不是四个产品，是组织同一批 Agent 的四种方式。按任务性质选最合适的就行。

## 四种协作模式

| 模式 | 代号 | 一句话 |
|------|------|--------|
| 对话 | 季风 Chat | 单 Agent 多轮对话 + 工具调用 + 子任务委托 |
| 群聊 | 对流 Convection | 多 Agent 圆桌讨论，人类主持，会长参谋 |
| 工作流 | 信风 TradeWind | 可视化画布编排 DAG，节点串/并联执行 |
| 自动化 | 潮汐 Tide | 定时触发，Agent 自主执行，滚动归档 |

### 模式选择参考

```
要 Agent 帮你做一件事？           → 季风（对话）
要多个 Agent 讨论出结论？         → 对流（群聊）
要多个 Agent 按顺序接力完成？     → 信风（工作流）
要 Agent 定时自动巡检/汇报？      → 潮汐（自动化）
```

## 核心特性

### Agent 持久实体

每个 Agent 拥有独立的角色提示词、模型配置、工具列表、技能列表和工作区目录。创建后长期存在，可在任意模式间复用。

### 共享 ReAct 引擎

所有协作模式共享同一套 ReAct 循环：思考 → 行动 → 观察 → 循环 → 输出回答。工具调用、子任务委托、流式输出全部统一。

### 工具与技能可扩展

- **工具（Tool）**：通过 `data/tools/registry.json` + `executors/*.js` 注册。内置文件读写、目录浏览、命令执行、网页抓取等
- **技能（Skill）**：通过 `data/skills/{id}/SKILL.md` 定义专业提示词，Agent 通过 `use_skill` 工具按需加载，不占用常驻上下文

### 长期记忆触发

Agent 工作区下的 `MEMORY.md` 文件，在用户消息命中"记忆/记住/之前/上次"等关键词时自动注入对话上下文。

### 流式输出全程贯通

LLM 流式 token、工具调用、子任务派发——全程 SSE 推送到前端。会话窗口关闭再打开能接上正在进行的流（信风节点和会议室节点都支持）。

### 沙箱级别隔离

Agent 文件操作受沙箱限制（`strict` / `relaxed` / `unrestricted` 三档），危险工具可配置 `always` / `ask` / `never` 权限。

## 界面预览

### 控制台 — Agent 管理

集中管理所有已注册的 Agent，配置模型、工具、技能、沙箱级别。

<p align="center">
  <img src="./public/screenshots/控制台.png" alt="控制台" width="100%" />
</p>

---

### 季风（Chat）— 单 Agent 对话

多轮对话 + 工具调用 + Sub-Agent 委托。`spawn_sub_agents` 派发子任务并行处理。

<p align="center">
  <img src="./public/screenshots/季风-Subagent调用1.png" alt="季风对话 - Sub-Agent 调用" width="100%" />
</p>

<p align="center">
  <img src="./public/screenshots/季风-Subagent调用2.png" alt="季风对话 - Sub-Agent 进行中" width="100%" />
</p>

<p align="center">
  <img src="./public/screenshots/季风-Subagent调用3.png" alt="季风对话 - Sub-Agent 完成" width="100%" />
</p>

---

### 对流（Convection）— 多 Agent 圆桌讨论

人类主持，多个 Agent 串行回复，会长私聊参谋。

<p align="center">
  <img src="./public/screenshots/对流会议室.png" alt="对流 会议室" width="100%" />
</p>

---

### 信风（TradeWind）— 可视化工作流

DAG 编排 + 节点状态实时反馈 + 信封流转 + 会议室节点。

<p align="center">
  <img src="./public/screenshots/信风工作流.png" alt="信风 工作流" width="100%" />
</p>

---

### 潮汐（Tide）— 定时自动化

按固定间隔触发 Agent 执行，支持自循环 + 滚动窗口归档。

<p align="center">
  <img src="./public/screenshots/潮汐自动化.png" alt="潮汐 自动化" width="100%" />
</p>

---

### 工具与技能体系

<p align="center">
  <img src="./public/screenshots/Tools.png" alt="工具管理" width="49%" />
  <img src="./public/screenshots/Skills.png" alt="技能管理" width="49%" />
</p>

---

### 模型提供商配置

支持 OpenAI 兼容接口，多家提供商统一管理。

<p align="center">
  <img src="./public/screenshots/模型提供商.png" alt="模型提供商" width="100%" />
</p>

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+

### 安装与运行

```bash
cd I:\A_Test_zone\test\4torm
npm install
cd server
npm install
cd ..
npm run dev
```

浏览器打开 `http://localhost:5173`。

### 首次配置

1. **添加 LLM 提供商** — 控制台 → 提供商管理，填入 API endpoint 和 key（OpenAI 兼容格式）
2. **创建 Agent** — 控制台 → 新建 Agent → 选模型、写角色提示词、勾选工具和技能
3. **开始对话** — 侧栏切到「季风」→ 选 Agent → 发消息

> 预设支持 OpenAI 兼容服务。使用 Anthropic / 国内厂商等非标准 API，可通过 [one-api](https://github.com/songquanpeng/one-api) 或 [LiteLLM](https://github.com/BerriAI/litellm) 作翻译层。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + Vite + XY Flow（画布） |
| 服务端 | Fastify 5 + TypeScript + tsx |
| LLM 通信 | 原生 fetch，OpenAI Chat Completions 兼容格式 |
| 数据存储 | 文件系统 JSON，无数据库依赖 |
| 进程模型 | 单进程，前后端 `concurrently` 并发启动 |

## 项目结构

```
4torm/
├── src/                          ← 前端 (React 19 + Vite)
│   ├── engine/                   ← 客户端引擎（解析、prompt、流式）
│   ├── tradewind/ui/             ← 信风画布 + 节点 + 面板
│   ├── tide/ui/                  ← 潮汐管理面板
│   └── convection/ui/            ← 对流群聊页面
├── server/                       ← 服务端 (Fastify 5 + TypeScript)
│   └── src/
│       ├── engine/
│       │   ├── shared/           ← 共享层（llm-bridge, agent-lock, tool-executor）
│       │   ├── conversation/     ← 季风对话引擎（SessionRunner + ReAct）
│       │   ├── convection/       ← 对流群聊引擎
│       │   └── tradewind/        ← 信风工作流引擎（orchestrator + 节点）
│       ├── services/tide/        ← 潮汐调度器 + runner
│       └── routes/               ← HTTP 路由层
├── data/                         ← 运行时数据（JSON 文件存储，无数据库）
│   ├── agents/                   ← Agent 注册表 + 各 Agent 工作区/会话
│   ├── tools/                    ← 工具定义 + 执行器
│   ├── skills/                   ← 技能模块
│   ├── tradewind/                ← 工作流定义 + 运行归档
│   └── tide/                     ← 潮汐任务 + 运行记录
└── docs/                         ← 操作文档（各模块详细引导）
```

## 文档

详细操作指南在 `docs/` 目录下：

- **总览** → `overview` — 平台定位、四模式架构、数据目录、快速上手
- **季风对话** → `chat-guide` — 创建 Agent、对话、委托、会话管理
- **对流群聊** → `convection-guide` — 创建会话、发言、会长私聊、动态管理
- **信风工作流** → `tradewind-guide` — 画布编排、节点配置、运行、会议室
- **潮汐自动化** → `tide-guide` — 任务创建、调度、自循环、归档策略
- **工具制作** → `tools-reference` — ToolDef 接口、执行器编写、权限系统
- **技能制作** → `skills-reference` — SKILL.md 编写、专属工具、加载机制

## 安全

- **API key 隔离**：`data/providers.json` 在 `.gitignore` 中，不入仓库
- **Agent 互斥锁**：防止同一 Agent 被多个任务/会话同时驱动导致状态污染
- **LLM 并发限制**：全局最大 3 路并发调用（信号量队列）
- **沙箱校验**：文件操作根据 Agent 沙箱级别限制可访问路径

## 如何贡献

欢迎提交 Issue 和 Pull Request！

- 提 Issue 前请先搜索是否已有相同问题
- 本地开发：`npm install` → `cd server && npm install` → `npm run dev`
- 代码风格：TypeScript 严格模式

## 许可证

[MIT](./LICENSE) © Ccde141

## 联系方式

- **B站**：[space.bilibili.com/406091025](https://space.bilibili.com/406091025)
- **GitHub Issues**：[github.com/ccde141/4torm/issues](https://github.com/ccde141/4torm/issues)
- **项目地址**：[github.com/ccde141/4torm](https://github.com/ccde141/4torm)
