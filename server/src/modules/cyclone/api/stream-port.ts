import type {
  ModuleTransportHandler, ModuleTransportManifest,
} from '../../../engine/collaboration/contracts.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneSeatChatPort } from '../application/seat-chat.js';
import type { CycloneSeatCompactionPort } from '../application/seat-compaction.js';
import type { CycloneChairChatPort } from '../application/chair-chat.js';
import type { CycloneRoomIntroductionPort, CycloneJoinBehavior } from '../application/room-introduction.js';
import type { CycloneRoomRoundPort } from '../application/collaboration-round.js';

export interface CycloneStreamPorts {
  seatChats: CycloneSeatChatPort;
  seatCompactions: CycloneSeatCompactionPort;
  chairChats: CycloneChairChatPort;
  roomIntroductions: CycloneRoomIntroductionPort;
  roomRounds: CycloneRoomRoundPort;
}

export function cycloneStreamManifests(): ModuleTransportManifest[] {
  return ['seatChat', 'seatCompaction', 'chairChat', 'roomIntroduction', 'roomRound'].map(id => ({
    id, permission: 'execute', audiences: ['human', 'internal'],
    inputSchema: { type: 'object', additionalProperties: false },
  }));
}

export function cycloneStreamHandlers(ports: CycloneStreamPorts): Record<string, ModuleTransportHandler> {
  return {
    seatChat: {
      parse: value => {
        const item = record(value, ['workshopId', 'seatId', 'mode', 'text']);
        if (item.mode !== 'chat' && item.mode !== 'resume') throw invalid();
        return { workshopId: id(item.workshopId), seatId: id(item.seatId),
          mode: item.mode, text: message(item.text) };
      },
      prepare: (_context, input) => ports.seatChats.prepare(input as Parameters<CycloneSeatChatPort['prepare']>[0]),
    },
    seatCompaction: {
      parse: value => {
        const item = record(value, ['workshopId', 'seatId']);
        return { workshopId: id(item.workshopId), seatId: id(item.seatId) };
      },
      prepare: (_context, input) => ports.seatCompactions.prepare(input as Parameters<CycloneSeatCompactionPort['prepare']>[0]),
    },
    chairChat: {
      parse: value => roomMessage(value),
      prepare: (_context, input) => ports.chairChats.prepare(input as Parameters<CycloneChairChatPort['prepare']>[0]),
    },
    roomIntroduction: {
      parse: value => {
        const item = record(value, ['workshopId', 'roomId', 'intros']);
        return { workshopId: id(item.workshopId), roomId: id(item.roomId),
          intros: introductions(item.intros) };
      },
      prepare: (_context, input) => ports.roomIntroductions.prepare(
        input as Parameters<CycloneRoomIntroductionPort['prepare']>[0]),
    },
    roomRound: {
      parse: value => roomMessage(value),
      prepare: (_context, input) => ports.roomRounds.prepare(input as Parameters<CycloneRoomRoundPort['prepare']>[0]),
    },
  };
}

function roomMessage(value: unknown): { workshopId: string; roomId: string; message: string } {
  const item = record(value, ['workshopId', 'roomId', 'message']);
  return { workshopId: id(item.workshopId), roomId: id(item.roomId), message: message(item.message) };
}

function introductions(value: unknown): Array<{ seatId: string; behavior: CycloneJoinBehavior }> {
  if (!Array.isArray(value) || value.length > 12) throw invalid();
  return value.map(entry => {
    const item = record(entry, ['seatId', 'behavior']);
    if (item.behavior !== 'summary' && item.behavior !== 'intro' && item.behavior !== 'none') {
      throw invalid();
    }
    return { seatId: id(item.seatId), behavior: item.behavior };
  });
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) throw invalid();
  return item;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) throw invalid();
  return value;
}

function message(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 20_000) throw invalid();
  return value.trim();
}

function invalid(): never {
  throw frameworkError({ code: 'CYCLONE_STREAM_INPUT_INVALID', kind: 'validation',
    message: '气旋流式调用参数无效', source: 'cyclone.stream', retryable: false });
}
