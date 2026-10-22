import type { LLMCaller } from '../shared/react/native-loop.js';
import type { SeatData } from './types.js';

type SeatScene = 'solo' | 'contact' | 'room';

const fieldTitles: Record<string, string> = {
  title: '工位名称', rolePrompt: '岗位提示词', duty: '职责',
  overrideAgentRole: '角色继承方式', agentId: '绑定 Agent', collaboration: '协作能力',
};

/** Only request-local metadata is injected; private history never enters a room. */
export function withSeatContinuity(llm: LLMCaller, seat: SeatData, scene: SeatScene): LLMCaller {
  return { call: async (messages, options, onChunk, signal, ...rest) => {
    const change = seat.history?.at(-1);
    const configurationKey = scene === 'room' ? 'roomConfigurationId' : 'configurationId';
    const configurationId = change?.id !== seat.historySeen?.[configurationKey] ? change?.id : undefined;
    const compactedAt = scene !== 'room' && seat.compactState?.lastCompactAt !== seat.historySeen?.compactedAt
      ? seat.compactState?.lastCompactAt : undefined;
    const cues: string[] = [];
    if (configurationId && change) {
      const fields = change.changedFields?.map(field => fieldTitles[field]).filter(Boolean).join('、');
      cues.push(`岗位配置于 ${change.timestamp} 更新${fields ? `：${fields}` : ''}。请以当前岗位配置为准，需要核对时查询岗位变更履历。`);
    }
    if (compactedAt) {
      cues.push(`本工位私聊上下文于 ${compactedAt} 完成整理。接续较早事项时，可按需查询本工位履历和记忆，不凭摘要推定任务已经完成。`);
    }
    if (!cues.length || messages[0]?.role !== 'system') {
      return llm.call(messages, options, onChunk, signal, ...rest);
    }
    const request = [{ ...messages[0], content: `${messages[0].content}\n\n## 接续工作\n${cues.join('\n')}` }, ...messages.slice(1)];
    const result = await llm.call(request, options, onChunk, signal, ...rest);
    // The owner persists this watermark with its normal successful request save.
    // Aborted or rejected requests leave the cue available for the next request.
    if (!signal?.aborted) seat.historySeen = { ...seat.historySeen,
      ...(configurationId ? { [configurationKey]: configurationId } : {}), ...(compactedAt ? { compactedAt } : {}) };
    return result;
  } };
}
