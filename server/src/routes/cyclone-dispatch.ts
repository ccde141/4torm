import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  dismissDispatch,
  includeDispatchResult,
  markDispatchRead,
} from '../engine/cyclone/dispatch-actions.js';
import {
  listRoomDispatches,
  listWorkshopDispatches,
  type CycloneDispatch,
} from '../engine/cyclone/dispatch-store.js';
import { isDispatchVisibleInRoom } from '../engine/cyclone/dispatch-visibility.js';
import { loadRoom } from '../engine/cyclone/room-store.js';
import { loadWorkshop } from '../engine/cyclone/workshop-store.js';
import { getAppContext } from '../services/app-context.js';

interface DispatchParams {
  workshopId: string;
  roomId: string;
  dispatchId: string;
  action: string;
}

const DOMAIN_CONFLICT = /不能|尚未|已经|正在运行|本轮结束/;

function sendDomainError(reply: FastifyReply, error: unknown) {
  const message = (error as Error).message || '';
  if (message.includes('不存在')) return reply.status(404).send({ error: message });
  if (DOMAIN_CONFLICT.test(message)) return reply.status(409).send({ error: message });
  throw error;
}

async function listVisibleWorkshopDispatches(
  dataDir: string,
  workshopId: string,
): Promise<CycloneDispatch[]> {
  const items = await listWorkshopDispatches(dataDir, workshopId);
  const roomItems = items.filter(item => item.sourceKind !== 'seat');
  const roomIds = [...new Set(roomItems.map(item => item.sourceRoomId))];
  const rooms = new Map(await Promise.all(roomIds.map(async roomId => (
    [roomId, await loadRoom(dataDir, workshopId, roomId)] as const
  ))));
  return items.filter(item => {
    if (item.sourceKind === 'seat') return true;
    const room = rooms.get(item.sourceRoomId);
    return !room || isDispatchVisibleInRoom(item, room);
  });
}

export async function cycloneDispatchRoutes(app: FastifyInstance): Promise<void> {
  const { dataDir } = getAppContext(app);

  app.get('/workshop/:workshopId/dispatches', async (req, reply) => {
    const { workshopId } = req.params as DispatchParams;
    if (!await loadWorkshop(dataDir, workshopId)) {
      return reply.status(404).send({ error: '工作室不存在' });
    }
    return reply.send(await listVisibleWorkshopDispatches(dataDir, workshopId));
  });

  app.get('/workshop/:workshopId/room/:roomId/dispatches', async (req, reply) => {
    const { workshopId, roomId } = req.params as DispatchParams;
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) {
      return reply.status(404).send({ error: '群聊不存在' });
    }
    const items = await listRoomDispatches(dataDir, workshopId, roomId);
    return reply.send(items.filter(item => isDispatchVisibleInRoom(item, room)));
  });

  app.post('/workshop/:workshopId/room/:roomId/dispatches/:dispatchId/:action', async (req, reply) => {
    const { workshopId, roomId, dispatchId, action } = req.params as DispatchParams;
    try {
      if (action === 'read') {
        return reply.send(await markDispatchRead(dataDir, workshopId, roomId, dispatchId));
      }
      if (action === 'include') {
        return reply.send(await includeDispatchResult(dataDir, workshopId, roomId, dispatchId));
      }
      if (action === 'dismiss') {
        return reply.send(await dismissDispatch(dataDir, workshopId, roomId, dispatchId));
      }
      return reply.status(400).send({ error: `未知派发操作：${action}` });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });
}
