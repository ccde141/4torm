import { formatStreamStatus } from '../../../components/chat/stream-status';
import type { Locale } from '../../../i18n/locale';
import type { CycloneUsage } from './cyclone-token-usage';
import { compactionFeedbackEvent } from '../../../components/common/compaction-feedback';
import {
  appendRoomDispatch, appendRoomText, appendRoomTool, completeRoomTool,
  reconcileRoomAnswer, type FeedTool, type RoomReplySegment,
} from './room-reply-segments';

export interface FeedMsg {
  key: string;
  sourceIndex?: number;
  turnId?: string;
  speaker: string;
  content: string;
  isHuman: boolean;
  isArchiveSummary?: boolean;
  streaming?: boolean;
  phase?: string;
  reasoning?: string;
  kind?: 'dispatch-result' | 'membership';
  dispatchId?: string;
  seatId?: string;
  membershipAction?: 'joined' | 'left';
  tools: FeedTool[];
  segments?: RoomReplySegment[];
}

export interface RoomEventState {
  roundFeed: FeedMsg[];
  activeSpeaker: string;
  tokenUsage?: CycloneUsage | null;
  compactionNotice?: string | null;
}

export function applyRoomEvent(ev: any, state: RoomEventState, locale: Locale = 'zh-CN'): void {
  const feedback = compactionFeedbackEvent(ev);
  if (feedback !== undefined) state.compactionNotice = feedback;
  const feed = state.roundFeed;
  switch (ev.type) {
    case 'usage': state.tokenUsage = ev.usage ?? null; break;
    case 'seat-start':
      state.activeSpeaker = ev.speaker;
      feed.push({ key: ev.turnId || `intro-${ev.speaker}-${feed.length}`, turnId: ev.turnId,
        speaker: ev.speaker, content: '', isHuman: false, streaming: true,
        phase: formatStreamStatus('llm-waiting', 0, undefined, undefined, locale), tools: [], segments: [] });
      break;
    case 'seat-waiting': updateSpeaker(feed, ev.speaker, message => {
      message.phase = locale === 'en-US' ? "Waiting for this Agent's current task" : '等待同一 Agent 的当前任务结束';
    }); break;
    case 'token': updateSpeaker(feed, state.activeSpeaker, message => {
      message.content += ev.content; appendRoomText(message.segments!, ev.content);
      message.phase = formatStreamStatus('model-output', 0, undefined, undefined, locale);
    }); break;
    case 'reasoning': updateSpeaker(feed, state.activeSpeaker, message => {
      message.reasoning = (message.reasoning || '') + ev.content;
      message.phase = formatStreamStatus('model-output', 0, undefined, undefined, locale);
    }); break;
    case 'tool-progress': updateSpeaker(feed, ev.speaker, message => {
      message.phase = formatStreamStatus('tool-preparing', Math.round((ev.elapsed || 0) / 1000), ev.tool, ev.argumentChars, locale);
    }); break;
    case 'tool-call': updateSpeaker(feed, state.activeSpeaker, message => {
      message.tools.push({ tool: ev.tool, args: ev.args, status: 'running' });
      appendRoomTool(message.segments!, ev.tool, ev.args);
      message.phase = formatStreamStatus('tool-exec', 0, ev.tool, undefined, locale);
    }); break;
    case 'heartbeat': updateSpeaker(feed, ev.speaker, message => {
      const tool = message.tools.findLast(item => item.status === 'running')?.tool;
      message.phase = formatStreamStatus(ev.phase === 'tool-exec' ? 'tool-exec' : 'llm-waiting',
        Math.round((ev.elapsed || 0) / 1000), tool, undefined, locale);
    }); break;
    case 'tool-result': updateSpeaker(feed, state.activeSpeaker, message => {
      completeTool(message, ev); completeRoomTool(message.segments!, ev.result, ev.ok);
      message.phase = formatStreamStatus('llm-waiting', 0, undefined, undefined, locale);
    }); break;
    case 'dispatch-created': updateSpeaker(feed, state.activeSpeaker,
      message => appendRoomDispatch(message.segments!, ev.dispatch.id)); break;
    case 'seat-done':
      updateSpeaker(feed, ev.speaker, message => {
        message.content = ev.content || message.content; reconcileRoomAnswer(message.segments!, message.content);
        message.streaming = false; message.phase = '';
      });
      state.activeSpeaker = ''; break;
    case 'error': feed.push({ key: `error-${feed.length}`, speaker: '系统', content: ev.message, isHuman: false, tools: [] }); break;
  }
}

function updateSpeaker(feed: FeedMsg[], speaker: string, update: (message: FeedMsg) => void): void {
  const message = feed[feed.length - 1];
  if (message?.speaker === speaker) update(message);
}

function completeTool(message: FeedMsg, ev: any): void {
  for (let index = message.tools.length - 1; index >= 0; index--) {
    if (message.tools[index].status === 'running') {
      message.tools[index] = { ...message.tools[index], result: ev.result, status: ev.ok ? 'success' : 'error' };
      return;
    }
  }
}
