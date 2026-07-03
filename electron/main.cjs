/**
 * Electron 主进程入口（HTTP-on-localhost 架构）
 *
 * - dev：窗口加载 Vite dev server（http://localhost:5173），/api 由 Vite 代理转发到 Fastify(:3001)。
 *   Fastify 与 Vite 由根目录 `npm run dev`（concurrently）启动，本进程不重复拉起。
 * - prod：本进程拉起 Fastify（SERVE_STATIC=1，自托管 dist/），窗口加载 http://localhost:3001。
 *   触发条件：打包后（app.isPackaged）或显式 ELECTRON_PROD=1（未打包的生产预览）。
 *
 * 前端业务代码 / fetch / 流式接口均无需改动。
 */

const { app, BrowserWindow, shell, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

// 生产模式：打包后必走；未打包时由 ELECTRON_PROD=1 触发生产预览（自托管 dist/）
const isProd = app.isPackaged || process.env.ELECTRON_PROD === '1';
const isDev = !isProd;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
const PROD_PORT = parseInt(process.env.PORT || '3001', 10);
const PROD_URL = process.env.ELECTRON_PROD_URL || `http://localhost:${PROD_PORT}`;

// 应用名 + 任务栏标识（覆盖 package.json 的 npm 包名，避免显示 agent-dashboard）
app.setName('4torm');
if (process.platform === 'win32') app.setAppUserModelId('com.4torm.app');

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
/** @type {import('node:child_process').ChildProcess | null} 生产模式下本进程托管的 Fastify 子进程 */
let serverProc = null;

/** 拉起 Fastify（生产自托管）。dev 模式不调用——服务由 npm run dev 提供。 */
function startServer() {
  const serverDir = path.join(__dirname, '..', 'server');
  // 未打包预览用 tsx 直跑 TS；打包后同样随附 server 源码 + node_modules（extraResources）。
  serverProc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: { ...process.env, SERVE_STATIC: '1', NODE_ENV: 'production', PORT: String(PROD_PORT) },
    stdio: 'inherit',
    shell: process.platform === 'win32', // Windows 上 npx 是 .cmd，需 shell
  });
  serverProc.on('exit', (code) => {
    console.log(`[electron] server 进程退出 code=${code}`);
    serverProc = null;
  });
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
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  if (isProd) {
    startServer();
    try {
      await waitForServer(PROD_URL);
    } catch (e) {
      console.error('[electron]', e.message, '—— 仍尝试加载窗口');
    }
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 退出前掐掉托管的 server 子进程，避免端口残留
app.on('before-quit', () => {
  if (serverProc) { serverProc.kill(); serverProc = null; }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
