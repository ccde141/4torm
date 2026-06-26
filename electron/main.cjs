/**
 * Electron 主进程入口（HTTP-on-localhost 架构）
 *
 * - dev：窗口加载 Vite dev server（http://localhost:5173），/api 由 Vite 代理转发到 Fastify(:3001)。
 *   Fastify 与 Vite 由根目录 `npm run dev`（concurrently）启动，本进程不重复拉起。
 * - prod：暂加载 http://localhost:3001（需 Fastify 以 @fastify/static 提供 dist/，属打包阶段后续工作）。
 *
 * 前端业务代码 / fetch / 流式接口均无需改动。
 */

const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;
const DEV_URL = process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173';
const PROD_URL = process.env.ELECTRON_PROD_URL || 'http://localhost:3001';

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0f172a', // 与 --color-bg-primary 一致，避免白屏闪烁
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // 允许 preload 使用 webUtils.getPathForFile
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // 外部链接交给系统浏览器，不在应用内打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(isDev ? DEV_URL : PROD_URL);
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
