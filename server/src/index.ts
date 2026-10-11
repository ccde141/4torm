/**
 * 4torm Server — Fastify 独立后端入口
 *
 * 端口：3001（前端 Vite dev server 通过 proxy 转发 /api/* 到这里）
 */

import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { storageRoutes } from './routes/storage.js';
import { llmProxyRoutes } from './routes/llm-proxy.js';
import { skinRoutes } from './routes/skin.js';
import { skinVideoRoutes } from './routes/skin-video.js';
import { toolRoutes } from './routes/tools.js';
import { skillsRoutes } from './routes/skills.js';
import { stopActiveTradewindExecution, tradewindRoutes } from './routes/tradewind.js';
import { convectionRoutes } from './routes/convection.js';
import { agentWorkspaceRoutes } from './routes/agent-workspace.js';
import { delegateRoutes } from './routes/delegate.js';
import { tideRoutes } from './routes/tide.js';
import { createTideFeature } from './modules/tide/public.js';
import { internalContext } from './engine/collaboration/internal-context.js';
import { createMonsoonFeature, monsoonRoutes } from './modules/monsoon/public.js';
import { createTradewindFeature } from './modules/tradewind/public.js';
import { createConvectionFeature } from './modules/convection/public.js';
import { createCycloneFeature } from './modules/cyclone/public.js';
import { applyDeveloperMode } from './config/developer-mode.js';
import { installRequestLogging } from './config/request-logger.js';
import { drainAtomicWrites } from './engine/shared/atomic-io.js';
import { drainCycloneDispatches, resumeCycloneDispatches } from './engine/cyclone/dispatch-queue.js';
import { initMcpManager, shutdownMcpManager } from './engine/shared/mcp-manager.js';
import { performGracefulShutdown } from './services/graceful-shutdown.js';
import { getAllAgentActivities } from './engine/shared/agent-activity.js';
import { agentAvatarRoutes } from './routes/agent-avatar.js';
import { executionObserver } from './services/execution-observer.js';
import { backgroundExecutions } from './services/background-execution.js';
import { modelRuntimeRoutes } from './routes/model-runtime.js';
import { taskboardRoutes } from './routes/taskboard.js';
import { installFrameworkErrorHandler } from './routes/error-handler.js';
import { collaborationRoutes } from './routes/collaboration.js';
import { createCollaborationRuntime } from './engine/collaboration/runtime.js';
import { AgentCollaborationGateway, configureAgentCollaborationGateway, readAgentCollaborationCatalog } from './engine/collaboration/agent-gateway.js';
import { configureDynamicToolNames } from './tools/tool-name-policy.js';
import { installHumanIdentityPort } from './routes/collaboration-context.js';
import { loadAgent } from './engine/shared/agent-loader.js';
import { loadTransportCredentials } from './config/transport.js';
import { agentRoutes } from './modules/agents/public.js';
import { createRuntimeSettingsPort } from './modules/runtime-settings/public.js';
import { runtimeSettingsRoutes } from './routes/runtime-settings.js';
import { enforceLocalBrowserOrigin, localCorsOrigin } from './utils/sse.js';

applyDeveloperMode();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = process.env.FOURTORM_DATA_DIR
  ? path.resolve(process.env.FOURTORM_DATA_DIR)
  : path.join(PROJECT_ROOT, 'data');
const transport = await loadTransportCredentials(DATA_DIR);
process.env.FOURTORM_INTERNAL_CERT_FILE = transport.certPath;
process.env.FOURTORM_INTERNAL_SERVERNAME = transport.serverName;

// 功能区仅依赖 Fastify 公共路由 API；原始 SSE 响应由共享 transport 边界处理协议差异。
const app = Fastify({
  http2: true,
  https: { key: transport.key, cert: transport.cert, allowHTTP1: true },
  logger: { level: 'warn' }, // 只打印 warn/error，请求日志由自定义 hook 控制
  bodyLimit: 30 * 1024 * 1024, // 30MB（自定义底纹图片 20MB 经 base64 膨胀约 27MB）
}) as unknown as FastifyInstance;

app.addHook('onRequest', enforceLocalBrowserOrigin);
await app.register(cors, { origin: localCorsOrigin });

