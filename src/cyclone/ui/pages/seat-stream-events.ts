import type { CompactionActivity } from '../../../components/common/compaction-activity';
import { reduceCycloneCompaction } from './cyclone-compaction-activity';
import type { TaskBoard } from '../../../utils/taskboard';
import { normalizeDelegateProgressAtToolBoundary } from '../../../engine/chat/delegate-progress';
import { formatStreamStatus, getToolTarget } from '../../../components/chat/stream-status';
import type { Locale } from '../../../i18n/locale';
import type { ToolImageRef } from '../../../engine/tool-media';
import type { CycloneUsage } from './cyclone-token-usage';
import { compactionFeedbackEvent } from '../../../components/common/compaction-feedback';
import { projectContactResult } from './contact-result';
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
  lastKnownTokenUsage?: CycloneUsage;
  compactionNotice?: string | null;
  compaction?: CompactionActivity | null;
}

export function emptyLive(locale: Locale = 'zh-CN'): Live {
  return { segments: [], phase: formatStreamStatus('llm-waiting', 0, undefined, undefined, locale), tokenUsage: null };
}

export function applySeatEvent(ev: any, live: Live, locale: Locale = 'zh-CN'): void {
  live.compaction = reduceCycloneCompaction(live.compaction, ev);
  const feedback = compactionFeedbackEvent(ev);
  if (feedback !== undefined) live.compactionNotice = feedback;
  switch (ev.type) {
    case 'usage':
      live.tokenUsage = ev.usage ?? null;
      if (ev.usage) live.lastKnownTokenUsage = ev.usage;
      break;
    case 'token':
      appendReplyText(live.segments, ev.content); live.phase = formatStreamStatus('model-output', 0, undefined, undefined, locale); live.activityTarget = undefined; break;
    case 'reasoning':
      live.reasoning = (live.reasoning || '') + ev.content; live.phase = formatStreamStatus('model-output', 0, undefined, undefined, locale); live.activityTarget = undefined; break;
    case 'tool-progress':
      live.phase = formatStreamStatus('tool-preparing', Math.round((ev.elapsed || 0) / 1000), ev.tool, ev.argumentChars, locale);
      live.activityTarget = undefined; break;
    case 'tool-call':
      appendReplyBlock(live.segments, ev.tool === 'contact' ? { kind: 'contact',
        id: `tool-contact:${live.segments.reduce((count, segment) => count + segment.blocks.length, 0)}`,
        target: String(ev.args?.target ?? ''), message: String(ev.args?.message ?? ''), status: 'running' }
        : { kind: 'tool', tool: ev.tool, args: ev.args, status: 'running' });
      live.phase = formatStreamStatus('tool-exec', 0, ev.tool, undefined, locale);
      live.activityTarget = getToolTarget(ev.args); break;
    case 'tool-result': {
      if (ev.meta && 'taskboard' in ev.meta) live.taskboard = ev.meta.taskboard;
      if (ev.tool === 'contact') {
        const contact = findReplyBlock(live.segments, item => item.kind === 'contact'
          && item.id.startsWith('tool-contact:') && !item.communicationId);
        if (contact?.kind === 'contact') Object.assign(contact, projectContactResult(ev.result, ev.ok));
        live.phase = ''; live.activityTarget = undefined; break;
      }
      const block = findReplyBlock(live.segments, item => item.kind === 'tool' && item.status === 'running');
      if (block?.kind === 'tool') {
        block.result = ev.result;
        if (ev.toolImages?.length) block.toolImages = ev.toolImages;
        block.status = ev.ok ? 'success' : 'error';
      }
      if (ev.tool === 'contact_read') {
        const result = projectContactResult(ev.result);
        const contact = findReplyBlock(live.segments, item => item.kind === 'contact'
          && !!result.communicationId && item.communicationId === result.communicationId);
        if (contact?.kind === 'contact') Object.assign(contact, result);
      }
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
      if (block?.kind === 'contact') Object.assign(block, projectContactResult(ev.reply, ev.ok));
      live.phase = ''; break;
    }
    case 'answer': reconcileReplyAnswer(live.segments, ev.content); live.phase = ''; break;
    case 'ask': appendReplyBlock(live.segments, { kind: 'ask', question: ev.question, options: ev.options, answered: false }); live.phase = ''; break;
    case 'error': appendReplyText(live.segments, `\n[${locale === 'en-US' ? 'Error' : '错误'}] ${ev.message}`); live.phase = ''; break;
  }
}

function completeDelegateTool(steps: Array<{ tool?: string; result?: unknown; ok?: boolean; toolImages?: ToolImageRef[] }>, ev: any): void {
  for (let index = steps.length - 1; index >= 0; index--) {
    if (steps[index].tool === ev.tool && steps[index].result === undefined) {
      steps[index].result = ev.result; steps[index].ok = ev.ok; steps[index].toolImages = ev.toolImages; return;
    }
  }
}
