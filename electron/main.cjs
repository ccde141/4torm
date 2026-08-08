/**
 * Electron 主进程入口（HTTP-on-localhost 架构）
 *
 * - dev：窗口加载 Vite dev server（http://localhost:5173），/api 由 Vite 代理转发到 Fastify(:3001)。
 * - prod：窗口加载 Fastify 自托管的 dist。
 * - 两种模式都由 Electron 托管 Fastify，并向它传入专用桌面浏览器桥接配置。
 *   触发条件：打包后（app.isPackaged）或显式 ELECTRON_PROD=1（未打包的生产预览）。
 *
 * 前端业务代码 / fetch / 流式接口均无需改动。
 */

const { app, BrowserWindow, WebContentsView, ipcMain, shell, nativeImage } = require('electron');
const { createSurfaceRegistry } = require('./surface-registry.cjs');
const { createDesktopBrowserBridge, createDesktopBrowserBridgeServer } = require('./desktop-browser-bridge.cjs');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

// 生产模式：打包后必走；未打包时由 ELECTRON_PROD=1 触发生产预览（自托管 dist/）
const isProd = app.isPackaged || process.env.ELECTRON_PROD === '1';
const isDev = !isProd;
const shouldOpenDevTools = isDev && process.env.ELECTRON_OPEN_DEVTOOLS === '1';
const DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
const PROD_PORT = parseInt(process.env.PORT || '3001', 10);
const PROD_URL = process.env.ELECTRON_PROD_URL || `http://localhost:${PROD_PORT}`;
const SERVER_URL = `http://localhost:${PROD_PORT}`;

// 应用名 + 任务栏标识（覆盖 package.json 的 npm 包名，避免显示 agent-dashboard）
app.setName('4torm');
if (process.platform === 'win32') app.setAppUserModelId('com.4torm.app');
const ownsSingleInstance = app.requestSingleInstanceLock();
if (!ownsSingleInstance) app.quit();

// 应用图标（风暴 logo，由 public/favicon.svg 光栅化生成）。Win 用 .ico，其余用 .png
const ICON_PATH = path.join(
  __dirname, '..', 'build',
  process.platform === 'win32' ? 'icon.ico' : 'icon.png',
);
// 用 nativeImage 显式加载（比传字符串路径更稳：文件缺失/格式问题不会静默退回默认）。
// 注意：未打包 dev 下 Windows 任务栏图标由 electron.exe 决定，此举主要钉死窗口标题栏图标；
// 任务栏/开始菜单要稳定用本图标，须 electron-builder 打包把图标嵌进 exe。
const APP_ICON = fs.existsSync(ICON_PATH) ? nativeImage.createFromPath(ICON_PATH) : undefined;
if (!APP_ICON || APP_ICON.isEmpty()) console.warn('[electron] 应用图标加载失败或为空：', ICON_PATH);

/** @type {BrowserWindow | null} */
let mainWindow = null;
const executionSurfaceRegistry = createSurfaceRegistry({ WebContentsView, getWindow: () => mainWindow });
/** @type {import('node:child_process').ChildProcess | null} 本进程托管的 Fastify 子进程 */
let serverProc = null;
let desktopBridgeServer = null;
let desktopBridgeConfig = null;

