import {
  dismissDispatch,
  includeDispatchResult,
  markDispatchRead,
  markSeatDispatchesRead,
} from '../../../engine/cyclone/dispatch-actions.js';
import {
  listRoomDispatches,
  listWorkshopDispatches,
  type CycloneDispatch,
} from '../../../engine/cyclone/dispatch-store.js';
import { isDispatchVisibleInRoom } from '../../../engine/cyclone/dispatch-visibility.js';
import { loadRoom } from '../../../engine/cyclone/room-store.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneRoomService } from './room-service.js';
import type { CycloneWorkshopService } from './workshop-service.js';
import type { CycloneChangeFeed } from './change-feed.js';

export type CycloneDispatchAction = 'read' | 'include' | 'dismiss';

export class CycloneDispatchService {
  constructor(
    private readonly dataDir: string,
    private readonly workshops: CycloneWorkshopService,
    private readonly rooms: CycloneRoomService,
    private readonly changes?: CycloneChangeFeed,
  ) {}

  async listWorkshop(workshopId: string): Promise<CycloneDispatch[]> {
    await this.workshops.require(workshopId);
    const items = await listWorkshopDispatches(this.dataDir, workshopId);
    const roomIds = [...new Set(items
      .filter(item => item.sourceKind !== 'seat').map(item => item.sourceRoomId))];
    const rooms = new Map(await Promise.all(roomIds.map(async roomId => (
      [roomId, await loadRoom(this.dataDir, workshopId, roomId)] as const
    ))));
    return items.filter(item => item.sourceKind === 'seat'
      || !rooms.get(item.sourceRoomId)
      || isDispatchVisibleInRoom(item, rooms.get(item.sourceRoomId)!));
  }

  async listRoom(workshopId: string, roomId: string): Promise<CycloneDispatch[]> {
    const room = await this.rooms.require(workshopId, roomId);
    return (await listRoomDispatches(this.dataDir, workshopId, roomId))
      .filter(item => isDispatchVisibleInRoom(item, room));
  }

  async markSeatRead(workshopId: string, seatId: string): Promise<CycloneDispatch[]> {
    await this.workshops.require(workshopId);
    return markSeatDispatchesRead(this.dataDir, workshopId, seatId);
  }

  async act(
    workshopId: string,
    roomId: string,
    dispatchId: string,
    action: CycloneDispatchAction,
  ): Promise<CycloneDispatch> {
    try {
      if (action === 'read') return await markDispatchRead(
        this.dataDir, workshopId, roomId, dispatchId,
      );
      if (action === 'include') {
        const result = await includeDispatchResult(this.dataDir, workshopId, roomId, dispatchId);
        this.changes?.publish(workshopId, 'activity', roomId);
        return result;
      }
      return await dismissDispatch(this.dataDir, workshopId, roomId, dispatchId);
    } catch (error) {
      throw dispatchError(error);
    }
  }
}

function dispatchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const kind = message.includes('不存在') ? 'not_found' : 'conflict';
  return frameworkError({
    code: kind === 'not_found' ? 'CYCLONE_DISPATCH_NOT_FOUND' : 'CYCLONE_DISPATCH_CONFLICT',
    kind, message, source: 'cyclone.dispatches', retryable: false,
  }, { cause: error });
}
