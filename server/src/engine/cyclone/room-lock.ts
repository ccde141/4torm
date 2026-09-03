const roomLocks = new Set<string>();

/** 非阻塞获取单个群聊锁；调用方必须执行返回的 release。 */
export function tryAcquireRoomLock(workshopId: string, roomId: string): (() => void) | null {
  const key = `${workshopId}/${roomId}`;
  if (roomLocks.has(key)) return null;
  roomLocks.add(key);
  return () => { roomLocks.delete(key); };
}
