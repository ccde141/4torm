import type { FeatureModule } from '../../../engine/collaboration/contracts.js';
import { missingToolImage, parseToolImageLookup, withToolImageTransport } from '../../../engine/collaboration/tool-image-transport.js';
import type { CycloneWorkshopService } from '../application/workshop-service.js';
import type { CycloneSeatService } from '../application/seat-service.js';
import type { CycloneRoomService } from '../application/room-service.js';
import type { CycloneChairService } from '../application/chair-service.js';
import type { CycloneSupervisorService } from '../application/supervisor-service.js';

interface Owners { workshops: CycloneWorkshopService; seats: CycloneSeatService;
  rooms: CycloneRoomService; chair: CycloneChairService; supervisor: CycloneSupervisorService }
export function withCycloneToolImages(module: FeatureModule, dataDir: string,
  owners: Owners): FeatureModule {
  return withToolImageTransport(module, dataDir, {
    parse: value => {
      const input = parseToolImageLookup(value, ['workshopId', 'kind', 'targetId']);
      if (!['seat', 'room', 'chair', 'supervisor'].includes(input.target.kind!)) return missingToolImage();
      if (input.target.kind === 'supervisor' && input.target.targetId !== 'supervisor') return missingToolImage();
      return input;
    },
    sources: async ({ workshopId, kind, targetId }) => {
      await owners.workshops.require(workshopId!);
      if (kind === 'seat') return owners.seats.require(workshopId!, targetId!);
      if (kind === 'chair') return owners.chair.status(workshopId!, targetId!);
      if (kind === 'room') return owners.rooms.require(workshopId!, targetId!);
      return owners.supervisor.status(workshopId!);
    },
  });
}
