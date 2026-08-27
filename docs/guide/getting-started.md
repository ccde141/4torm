# 快速开始

## 环境要求

- Node.js 20+
- npm 9+

## 安装

```bash
cd 4torm
npm install
cd server
npm install
cd ..
```

前端依赖装在仓库根，服务端依赖装在 `server/`，两处都要安装。

## 运行方式

4torm 同时支持浏览器与桌面端（Electron），各有开发态与生产态：

```bash
# 浏览器开发：Fastify（:3001）+ Vite（:5173），支持热更新
npm run dev                                # → http://localhost:5173

# 桌面开发：在上述服务基础上启动 Electron 窗口
npm run electron:dev

# 浏览器生产自托管：构建后由 Fastify 单进程托管
npm run build && npm run start:prod        # → http://localhost:3001

# 桌面生产：Electron 自动启动自托管服务
npm run build && npm run electron:prod
```

- **开发态**由 `concurrently` 同时启动 Fastify 与 Vite，前端通过 `localhost` 访问 `/api/*`，并支持 HMR。
- **生产态**由 Fastify 通过 `@fastify/static` 托管构建后的前端，一个进程即可运行。桌面端的原生文件路径能力详见[桌面化](../architecture/desktop)。

## 界面语言

侧栏左下角可以在「中文」与「English」之间切换。浏览器版和桌面版都会立即更新界面，并在本机记住你的选择。顶部的文档入口也会随界面语言打开对应版本。

## 首次配置

1. **添加模型提供商**——进入控制台的「提供商管理」，选择与实际服务一致的提供商类型，确认 API 地址和 Key，再获取或手动添加模型。Provider 参数通常保持默认，完整说明见[模型提供商](./providers)。
2. **创建 Agent**——控制台 → 新建 Agent → 选择模型、填写角色提示词，并确认默认启用的工具和技能。完整说明见[控制台与 Agent 管理](./agents)。
3. **开始对话**——侧栏切到「季风」→ 选择 Agent → 发送消息。

## 接下来

- 想了解 Agent、工具、技能等核心概念 → [核心概念](./concepts)
- 想直接上手某个模式 → [季风对话](../modes/chat)、[气旋工作室](../modes/cyclone)等
- 想为 Agent 增加新能力 → [工具制作](../extend/tools)、[技能制作](../extend/skills)、[MCP 接入](../extend/mcp)
