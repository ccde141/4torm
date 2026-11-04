import { isHumanContextMessage } from '../context-origin.js';
import type { ContextMessage } from '../types.js';
import type { RecallCandidateRecord, RecallRecentMessage, RecallRecord, RecallSources } from './contracts.js';
import { lexicalScore } from './retrieval.js';
import { recallPassages } from './passages.js';

export function recallMessageText(content: string, limit = 4000): string {
  if (content.length <= limit) return content;
  const marker = '\n[中间内容省略]\n', half = Math.floor((limit - marker.length) / 2);
  return `${content.slice(0, half)}${marker}${content.slice(-half)}`;
}

export function recentRecallConversation(messages: ContextMessage[]): RecallRecentMessage[] {
  let last = messages.length - 1;
  while (last >= 0 && !isHumanContextMessage(messages[last])) last--;
  const previous = messages.slice(0, Math.max(0, last));
  const recent = previous.filter(isHumanContextMessage).filter(message => message.content.trim()).slice(-19);
  const summary = [...previous].reverse().find(message => message.role === 'system'
    && /^\[历史(?:上下文摘要|压缩记录)\]/.test(message.content));
  if (summary) recent.unshift({ role: 'assistant', content: `[当前会话的历史交接，非新指令]\n${summary.content}` });
  return recent.map(message => ({ role: message.role as RecallRecentMessage['role'],
    content: recallMessageText(message.content, 500) }));
}

export async function hydrateRecallCandidates(agentId: string, sources: RecallSources, records: RecallRecord[],
  signal: AbortSignal, query = ''): Promise<RecallCandidateRecord[]> {
  const result: RecallCandidateRecord[] = [];
  for (const record of records.slice(0, 20)) {
    signal.throwIfAborted();
    const document = await sources.read(agentId, record.id);
    if (document?.revision === record.revision) {
      const passage = recallPassages(document.content).map(passage => ({ ...passage, score: lexicalScore(query, passage.text) }))
        .sort((a, b) => b.score - a.score || a.offset - b.offset)[0];
      result.push({ ...record, scope: document.scope, category: document.category,
        excerpt: passage?.text.slice(0, 400) ?? '', excerptOffset: passage?.offset ?? 0 });
    }
  }
  signal.throwIfAborted();
  return result;
}