/** 拉起 Fastify，并把桌面浏览器桥接能力限定为此子进程可见。 */
function startServer(bridge) {
  if (serverProc) return;
  const serverDir = path.join(__dirname, '..', 'server');
  const tsxCli = path.join(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const nodeRuntime = process.env.npm_node_execpath || process.execPath;
  // Electron 自己管理服务端生命周期，不再额外套 npx/shell/watch 子进程树。
  // 这样关闭窗口时 kill 的就是实际服务进程，也不会留下下一次启动误连的残留后端。
  serverProc = spawn(nodeRuntime, [tsxCli, 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      SERVE_STATIC: isProd ? '1' : '',
      NODE_ENV: isProd ? 'production' : 'development',
      PORT: String(PROD_PORT),
      FOURTORM_DESKTOP_BRIDGE: bridge.endpoint,
      FOURTORM_DESKTOP_BROWSER_TOKEN: bridge.token,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
  serverProc.on('exit', (code) => {
    console.log(`[electron] server 进程退出 code=${code}`);
    serverProc = null;
  });
}

function isServerReady(url) {
  return new Promise((resolve) => {
    const req = http.get(url + '/api/health', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1200, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServerReady() {
  if (await isServerReady(SERVER_URL)) return;
  if (!desktopBridgeConfig) throw new Error('桌面浏览器桥接尚未初始化');
  startServer(desktopBridgeConfig);
  await waitForServer(SERVER_URL);
}

async function startDesktopBrowserBridge() {
  const token = randomBytes(32).toString('hex');
  const endpoint = `\\\\.\\pipe\\4torm-browser-${process.pid}-${randomBytes(12).toString('hex')}`;
  const bridge = createDesktopBrowserBridge({ token, registry: executionSurfaceRegistry });
  const server = createDesktopBrowserBridgeServer({ bridge, endpoint });
  await server.listen();
  desktopBridgeServer = server;
  return { endpoint, token };
}

/** 轮询健康检查，等 Fastify 起来再加载窗口，避免白屏/连接拒绝 */
function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const health = `${url}/api/health`;
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get(health, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy());
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('等待 server 启动超时'));
      else setTimeout(ping, 400);
    };
    ping();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: '4torm',
    icon: APP_ICON,
    backgroundColor: '#0f172a', // 与 --color-bg-primary 一致，避免白屏闪烁
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 允许 preload 使用 webUtils.getPathForFile
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (APP_ICON && !APP_ICON.isEmpty()) mainWindow?.setIcon(APP_ICON); // 再钉一次，稳住窗口图标
    mainWindow?.show();
  });

  // 外部链接交给系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(isDev ? DEV_URL : PROD_URL);
  if (shouldOpenDevTools) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => {
    mainWindow = null;
    executionSurfaceRegistry.dispose();
  });
}

ipcMain.handle('execution-surface:show', (event, input) => {
  assertMainWindowSender(event);
  const request = parseSurfaceRequest(input);
  executionSurfaceRegistry.show(request.executionId, request.bounds, request.leaseId);
});

ipcMain.handle('execution-surface:hide', (event, input) => {
  assertMainWindowSender(event);
  const request = parseSurfaceReference(input);
  executionSurfaceRegistry.hide(request.executionId, request.leaseId);
});

ipcMain.handle('execution-surface:set-input-enabled', (event, input) => {
  assertMainWindowSender(event);
  if (!input || typeof input !== 'object' || typeof input.enabled !== 'boolean') throw new Error('execution surface input state is invalid');
  executionSurfaceRegistry.setInputEnabled(parseSurfaceId(input.executionId), input.enabled);
});

function assertMainWindowSender(event) {
  if (event.sender !== mainWindow?.webContents) throw new Error('execution surface request came from an unknown renderer');
}

function parseSurfaceRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('execution surface request is invalid');
  return { executionId: parseSurfaceId(input.executionId), bounds: input.bounds, leaseId: parseSurfaceLease(input.leaseId) };
}

function parseSurfaceReference(input) {
  if (!input || typeof input !== 'object') throw new Error('execution surface request is invalid');
  return { executionId: parseSurfaceId(input.executionId), leaseId: parseSurfaceLease(input.leaseId) };
}

function parseSurfaceId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw new Error('execution surface id is invalid');
  return value;
}

function parseSurfaceLease(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(value)) throw new Error('execution surface lease is invalid');
  return value;
}

if (ownsSingleInstance) {
  app.on('second-instance', () => {
    void (async () => {
      const recovered = !(await isServerReady(SERVER_URL));
      try {
        await ensureServerReady();
        if (!mainWindow) createWindow();
        else if (recovered) mainWindow.webContents.reload();
      } catch (error) {
        console.error('[electron] 重新唤醒时恢复 server 失败：', error.message);
      }
      focusMainWindow();
    })();
  });
  app.whenReady().then(async () => {
    const bridge = await startDesktopBrowserBridge();
    desktopBridgeConfig = bridge;
    startServer(bridge);
    try {
      await waitForServer(SERVER_URL);
    } catch (e) {
      console.error('[electron]', e.message, '—— 仍尝试加载窗口');
    }
    createWindow();
    app.on('activate', () => {
      void ensureServerReady()
        .then(() => {
          if (BrowserWindow.getAllWindows().length === 0) createWindow();
          else focusMainWindow();
        })
        .catch(error => console.error('[electron] 激活时恢复 server 失败：', error.message));
    });
  });

  // 退出前掐掉托管的 server 子进程，避免端口残留
  app.on('before-quit', () => {
    if (serverProc) { serverProc.kill(); serverProc = null; }
    if (desktopBridgeServer) {
      void desktopBridgeServer.close().catch(error => console.error('[electron] desktop browser bridge close failed:', error));
      desktopBridgeServer = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}
