import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { RoomData, RoomMessage } from './types.js';
import {
  atomicWrite, ensureDir, genId, removeStrict, roomReasoningDir, roomReasoningFile,
} from './paths.js';

export interface ExternalizedRoom {
  persisted: RoomData;
  activeFiles: Set<string>;
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function externalizeMessage(
  dataDir: string,
  workshopId: string,
  roomId: string,
  message: RoomMessage,
): Promise<{ message: RoomMessage; activeFile?: string }> {
  if (!message.reasoning) {
    const activeFile = message.reasoningRef
      ? roomReasoningFile(dataDir, workshopId, roomId, message.reasoningRef)
      : undefined;
    return { message: { ...message }, activeFile };
  }
  const messageId = message.id || genId('msg');
  message.id = messageId;
  const target = roomReasoningFile(dataDir, workshopId, roomId, messageId);
  const reasoningHash = contentHash(message.reasoning);
  if (message.reasoningRef !== messageId || message.reasoningHash !== reasoningHash) {
    await ensureDir(path.dirname(target));
    await atomicWrite(target, message.reasoning);
  }
  const persisted = {
    ...message, reasoning: undefined, reasoningRef: messageId, reasoningHash,
  };
  return { message: persisted, activeFile: target };
}

export async function externalizeRoomReasoning(
  dataDir: string,
  workshopId: string,
  room: RoomData,
): Promise<ExternalizedRoom> {
  const messages: RoomMessage[] = [];
  const activeFiles = new Set<string>();
  for (const message of room.publicMessages) {
    const externalized = await externalizeMessage(dataDir, workshopId, room.id, message);
    messages.push(externalized.message);
    if (externalized.activeFile) activeFiles.add(externalized.activeFile);
  }
  return { persisted: { ...room, publicMessages: messages }, activeFiles };
}

async function readReasoning(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function hydrateRoomReasoning(
  dataDir: string,
  workshopId: string,
  room: RoomData,
): Promise<RoomData> {
  const publicMessages = await Promise.all(room.publicMessages.map(async message => {
    if (message.reasoning || !message.reasoningRef) return message;
    const reasoning = await readReasoning(
      roomReasoningFile(dataDir, workshopId, room.id, message.reasoningRef),
    );
    if (reasoning === undefined) {
      console.warn(`[cyclone] 群聊 ${room.id} 消息 ${message.reasoningRef} 的思考文件缺失`);
      return message;
    }
    if (message.reasoningHash && contentHash(reasoning) !== message.reasoningHash) {
      console.warn(`[cyclone] 群聊 ${room.id} 消息 ${message.reasoningRef} 的思考文件校验失败`);
      return message;
    }
    return { ...message, reasoning };
  }));
  return { ...room, publicMessages };
}

export async function cleanupRoomReasoning(
  dataDir: string,
  workshopId: string,
  roomId: string,
  activeFiles: Set<string>,
): Promise<void> {
  const dir = roomReasoningDir(dataDir, workshopId, roomId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(entries.map(async entry => {
    const file = path.join(dir, entry);
    if (!activeFiles.has(file)) await removeStrict(file);
  }));
}

export async function deleteRoomReasoning(
  dataDir: string, workshopId: string, roomId: string,
): Promise<void> {
  await removeStrict(roomReasoningDir(dataDir, workshopId, roomId), { recursive: true });
}