// 全局错误兜底：旧 error 字段兼容，并附加稳定错误身份；未知异常不泄露堆栈。
installFrameworkErrorHandler(app);
installHumanIdentityPort(app);

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
const tideFeature = createTideFeature({ dataDir: DATA_DIR });
const monsoonFeature = createMonsoonFeature({ dataDir: DATA_DIR });
const tradewindFeature = createTradewindFeature({ dataDir: DATA_DIR });
const convectionFeature = createConvectionFeature({ dataDir: DATA_DIR });
const cycloneFeature = createCycloneFeature({ dataDir: DATA_DIR });
const crashedMonsoonRuns = await monsoonFeature.runtime.initialize();
const crashedConvectionRuns = await convectionFeature.runs.initialize();
const crashedCycloneRuns = await cycloneFeature.runs.initialize();
const collaborationRouter = createCollaborationRuntime({
  settingsPort: createRuntimeSettingsPort(DATA_DIR),
  monsoonModule: monsoonFeature.module,
  tideModule: tideFeature.module,
  tradewindModule: tradewindFeature.module,
  convectionModule: convectionFeature.module,
  cycloneModule: cycloneFeature.module,
  presencePort: { read: getAllAgentActivities },
});
installRequestLogging(app, [
  monsoonFeature.module.manifest, convectionFeature.module.manifest,
  cycloneFeature.module.manifest, tradewindFeature.module.manifest, tideFeature.module.manifest,
]);
tideFeature.scheduler.bindScheduledTrigger(taskId => collaborationRouter.invoke({
  feature: 'tide', method: 'triggerScheduledTask', input: { taskId },
}, internalContext('tide.scheduler', randomUUID(), 'tide')));
configureAgentCollaborationGateway(new AgentCollaborationGateway(
  collaborationRouter, agentId => loadAgent(DATA_DIR, agentId),
));
configureDynamicToolNames(() => readAgentCollaborationCatalog().map(tool => tool.name));

// 启动自愈：释放 Agent 死锁，并把中断的信风运行标记为 crashed
import { recoverStartupState } from './services/startup-recovery.js';
const recovery = await recoverStartupState(DATA_DIR);
const crashedObservations = await executionObserver.restore(path.join(DATA_DIR, 'runtime', 'execution-observations.json'));
if (recovery.releasedAgents.length > 0) {
  console.log(`[startup] 释放死锁 Agent: ${recovery.releasedAgents.join(', ')}`);
}
if (recovery.crashedRuns > 0) {
  console.log(`[startup] 标记异常中断的信风运行: ${recovery.crashedRuns}`);
}
if (recovery.removedTempFiles > 0) {
  console.log(`[startup] 清理原子写残留临时文件: ${recovery.removedTempFiles}`);
}
if (recovery.failedCycloneDispatches > 0) {
  console.log(`[startup] 标记异常中断的气旋派发: ${recovery.failedCycloneDispatches}`);
}
if (crashedObservations > 0) console.log(`[startup] 标记异常中断的终端观察: ${crashedObservations}`);
if (crashedMonsoonRuns > 0) console.log(`[startup] 标记异常中断的季风执行: ${crashedMonsoonRuns}`);
if (crashedConvectionRuns > 0) {
  console.log(`[startup] 标记异常中断的对流轮次: ${crashedConvectionRuns}`);
}
if (crashedCycloneRuns > 0) {
  console.log(`[startup] 标记异常中断的气旋执行: ${crashedCycloneRuns}`);
}
if (recovery.crashedTideRuns > 0) {
  console.log(`[startup] 标记异常中断的潮汐执行: ${recovery.crashedTideRuns}`);
}

// 注册路由
await app.register(storageRoutes, { prefix: '/api/storage' });
await app.register(runtimeSettingsRoutes, { prefix: '/api/settings', router: collaborationRouter });
await app.register(taskboardRoutes, { prefix: '/api/taskboard' });
await app.register(llmProxyRoutes, { prefix: '/api/llm' });
await app.register(modelRuntimeRoutes, { prefix: '/api/model-runtime' });
await app.register(skinRoutes, { prefix: '/skin' });
await app.register(skinVideoRoutes, { prefix: '/api/skin-video' });
await app.register(toolRoutes, { prefix: '/api/tools' });
await app.register(skillsRoutes, { prefix: '/api/skills' });
await app.register(tradewindRoutes, {
  prefix: '/api/tradewind', router: collaborationRouter,
});
await app.register(convectionRoutes, {
  prefix: '/api/convection', router: collaborationRouter, feature: convectionFeature,
});
await app.register(agentWorkspaceRoutes, { prefix: '/api/chat' });
await app.register(delegateRoutes, { prefix: '/api/delegate' });
await app.register(monsoonRoutes, {
  prefix: '/api/conversation', feature: monsoonFeature, router: collaborationRouter,
});
await app.register(agentAvatarRoutes, { prefix: '/api/agents' });
await app.register(agentRoutes, { prefix: '/api/agents' });
await app.register(tideRoutes, {
  prefix: '/api/tide', feature: tideFeature, router: collaborationRouter,
});
await app.register(collaborationRoutes, {
  prefix: '/api/collaboration',
  router: collaborationRouter,
});
import { mcpRoutes } from './routes/mcp';
await app.register(mcpRoutes, { prefix: '/api/mcp' });
import { cycloneRoutes } from './routes/cyclone';
await app.register(cycloneRoutes, {
  prefix: '/api/cyclone', feature: cycloneFeature, router: collaborationRouter,
});
import { cycloneDispatchRoutes } from './routes/cyclone-dispatch';
await app.register(cycloneDispatchRoutes, {
  prefix: '/api/cyclone', feature: cycloneFeature, router: collaborationRouter,
});
import { cycloneOrganizationRoutes } from './routes/cyclone-organization';
await app.register(cycloneOrganizationRoutes, {
  prefix: '/api/cyclone', feature: cycloneFeature, router: collaborationRouter,
});
import { cycloneActivityRoutes } from './routes/cyclone-activity';
await app.register(cycloneActivityRoutes, {
  prefix: '/api/cyclone', feature: cycloneFeature, router: collaborationRouter,
});
import { memoryRoutes } from './routes/memory';
await app.register(memoryRoutes, { prefix: '/api/memory' });

