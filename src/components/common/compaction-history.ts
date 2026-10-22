// These prefixes are written by the islands' existing compaction stores, including legacy resets.
const historyPrefix = /^(?:\[(?:历史压缩记录|会议历史摘要|对话历史摘要|会话归档摘要|群聊历史摘要)\]\s*|以下是重置前的(?:工位私聊|会长私聊|群聊)摘要，请作为后续(?:群聊|会长)?上下文参考：\s*|以下是较早工位私聊的滚动压缩摘要，请与后续保留的原始回合共同作为上下文：\s*)/;

/** Callers must also check the system role or an explicit compact marker. */
export function isCompactionHistory(content: string): boolean {
  return historyPrefix.test(content);
}

export function compactionHistoryContent(content: string): string {
  return content.replace(historyPrefix, '');
}
