# 桌面化丨Electron 方案与决策

> 记录于 2026-06-26。本文是 4torm 桌面端方向的决策与实施备忘，供后续接手参考。

## 背景与动机

当前形态：浏览器前端（Vite 8 + React 19 + TS）+ Fastify 5 Node 后端（`server/`），前端通过 HTTP 打 `localhost` 访问 `/api/*`。

痛点：浏览器沙箱导致**拖入图片等本地文件**拿不到真实路径、无法访问磁盘，体验受限。

目标：包成**窗口化桌面前端**，获得原生文件路径 / 磁盘访问 / 原生对话框等能力。

## 技术选型：Electron（已定）

| 维度 | Electron ✅ | Tauri（未选） |
|---|---|---|
| 现有 Fastify Node 后端 | **原样保留**，跑在主进程 | 核心是 Rust，需 sidecar 打包或重写后端 ← 真正的剧变 |
| React/Vite 前端 | 几乎零改动加载 | 用系统 webview，KaTeX/xyflow 等重渲染可能有差异 |
| 拖拽图片 | 原生拿到文件绝对路径 + 磁盘访问 | 要过 Rust 命令层 |
| Playwright | 主进程照常用 | 需额外处理 |
| 体积 | 大（~150MB，含 Chromium） | 小（~5-10MB） |

结论：项目已有完整 Node 后端，Tauri 的唯一优势（体积）抵不过重写后端的代价。选 **Electron**。

## 实施路线：先走「HTTP-on-localhost」（第一种，已定）

加壳即可，**不动现有任何业务代码 / Fastify 路由 / `/api/storage`**：

```
现状:  Vite(浏览器) ──HTTP──> Fastify(:port)
桌面:  Electron 主进程 ─┬─ 启动同一个 Fastify(:port)
                        └─ BrowserWindow 加载 dist/（前端 fetch 仍打 localhost）
```

新增项仅：
1. Electron 主进程入口（启动 Fastify + 开窗口）；开发期可用 `vite-plugin-electron` 衔接 HMR。
2. `preload` + `contextBridge`：把"拖入文件的真实路径"安全暴露给前端（拖拽痛点的解法）。
3. `electron-builder` 打包配置。

安全：renderer 关 `nodeIntegration`，仅通过 preload + contextBridge 暴露白名单能力。

> 注：HTTP-on-localhost 对 Electron 是**完全合法的长期架构**，很多桌面应用就这么做。不一定非要迁 IPC。

## 第二种「迁 IPC」的隐性风险评估（如果未来要走）

现状摸底（2026-06-26）：
- **fetch 调用 96 处**，**未集中**，散落 tradewind(27)/cyclone(21)/convection(11)/api(18)/components(10) 等。
- **流式 13 处** `res.body.getReader()`，覆盖 chat / convection / cyclone（座位&房间）/ tradewind / engine / llm —— 是产品命脉（LLM token 实时输出）。
- 皮肤/纹理图片用 `/api/storage/file?...&v=ts` 这类 **HTTP URL** 直接喂 `<img>` / CSS `url()`。

若做成字面意义的 HTTP→IPC 替换，会触发的隐性 bug / 重写面：

1. **流式模型不兼容（最大坑）**：IPC 没有 HTTP 流；13 处 `getReader()` 消费循环全要改写成 `webContents.send` / MessagePort 推送，易出分片重组、顺序、背压 bug。
2. **图片 URL 失效**：IPC 下没有 HTTP URL 可塞进 `src`，需注册自定义协议（`protocol.registerFileProtocol` / `app://`），`&v=` 缓存绕过策略要重想。
3. **错误语义丢失**：`res.ok` / `res.status` 不复存在；`StorageError` 类经结构化克隆跨进程会丢类型与栈。
4. **序列化限制**：IPC 走 structured clone，不能传函数/不可克隆对象；大 base64 走 IPC 给主进程内存压力。
5. **主进程阻塞**：handler 搬进 Electron 主进程若做重活会卡 UI，需 `utilityProcess` 隔离（现状 Fastify 自带独立事件循环天然隔离）。
6. **中间件作废**：`@fastify/cors` 等 HTTP 中间件失效；任何 header 逻辑要重做。
7. **取消语义**：`AbortController` 取消流要重映射成 IPC 取消消息。

### 结论 / 建议
- **是的，字面迁 IPC 会导致大量接口重写**——尤其 96 处分散 fetch + 13 处流式核心。
- **但通常没必要**。HTTP-on-localhost 可长期使用。IPC 的边际收益（不开端口、延迟略低、更"原生"）不值得重写流式命脉。
- 若将来仍想要：采用**混合**——只把「文件/拖拽 + 存储」这类非流式小接口走 IPC，**流式继续走 HTTP**。
- 廉价保险：即便留在 HTTP，也可把非流式调用收口到一个 `apiClient` 模块，将来要切 IPC 只改一处。

## 关联：暂停中的 UI 工作
- 主色前景对比度「系统自适应」方案（`--color-on-accent` 按亮度选深浅）已商定但暂停，详见记忆 `ui-contrast-on-accent`。
