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

前端依赖装在仓库根,服务端依赖装在 `server/`,两处都要装。

## 运行方式

4torm 同时支持「浏览器」与「桌面(Electron)」两种外壳,各有开发态与生产态:

```bash
# 浏览器开发:Fastify(:3001) + Vite(:5173),热更新
npm run dev                                # → http://localhost:5173

# 桌面开发:在上面基础上再起 Electron 窗口
npm run electron:dev

# 浏览器生产自托管:构建后由 Fastify 单进程托管
npm run build && npm run start:prod        # → http://localhost:3001

# 桌面生产:Electron 自动拉起自托管服务
npm run build && npm run electron:prod
```

- **开发态** 由 `concurrently` 同时起服务端(Fastify)与 Vite,前端 `fetch` 打 `localhost` 访问 `/api/*`,享受 HMR。
- **生产态** 由 Fastify(`@fastify/static`)单进程自托管已构建的前端,一个进程即可运行。桌面端的原生文件路径能力详见[桌面化](../architecture/desktop)。

## 首次配置

1. **添加 LLM 提供商** —— 控制台 → 提供商管理,填入 API endpoint 和 key(OpenAI 兼容格式)
2. **创建 Agent** —— 控制台 → 新建 Agent → 选模型、写角色提示词、勾选工具和技能
3. **开始对话** —— 侧栏切到「季风」→ 选 Agent → 发消息

> 预设支持 OpenAI 兼容服务。使用 Anthropic / 国内厂商等非标准 API,可通过 [one-api](https://github.com/songquanpeng/one-api) 或 [LiteLLM](https://github.com/BerriAI/litellm) 作翻译层。

## 接下来

- 想了解 Agent、ReAct、工具、技能这些底层概念 → [核心概念](./concepts)
- 想直接上手某个模式 → [季风对话](../modes/chat)、[气旋工作室](../modes/cyclone) 等
- 想给 Agent 加新能力 → [工具制作](../extend/tools)、[技能制作](../extend/skills)、[MCP 接入](../extend/mcp)
