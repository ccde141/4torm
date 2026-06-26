/**
 * 气旋会长执行器 —— 每场会议（room）的场外私聊参谋
 *
 * 会长是纯文本参谋角色（对齐对流会议室的会长）：
 * - 零工具：不调用任何工具、不 ask、不 delegate，只输出文本建议
 * - 只读快照：System prompt 只携带本 room 的会议快照 + 在场工位名册（buildChairPrompt）
 * - 直连 LLM：不走 react-loop，单次 callLLM 流式产出
 * - 会话落 room.chairMessages（与 publicMessages 同文件、不同字段，对齐对流；按 room 隔离不串台）
 * - 与群聊发言共用 per-room 锁：同一 room 内会长与 speak 串行，避免并发覆盖 room 文件
 */

import type { ContextMessage } from '../shared/types';
import { callLLM } from '../shared/llm-bridge';
import { loadAgent } from '../shared/agent-loader';
import { buildChairPrompt } from './seat-prompt';
import type { SeatEvent } from './seat-runner';
import { loadWorkshop } from './workshop-store';
import { loadRoom, saveRoom, tryAcquireRoomLock } from './room-store';

/**
 * 人类给某场会议的会长发消息 → 会长纯文本响应（流式）。
 * 无工具、无挂起，单次 LLM 调用即出结论。落 room.chairMessages。
 */
export async function chatChair(
  dataDir: string,
  workshopId: string,
  roomId: string,
  humanMessage: string,
  onEvent: (ev: SeatEvent) => void,
  signal?: AbortSignal,
): Promise<{ content: string; rawContent: string }> {
  // 与群聊发言共用 per-room 锁：会长写 chairMessages、speak 写 publicMessages，同文件须串行
  const release = tryAcquireRoomLock(workshopId, roomId);
  if (!release) throw new Error('该群聊正在处理中，请稍后再试');
  try {
    const w = await loadWorkshop(dataDir, workshopId);
    if (!w) throw new Error('工作室不存在');
    if (!w.chairAgentId) throw new Error('该工作室未指定会长');
    const room = await loadRoom(dataDir, workshopId, roomId);
    if (!room) throw new Error('群聊不存在');
    const agent = await loadAgent(dataDir, w.chairAgentId);
    if (!agent) throw new Error(`会长绑定的 agent 不存在或已删除：${w.chairAgentId}`);

    if (!room.chairMessages) room.chairMessages = [];
    const { systemMessage } = await buildChairPrompt(dataDir, workshopId, room, w, agent);

    room.chairMessages.push({ role: 'user', content: humanMessage });
    const messages: ContextMessage[] = [systemMessage, ...room.chairMessages];

    // 纯文本流式：累积 buffer，abort 时仍可保住已产出的内容
    let buf = '';
    const onChunk = (chunk: string) => { buf += chunk; onEvent({ type: 'token', content: chunk }); };

    let content = '';
    try {
      const r = await callLLM({
        dataDir, fullModelKey: agent.model, messages,
        options: { temperature: agent.temperature }, onChunk, signal,
      });
      content = r.content;
      if (r.usage) {
        room.chairTokenUsage = {
          promptTokens: r.usage.promptTokens,
          completionTokens: r.usage.completionTokens,
          totalTokens: r.usage.totalTokens,
        };
        onEvent({ type: 'usage', usage: r.usage });
      }
    } catch (e) {
      // abort：保住已流式产出的片段；其他错误向上抛由路由 emit error
      if (signal?.aborted) content = buf;
      else throw e;
    }

    if (content) room.chairMessages.push({ role: 'assistant', content });
    await saveRoom(dataDir, workshopId, room);

    onEvent({ type: 'answer', content, rawContent: content });
    onEvent({ type: 'done' });
    return { content, rawContent: content };
  } finally {
    release();
  }
}