// 启动潮汐调度器（必须在路由注册后，确保 unlock hook 注册前没有 unlock 触发）
tideFeature.scheduler.start();

// 初始化 MCP Manager（连接外部 MCP server）
initMcpManager(DATA_DIR)
  .catch(e => console.error('[MCP] init failed:', e.message))
  .finally(() => resumeCycloneDispatches(DATA_DIR)
    .catch(e => console.error('[cyclone] 恢复异步派发失败:', e.message)));

// 健康检查
app.get('/api/health', async () => ({ status: 'ok', ts: Date.now() }));

// 文档站（VitePress 构建产物）自托管在 /docs/。
// dev：Fastify 在 :3001，前端经 Vite 代理 /docs → 此处；prod：与应用同进程托管。
// 应用内「文档」按钮统一指向 /docs/，dev/prod 无需区分。需先跑过 npm run docs:build。
const DOCS_DIST = path.join(PROJECT_ROOT, 'docs', '.vitepress', 'dist');
if (fs.existsSync(DOCS_DIST)) {
  await app.register(fastifyStatic, {
    root: DOCS_DIST,
    prefix: '/docs/',
    decorateReply: false, // 避免与下方应用静态托管的 reply.sendFile 装饰冲突
  });
  console.log(`[startup] 文档托管已启用：/docs/ → ${DOCS_DIST}`);
} else {
  console.log('[startup] 未发现文档构建产物（docs/.vitepress/dist），/docs 未挂载。先跑 npm run docs:build');
}

// 生产：托管前端构建产物 dist/（dev 由 Vite dev server 提供，本块不启用）。
// 由 SERVE_STATIC=1 或 NODE_ENV=production 触发；Electron 打包后用此自托管，
// 业务 /api、/skin 路由已先注册，优先级高于静态文件。
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const SERVE_STATIC = process.env.SERVE_STATIC === '1' || process.env.NODE_ENV === 'production';
if (SERVE_STATIC && fs.existsSync(DIST_DIR)) {
  await app.register(fastifyStatic, { root: DIST_DIR, prefix: '/', wildcard: false });
  // SPA 回退：非 /api、非 /skin 的 GET 未命中静态文件 → 返回 index.html（前端路由自处理）
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/skin') && !req.url.startsWith('/docs')) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({ error: 'Not Found' });
  });
  console.log(`[startup] 静态托管已启用：${DIST_DIR}`);
}

const PORT = parseInt(process.env.PORT || '3001', 10);
let shutdownPromise: Promise<void> | null = null;

function requestShutdown(signal: 'SIGINT' | 'SIGTERM'): void {
  if (shutdownPromise) return;
  console.log(`[shutdown] 收到 ${signal}，开始排空运行时写入`);
  shutdownPromise = performGracefulShutdown({
    stopScheduler: () => tideFeature.scheduler.stop(),
    stopTradewind: stopActiveTradewindExecution,
    drainTide: () => tideFeature.scheduler.drain(),
    drainCyclone: drainCycloneDispatches,
    drainConvection: () => convectionFeature.discussionRounds.shutdown(),
    stopBackgroundExecutions: () => backgroundExecutions.shutdown(),
    drainWrites: async () => { await executionObserver.flush(); await drainAtomicWrites(); },
    shutdownMcp: shutdownMcpManager,
    closeServer: () => app.close(),
  }).then(() => {
    console.log('[shutdown] 排空完成');
    process.exit(0);
  }).catch((error) => {
    console.error('[shutdown] 排空失败:', (error as Error).message);
    process.exit(1);
  });
}

process.once('SIGINT', () => requestShutdown('SIGINT'));
process.once('SIGTERM', () => requestShutdown('SIGTERM'));

try {
  // 默认只接受本机桌面与 Vite 代理；local-human 身份口不具备远程账号认证。
  await app.listen({ port: PORT, host: 'localhost' });
  console.log(`4torm HTTPS/2 server listening on :${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
