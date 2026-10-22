import type { Locale } from '../../../i18n/locale';
import { isCancelledToolResult } from './tool-result-status';

export type ContactDeliveryState = 'waiting' | 'running' | 'completed' | 'failed' | 'busy' | 'aborted' | 'crashed';
export interface ContactResultDisplay {
  reply?: string;
  status: 'running' | 'success' | 'error';
  communicationId?: string;
  deliveryState?: ContactDeliveryState;
  delivered?: boolean;
  replyTruncated?: boolean;
}
const states = new Set<ContactDeliveryState>(['waiting', 'running', 'completed', 'failed', 'busy', 'aborted', 'crashed']);

export function projectContactResult(result?: string, ok?: boolean): ContactResultDisplay {
  if (result === undefined) return { status: 'running' };
  try {
    const value = JSON.parse(result);
    if (value && states.has(value.status) && typeof value.delivered === 'boolean') {
      const deliveryState: ContactDeliveryState = value.status === 'completed' && ok === false ? 'failed' : value.status;
      return { status: deliveryState === 'waiting' || deliveryState === 'running' ? 'running'
        : deliveryState === 'completed' ? 'success' : 'error', deliveryState, delivered: value.delivered,
        communicationId: typeof value.contactId === 'string' ? value.contactId : typeof value.id === 'string' ? value.id : undefined,
        replyTruncated: value.replyTruncated === true,
        reply: [value.reply ?? value.response, value.error, value.message].find(item => typeof item === 'string' && item) };
    }
  } catch { /* 旧会话保留文本结果；新结果优先采用明确状态。 */ }
  const failed = ok === false || (ok === undefined && (isCancelledToolResult(result)
    || result.startsWith('联络失败') || result.startsWith('联络被系统拒绝') || result.includes('正忙')));
  return { reply: result, status: failed ? 'error' : 'success' };
}

export function contactStateLabel(result: ContactResultDisplay, locale: Locale): string {
  const labels: Record<ContactDeliveryState, [string, string]> = {
    waiting: ['等待接入', 'Waiting for admission'], running: ['已接收，处理中', 'Received, processing'],
    completed: ['已回复', 'Replied'], busy: ['忙线，未送达', 'Busy, not delivered'],
    failed: [result.delivered ? '已送达，处理失败' : '未送达', result.delivered ? 'Delivered, processing failed' : 'Not delivered'],
    aborted: [result.delivered ? '已送达，已中止' : '已撤回，未送达', result.delivered ? 'Delivered, stopped' : 'Withdrawn, not delivered'],
    crashed: ['已送达，执行中断', 'Delivered, interrupted'],
  };
  return result.deliveryState ? labels[result.deliveryState][locale === 'en-US' ? 1 : 0] : '';
}
