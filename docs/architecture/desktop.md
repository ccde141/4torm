# 桌面化 · Electron

4torm 提供可选的 **Electron 桌面外壳**:复用同一套 Web 应用,额外解锁浏览器拿不到的能力——最关键的是**拖入文件的真实绝对路径**。不想用桌面端时,浏览器形态完全照旧。

## 桌面端解锁了什么

浏览器沙箱下,拖入图片等本地文件**拿不到真实路径**、也无法访问磁盘,只能退而求其次走 base64。桌面外壳通过 `preload` 暴露 `webUtils.getPathForFile`,把拖入文件以**真实路径**交给 Agent(季风 / 对流 / 工作室均已接入);浏览器下自动回退到 base64,同一套界面两种形态无感切换。

## 运行

```bash
# 桌面开发:服务端 + Vite + Electron 窗口,带 HMR
npm run electron:dev

# 桌面生产:主进程自动拉起自托管服务,起来后再开窗
npm run build && npm run electron:prod
```

## 架构:HTTP-on-localhost

加壳即可,**不改动任何业务代码 / Fastify 路由 / `/api`**。桌面端与浏览器端跑的是同一个后端,只是由 Electron 主进程把它和窗口一起带起来:

```
浏览器:  Vite(浏览器) ──HTTP──> Fastify(:port)
桌面:    Electron 主进程 ─┬─ 启动同一个 Fastify(:port)
                          └─ BrowserWindow 加载 dist/(前端 fetch 仍打 localhost)
```

桌面端只比浏览器端多三块:

1. **Electron 主进程入口** —— 启动 Fastify + 开窗口;开发期由 `vite-plugin-electron` 衔接 HMR
2. **preload + contextBridge** —— 把"拖入文件的真实路径"以白名单方式安全暴露给前端
3. **electron-builder** —— 打包配置

**安全**:renderer 关闭 `nodeIntegration`,仅通过 preload + contextBridge 暴露白名单能力。

> 为何选 Electron 而非 Tauri:项目已有完整的 Node(Fastify)后端,加壳即用、零重写;HTTP-on-localhost 对桌面应用是完全合法的长期架构,无需迁 IPC。

## 生产自托管

生产模式由 Fastify(`@fastify/static`)单进程自托管已构建前端,桌面端与纯浏览器端共用这一套:

- `SERVE_STATIC=1`(或 `NODE_ENV=production`)时托管 `dist/`,对非 `/api`·`/skin` 的 GET 做 SPA 回退到 `index.html`;`/api`·`/skin` 路由优先级更高,不受影响
- 纯浏览器验证:`npm run start:prod` → 访问 `:3001`
- 桌面生产:`app.isPackaged` 或 `ELECTRON_PROD=1` 时主进程 `spawn` 该服务、轮询 `/api/health` 起来后再开窗,退出时掐子进程
