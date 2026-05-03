# 4torm

> 4torm —— AI Agent 对话与可视化工作流编排，如风暴般重塑开发方式 [Vibe Coding]

<p align="center">
  <img src="./public/4TORM.png" alt="4torm" width="120" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs Welcome" />
</p>

<p align="center">
  AI Agent 对话 · 图形化工作流编排 · Tool/Skill 体系 · 纯前端运行
</p>

<p align="center">
  <a href="https://github.com/ccde141/4torm/issues">报告 Bug</a>
  ·
  <a href="https://github.com/ccde141/4torm">项目仓库</a>
  ·
  <a href="https://space.bilibili.com/406091025">B站空间</a>
  ·
  <a href="./README_EN.md">English</a>
</p>

---

## 功能特性

### 🤖 AI Agent 对话
多模型兼容（OpenAI / Anthropic / Ollama），流式输出，Think 推理过程实时可见。支持**单 Agent 多会话**架构，每个会话独立维护上下文，Agent 实体与对话历史完全解耦，同一 Agent 可在多个会话中并行运行。

### ⚙️ 提示词驱动的沙箱工作流
拖拽式沙箱节点编排引擎。**每一条连线（Arrow）都不是简单的数据流，而是一套精密的 Prompt 管道系统**：

- `extractField` — 从上游输出中提取指定字段传入下游，而非传递全部数据
- `contextMode` — 自动对上游输出做摘要，作为下游的上下文背景
- `injectRole` — 用上游输出直接覆盖下游 Agent 的角色提示词，实现动态角色链

在这里，你不是用代码写逻辑，而是**用提示词定义数据在节点间的语义转换**。

### ⚠️ 沙箱工作流（测试阶段）
沙箱工作流当前处于**测试阶段**，部分功能可能存在不稳定或未完善之处，欢迎提交 Issue 反馈问题与建议。

### 🧩 Agent 节点：双层解耦设计
工作流中的 Agent 节点拥有两个独立层：

- **外层 — Agent 实体引用**（`agentId`）：关联 Agent 的模型配置、工具集、技能列表，Agent 在 Dashboard 中独立管理
- **内层 — 运行时角色覆盖**（`agentRole`）：可独立编辑角色提示词，支持 `{{goal}}`、`{{input}}`、`{{context}}` 等模板变量，同一 Agent 在不同节点中展现不同行为

### 🧠 长期记忆系统
基于 `MEMORY.md` 的记忆机制，Agent 能感知跨会话的上下文信息，实现持久化记忆。支持 `/compact` 命令压缩对话历史。

### 🔧 Tool / Skill 体系
Agent 可自主读取文档、按需创建工具与技能。内置文件读写、Web 搜索、代码执行等执行器，框架具备运行时自扩展能力。

### 🎨 个性化皮肤
主色 + 氛围光自由定制，一键切换视觉风格。

### 📦 纯前端运行
无需后端服务。所有数据以 JSON 文件本地存储，配置 API Key 即可在浏览器中完整使用。

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+

### 安装与运行

```bash
git clone https://github.com/ccde141/4torm.git
cd 4torm
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`，在侧边栏 → 设定中添加 AI 服务商 API Key 即可开始使用。

## 截图

### 仪表盘主页 — Dashboard

应用的首页入口，集中展示所有已注册 Agent 的运行状态。左侧边栏列出 Agent 列表，支持快速切换与状态识别。主区域以卡片形式呈现每个 Agent 的会话概览。顶部提供 Agent 创建与配置入口，支持自定义角色提示词、模型参数等。

<p align="center">
  <img src="./public/screenshots/Dashboard.png" alt="Dashboard" width="100%" />
  <em>Dashboard — Agent 管理首页，包含状态显示与创建配置</em>
</p>

---

### 多会话聊天 — Session

Agent 的实时对话界面，支持多会话管理。每条消息展示模型型号与 token 消耗。截图覆盖两个核心场景：**Think 推理过程**（模型思考链路的可视化展示）与 **工具调用**（Action 调用细节、参数与返回结果）。左侧会话列表支持历史会话管理。

