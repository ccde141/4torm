import type { TaskBoard } from '../../../utils/taskboard';
import { normalizeDelegateProgressAtToolBoundary } from '../../../engine/chat/delegate-progress';
import { formatStreamStatus, getToolTarget } from '../../../components/chat/stream-status';
import type { Locale } from '../../../i18n/locale';
import type { CycloneUsage } from './cyclone-token-usage';
import { compactionFeedbackEvent } from '../../../components/common/compaction-feedback';
import {
  appendReplyBlock, appendReplyText, findReplyBlock, reconcileReplyAnswer,
  type CycloneReplySegment,
} from './cyclone-reply-sequence';

export interface Live {
  segments: CycloneReplySegment[];
  reasoning?: string;
  phase: string;
  activityTarget?: string;
  taskboard?: TaskBoard | null;
  tokenUsage?: CycloneUsage | null;
  compactionNotice?: string | null;
}

export function emptyLive(locale: Locale = 'zh-CN'): Live {
  return { segments: [], phase: formatStreamStatus('llm-waiting', 0, undefined, undefined, locale), tokenUsage: null };
}

export function applySeatEvent(ev: any, live: Live, locale: Locale = 'zh-CN'): void {
  const feedback = compactionFeedbackEvent(ev);
  if (feedback !== undefined) live.compactionNotice = feedback;
  switch (ev.type) {
    case 'usage': live.tokenUsage = ev.usage ?? null; break;
    case 'token':
      appendReplyText(live.segments, ev.content); live.phase = formatStreamStatus('model-output', 0, undefined, undefined, locale); live.activityTarget = undefined; break;
    case 'reasoning':
      live.reasoning = (live.reasoning || '') + ev.content; live.phase = formatStreamStatus('model-output', 0, undefined, undefined, locale); live.activityTarget = undefined; break;
    case 'tool-progress':
      live.phase = formatStreamStatus('tool-preparing', Math.round((ev.elapsed || 0) / 1000), ev.tool, ev.argumentChars, locale);
      live.activityTarget = undefined; break;
    case 'tool-call':
      appendReplyBlock(live.segments, { kind: 'tool', tool: ev.tool, args: ev.args, status: 'running' });
      live.phase = formatStreamStatus('tool-exec', 0, ev.tool, undefined, locale);
      live.activityTarget = getToolTarget(ev.args); break;
    case 'tool-result': {
      if (ev.meta && 'taskboard' in ev.meta) live.taskboard = ev.meta.taskboard;
      const block = findReplyBlock(live.segments, item => item.kind === 'tool' && item.status === 'running');
      if (block?.kind === 'tool') { block.result = ev.result; block.status = ev.ok ? 'success' : 'error'; }
      live.phase = formatStreamStatus('llm-waiting', 0, undefined, undefined, locale); live.activityTarget = undefined; break;
    }
    case 'heartbeat': {
      const tool = findReplyBlock(live.segments, item => item.kind === 'tool' && item.status === 'running');
      live.phase = formatStreamStatus(ev.phase === 'tool-exec' ? 'tool-exec' : 'llm-waiting',
        Math.round((ev.elapsed || 0) / 1000), tool?.kind === 'tool' ? tool.tool : undefined, undefined, locale);
      live.activityTarget = tool?.kind === 'tool' ? getToolTarget(tool.args) : undefined;
      break;
    }
    case 'delegate-start':
      appendReplyBlock(live.segments, { kind: 'delegate', id: ev.delegateId, task: ev.task, steps: [], status: 'running' });
      live.phase = locale === 'en-US' ? 'Subtask running...' : '子任务执行中...'; break;
    case 'delegate-token': {
      const block = findReplyBlock(live.segments, item => item.kind === 'delegate' && item.id === ev.delegateId);
      if (block?.kind === 'delegate') block.content = (block.content || '') + ev.content; break;
    }
    case 'delegate-tool-call': {
      const block = findReplyBlock(live.segments, item => item.kind === 'delegate' && item.id === ev.delegateId);
      if (block?.kind === 'delegate') {
        block.content = normalizeDelegateProgressAtToolBoundary(block.content || '');
        block.steps.push({ type: 'tool', tool: ev.tool, args: ev.args });
      }
      break;
    }
    case 'delegate-tool-result': {
      const block = findReplyBlock(live.segments, item => item.kind === 'delegate' && item.id === ev.delegateId);
      if (block?.kind === 'delegate') completeDelegateTool(block.steps, ev);
      break;
    }
    case 'delegate-done': {
      const block = findReplyBlock(live.segments, item => item.kind === 'delegate' && item.id === ev.delegateId);
      if (block?.kind === 'delegate') {
        block.content = normalizeDelegateProgressAtToolBoundary(block.content || '');
        block.summary = ev.summary;
        block.status = ev.status === 'error' ? 'error' : 'success';
      }
      live.phase = ''; break;
    }
    case 'contact-start':
      appendReplyBlock(live.segments, { kind: 'contact', id: ev.contactId, target: ev.target, message: ev.message, status: 'running' });
      live.phase = locale === 'en-US' ? `Contacting ${ev.target}...` : `联络 ${ev.target}...`; break;
    case 'contact-done': {
      const block = findReplyBlock(live.segments, item => item.kind === 'contact' && item.id === ev.contactId);
      if (block?.kind === 'contact') { block.reply = ev.reply; block.status = ev.ok ? 'success' : 'error'; }
      live.phase = ''; break;
    }
    case 'answer': reconcileReplyAnswer(live.segments, ev.content); live.phase = ''; break;
    case 'ask': appendReplyBlock(live.segments, { kind: 'ask', question: ev.question, options: ev.options, answered: false }); live.phase = ''; break;
    case 'error': appendReplyText(live.segments, `\n[${locale === 'en-US' ? 'Error' : '错误'}] ${ev.message}`); live.phase = ''; break;
  }
}

function completeDelegateTool(steps: Array<{ tool?: string; result?: unknown; ok?: boolean }>, ev: any): void {
  for (let index = steps.length - 1; index >= 0; index--) {
    if (steps[index].tool === ev.tool && steps[index].result === undefined) {
      steps[index].result = ev.result; steps[index].ok = ev.ok; return;
    }
  }
}
