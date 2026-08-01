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

/** 拉起 Fastify，并把桌面浏览器桥接能力限定为此子进程可见。 */
function startServer(bridge) {
  const serverDir = path.join(__dirname, '..', 'server');
  const serverArgs = isProd ? ['tsx', 'src/index.ts'] : ['tsx', 'watch', 'src/index.ts'];
  serverProc = spawn('npx', serverArgs, {
    cwd: serverDir,
    env: {
      ...process.env,
      SERVE_STATIC: isProd ? '1' : '',
      NODE_ENV: isProd ? 'production' : 'development',
      PORT: String(PROD_PORT),
      FOURTORM_DESKTOP_BRIDGE: bridge.endpoint,
      FOURTORM_DESKTOP_BROWSER_TOKEN: bridge.token,
    },
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32', // Windows 上 npx 是 .cmd，需 shell
  });
  serverProc.on('exit', (code) => {
    console.log(`[electron] server 进程退出 code=${code}`);
    serverProc = null;
  });
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
  app.on('second-instance', () => focusMainWindow());
  app.whenReady().then(async () => {
    const bridge = await startDesktopBrowserBridge();
    startServer(bridge);
    try {
      await waitForServer(SERVER_URL);
    } catch (e) {
      console.error('[electron]', e.message, '—— 仍尝试加载窗口');
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else focusMainWindow();
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