<p align="center">
  <img src="./public/screenshots/session.png" alt="Session" width="100%" />
  <em>Session — 会话聊天界面，展示 Think 思考过程与工具调用</em>
</p>

<p align="center">
  <img src="./public/screenshots/session2.png" alt="Session Detail" width="100%" />
  <em>Session — 会话聊天界面，展示 Think 思考过程与工具调用（二）</em>
</p>

---

### 沙箱工作流 — Sandbox

沙箱模块的可视化工作流编排引擎，两张截图展示完整的示例工作流：
- **工作流画布**：通过拖拽节点与连线构建自动化流程，支持入口、Agent 节点、条件分支、循环、并行分叉、人工审批等多种节点类型
- **参数配置**：选中节点后可配置提示词、模型参数、超时重试等属性

<p align="center">
  <img src="./public/screenshots/sandbox1.png" alt="Sandbox Workflow" width="100%" />
  <em>Sandbox — 示例工作流画布与节点编排</em>
</p>

<p align="center">
  <img src="./public/screenshots/sandbox2.png" alt="Sandbox Detail" width="100%" />
  <em>Sandbox — 示例工作流节点参数配置</em>
</p>

---

### 技能管理 — Skills

技能系统以列表形式展示所有已注册的技能项，包含技能名称、描述、启用/禁用状态。技能是工具调用的高级封装，Agent 通过技能名称即可触发完整的多步操作流程。

<p align="center">
  <img src="./public/screenshots/Skills.png" alt="Skills" width="100%" />
  <em>Skills — 技能列表页</em>
</p>

---

### 工具管理 — Tools

展示系统内置工具及其对应的提示词配置。每个工具包含参数定义与调用说明，支持多个工具的集中管理。截图中展示了两类已配置的工具示例。

<p align="center">
  <img src="./public/screenshots/Tools.png" alt="Tools" width="100%" />
  <em>Tools — 系统内置工具列表与提示词配置</em>
</p>

---

### 模型提供商配置 — LLM Provider

支持多个模型提供商的统一管理，可自定义 API 连接，也内置了预先配置好的提供商模板（如 OpenAI、Anthropic、Ollama 等），方便快速接入不同的大语言模型服务。

