import type { FastifyInstance } from 'fastify';
import { queryTradewind, type TradewindRouteOptions } from './tradewind-route-support.js';
import { humanContext } from './collaboration-context.js';
import { openTradewindStream } from './tradewind-stream-response.js';
import type { PreparedTradewindEventStream } from '../modules/tradewind/public.js';
import { tradewindReadIdentity } from './tradewind-read-identity.js';

export async function registerTradewindNodeRoutes(
  app: FastifyInstance,
  options: TradewindRouteOptions,
): Promise<void> {
  // ── 统一 SSE 端点（按节点复用事件订阅） ─────────────────────

  /** GET /stream — 所有活跃节点的事件统一推送（单连接复用） */
  app.get('/stream', async (req, reply) => {
    const prepared = await options.router.prepareTransport('tradewind', 'unifiedEvents', {},
      humanContext(req)) as PreparedTradewindEventStream;
    openTradewindStream(req, reply, prepared);
  });

  /** GET /chat/:nodeId/status — 节点对话状态 */
  app.get('/chat/:nodeId/status', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    return reply.send(await queryTradewind(options, 'readNodeStatus', { nodeId, ...tradewindReadIdentity(req.query) }, req));
  });

  /**
   * GET /chat/:nodeId/snapshot — 订阅对账快照
   * 返回 { messages, roundLog, busy, lastSeq }。
   * 前端订阅时拉一次：messages 渲染历史，busy 时回放 roundLog 显示进行中轮次，
   * 之后只应用 seq > lastSeq 的增量事件。
   */
  app.get('/chat/:nodeId/snapshot', async (req, reply) => {
    const { nodeId } = req.params as { nodeId: string };
    return reply.send(await queryTradewind(options, 'readNodeSnapshot', { nodeId, ...tradewindReadIdentity(req.query) }, req));
  });

}
