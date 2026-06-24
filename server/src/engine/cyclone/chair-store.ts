/**
 * 气旋会长椅册 store —— 会长私聊会话持久化
 *
 * 椅册结构跟 SeatData 的 messages/pending/tokenUsage 同形，不引入新类型。
 * 首次 chatChair 时自动创建 chair.json，旧工作室无椅册不报错。
 */

import type { ContextMessage } from '../shared/types';
import type { CycloneTokenUsage } from './types';
import { chairFile, readJsonSafe, atomicWrite } from './paths';

export interface ChairSession {
  messages: ContextMessage[];
  pending?: {
    question: string;
    options?: string[];
    pendingToolCallId?: string;
    native: boolean;
  };
  tokenUsage?: CycloneTokenUsage;
}

export async function loadChair(dataDir: string, workshopId: string): Promise<ChairSession | null> {
  return readJsonSafe<ChairSession>(chairFile(dataDir, workshopId));
}

export async function saveChair(dataDir: string, workshopId: string, chair: ChairSession): Promise<void> {
  await atomicWrite(chairFile(dataDir, workshopId), JSON.stringify(chair, null, 2));
}

/** 会长独立锁（按 workshopId 互斥，不与工位锁冲突） */
const chairLocks = new Set<string>();

export function tryAcquireChairLock(workshopId: string): (() => void) | null {
  const key = `${workshopId}/__chair__`;
  if (chairLocks.has(key)) return null;
  chairLocks.add(key);
  return () => { chairLocks.delete(key); };
}