> 预设均为 OpenAI 兼容服务。使用 Anthropic 等非 OpenAI API，可部署 [one-api](https://github.com/songquanpeng/one-api) 或 [LiteLLM](https://github.com/BerriAI/litellm) 作为翻译层，填入其地址即可。

<p align="center">
  <img src="./public/screenshots/LLM.png" alt="LLM Config" width="100%" />
  <em>LLM Provider — 多模型提供商配置与模板预设</em>
</p>

## 使用指南

1. **配置 API Key** — 启动后在侧边栏 → 设定中添加 API Key（支持 OpenAI / Anthropic / Ollama 等）
2. **创建 Agent** — 定义 Agent 的名称、角色描述、模型参数，它是所有会话和工作流的核心
3. **开始对话** — 选择一个 Agent 发起会话，编写自定义角色提示词，开始 AI Agent 对话
4. **编排工作流** — 切换至沙箱模式，通过拖拽节点搭建自动化工作流，支持条件分支、循环、人工审批等
5. **长期记忆** — 在 Agent 工作区创建 `MEMORY.md`，Agent 将自动读取并遵循，实现跨会话记忆
6. **命令系统** — 支持 `/compact`（压缩对话历史）、`/start`（重新引导 Agent）

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite |
| AI SDK | Anthropic Claude API / OpenAI API |
| 状态管理 | Zustand |
| 沙箱引擎 | 可视化节点编排系统 |
| 样式系统 | 原生 CSS + CSS 自定义属性 |

## 项目结构

```
4torm/
├── src/
│   ├── components/           # UI 组件
│   │   ├── chat/             # 会话系统（消息流、Think 展示、会话列表）
│   │   ├── sandbox/          # 沙箱工作流（节点拖拽、画布、配置面板）
│   │   ├── layout/           # 布局框架（侧边栏、顶部栏、皮肤面板）
│   │   └── agents/           # Agent 管理（配置、仪表盘）
│   ├── engine/               # 核心引擎（提示词组装、Agent 进程、沙箱执行器）
│   ├── store/                # 状态管理与数据持久化
│   ├── styles/               # CSS 样式与主题变量
│   └── App.tsx               # 应用根组件
├── docs/                     # 详细文档
│   ├── sandbox-nodes-reference.md
│   ├── tools-reference.md
│   └── skills-reference.md
├── data/                     # 运行时数据（会话、Agent 配置、模型提供商配置）
└── public/                   # 静态资源
```

## 文档

- [沙箱节点参考](./docs/sandbox-nodes-reference.md) — 工作流中所有可用节点的配置与行为说明
- [Tool 注册指南](./docs/tools-reference.md) — 如何注册和使用自定义工具
- [Skill 开发指南](./docs/skills-reference.md) — 如何创建和安装 Agent 技能

## 架构亮点

### 沙箱：提示词驱动的节点编排系统

沙箱中的每一条**连线（Arrow）不只是数据流，而是一套提示词逻辑系统**。每条边携带 `ArrowConfig`，通过三个语义维度控制节点间的数据传递：

| 配置 | 作用 |
|------|------|
| `extractField` | 从上游输出中提取指定字段传入下游，而非传递全部数据 |
| `contextMode` | 自动对上游输出做摘要（截取前 500 字符），作为下游的上下文背景 |
| `injectRole` | 用上游输出直接覆盖下游 Agent 的角色提示词，实现动态角色链 |

这意味着在 4torm 中，你**不是用代码写逻辑，而是用提示词定义数据在节点间的语义转换**——每一条边都是一个精密的 Prompt 管道。

### Agent 节点：双层解耦设计

Agent 节点在工作流中拥有**两个独立层**：

- **外层 — Agent 实体引用**：通过 `agentId` 关联一个真实的 Agent（携带其模型配置、工具集、技能列表），但 Agent 本身在 Dashboard 中独立管理，与工作流解耦
- **内层 — 运行时角色覆盖**：工作流中的 `agentRole` 可独立编辑，覆盖 Agent 的默认角色提示词，支持模板变量（`{{goal}}`、`{{input}}`、`{{context}}` 等），让同一个 Agent 在不同工作流节点中表现出不同行为

### 完全解耦的三层架构

```
Dashboard (Agent 管理)          Sandbox (工作流)             Chat (会话)
     │                              │                          │
     │  Agent 实体                    │   Envelope              │  消息列表
     │  (模型/工具/技能)              │   (纯数据结构)           │   (对话历史)
     │  只读引用 ◄──────              │                          │
     │                              │  零 chat 依赖             │
     │                              │  独立文件存储             │
     │                              │  独立状态管理             │
```

- **沙箱与会话完全解耦** — 沙箱使用独立的 `Envelope` 数据结构传递数据，所有 LLM 调用均为 stateless 请求，不依赖任何聊天历史
- **沙箱与 Agent 松耦合** — 工作流节点仅通过 `agentId` 只读引用 Agent 配置，Agent 的完整配置在 Dashboard 中管理
- **文件即数据库** — 所有数据以 JSON 文件存储，便于版本管理和调试
- **自扩展 Agent** — Agent 可读取文档自主创建 Tool/Skill，框架具备运行时自扩展能力

## 如何贡献

欢迎提交 Issue 和 Pull Request！

- 提 Issue 前请先搜索是否已有相同问题
- 本地开发：`npm install` → `npm run dev`
- 代码风格：TypeScript 严格模式

## 许可证

[MIT](./LICENSE) © Ccde141

## 联系方式

- Bilibili: [space.bilibili.com/406091025](https://space.bilibili.com/406091025)
- GitHub Issues: [github.com/ccde141/4torm/issues](https://github.com/ccde141/4torm/issues)
- 项目地址: [github.com/ccde141/4torm](https://github.com/ccde141/4torm)
