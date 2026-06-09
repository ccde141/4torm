/**
 * 4torm Server — Fastify 独立后端入口
 *
 * 端口：3001（前端 Vite dev server 通过 proxy 转发 /api/* 到这里）
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storageRoutes } from './routes/storage.js';
import { llmProxyRoutes } from './routes/llm-proxy.js';
import { skinRoutes } from './routes/skin.js';
import { toolRoutes } from './routes/tools.js';
import { skillsRoutes } from './routes/skills.js';
import { tradewindRoutes } from './routes/tradewind.js';
import { convectionRoutes } from './routes/convection.js';
import { chatRoutes } from './routes/chat.js';
import { delegateRoutes } from './routes/delegate.js';
import { conversationRoutes } from './routes/conversation.js';
import { tideRoutes } from './routes/tide.js';
import { startScheduler } from './services/tide/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');

const app = Fastify({
  logger: { level: 'warn' }, // 只打印 warn/error，请求日志由自定义 hook 控制
  bodyLimit: 30 * 1024 * 1024, // 30MB（自定义底纹图片 20MB 经 base64 膨胀约 27MB）
});

// 自定义请求日志：静默高频轮询路径，其余请求打印精简一行
const SILENT_PREFIXES = ['/api/storage/read', '/api/tradewind/node-status', '/api/tide/tasks', '/api/convection/list', '/api/skills/list', '/api/tradewind/status'];
app.addHook('onResponse', (req, reply, done) => {
  const url = req.url;
  if (req.method === 'GET' && SILENT_PREFIXES.some(p => url.startsWith(p))) {
    done();
    return;
  }
  const ms = reply.elapsedTime?.toFixed(0) ?? '?';
  const code = reply.statusCode;
  const color = code >= 400 ? '\x1b[31m' : code >= 300 ? '\x1b[33m' : '\x1b[32m';
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  process.stdout.write(`\x1b[90m${ts}\x1b[0m ${color}${req.method}\x1b[0m ${url} \x1b[90m${code} ${ms}ms\x1b[0m\n`);
  done();
});

await app.register(cors, { origin: true });

// 全局错误兜底：未被路由 try/catch 捕获的异常不泄露堆栈
app.setErrorHandler((error, _req, reply) => {
  const err = error as Error & { statusCode?: number };
  const status = err.statusCode || 500;
  app.log.error(error);
  reply.status(status).send({
    error: status >= 500 ? '服务器内部错误' : err.message,
  });
});

// 让路由能访问 dataDir
app.decorate('dataDir', DATA_DIR);
app.decorate('projectRoot', PROJECT_ROOT);

// Fastify 默认解析 JSON body，但 storage write 需要 raw text
app.addContentTypeParser(
  'text/plain', { parseAs: 'string' },
  (_req, body, done) => { done(null, body); },
);
app.addContentTypeParser(
  'application/octet-stream', { parseAs: 'string' },
  (_req, body, done) => { done(null, body); },
);

// 初始化数据目录
import fs from 'node:fs';
fs.mkdirSync(DATA_DIR, { recursive: true });

// 启动自愈：释放崩溃残留的 Agent 死锁
import { healAgentLocks } from './engine/shared/agent-lock.js';
healAgentLocks(DATA_DIR).then(released => {
  if (released.length > 0) {
    console.log(`[startup] 释放死锁 Agent: ${released.join(', ')}`);
  }
});

// 注册路由
await app.register(storageRoutes, { prefix: '/api/storage' });
await app.register(llmProxyRoutes, { prefix: '/api/llm' });
await app.register(skinRoutes, { prefix: '/skin' });
await app.register(toolRoutes, { prefix: '/api/tools' });
await app.register(skillsRoutes, { prefix: '/api/skills' });
await app.register(tradewindRoutes, { prefix: '/api/tradewind' });
await app.register(convectionRoutes, { prefix: '/api/convection' });
await app.register(chatRoutes, { prefix: '/api/chat' });
await app.register(delegateRoutes, { prefix: '/api/delegate' });
await app.register(conversationRoutes, { prefix: '/api/conversation' });
await app.register(tideRoutes, { prefix: '/api/tide' });

// 启动潮汐调度器（必须在路由注册后，确保 unlock hook 注册前没有 unlock 触发）
startScheduler(DATA_DIR);

// 初始化 MCP Manager（连接外部 MCP server）
import { initMcpManager } from './engine/shared/mcp-manager';
initMcpManager(DATA_DIR).catch(e => console.error('[MCP] init failed:', e.message));

// 健康检查
app.get('/api/health', async () => ({ status: 'ok', ts: Date.now() }));

const PORT = parseInt(process.env.PORT || '3001', 10);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`4torm server listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
