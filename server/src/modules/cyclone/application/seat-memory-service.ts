import { readSeatMemory, saveSeatMemory, type SeatMemoryInput } from '../../../engine/cyclone/seat-memory.js';

/** 人类命令与工位工具共用同一份带版本的岗位记忆。 */
export class CycloneSeatMemoryService {
  constructor(private readonly dataDir: string) {}
  read(workshopId: string, seatId: string) {
    return readSeatMemory(this.dataDir, workshopId, seatId);
  }
  save(workshopId: string, seatId: string, expectedRevision: number, entry: SeatMemoryInput) {
    return saveSeatMemory(this.dataDir, workshopId, seatId, expectedRevision, entry, 'human');
  }
}
