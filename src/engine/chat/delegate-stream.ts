/**
 * delegate-stream.ts — 前端 SubAgent SSE 客户端
 *
 * 连接后端 /api/chat/delegate 端点，解析 SSE 事件流，
 * 返回 SubAgentResult（summary 作为 tool_result 回流主 Agent）。
 */

import { streamUrl } from '../../lib/apiBase';

export interface DelegateParams {
  task: string;
  context: string;
  systemPrompt: string;
  agentId: string;
  maxRounds?: number;
  timeout?: number;
}

export interface DelegateResult {
  status: 'success' | 'timeout' | 'error' | 'aborted';
  summary: string;
  rounds: number;
  error?: string;
}

export type DelegateEventHandler = {
  onToken?: (token: string) => void;
  onToolCall?: (tool: string, args: Record<string, string>) => void;
  onToolResult?: (tool: string, result: string, ok: boolean) => void;
  onDone?: (result: DelegateResult) => void;
  onError?: (result: DelegateResult) => void;
};

/**
 * 发起 delegate 请求，返回 SSE 流式结果。
 * 返回 Promise<DelegateResult>，同时通过 handlers 实时回调事件。
 */
export async function delegateStream(
  params: DelegateParams,
  handlers: DelegateEventHandler = {},
  signal?: AbortSignal,
): Promise<DelegateResult> {
  const res = await fetch(streamUrl('/api/delegate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const result: DelegateResult = {
      status: 'error', summary: `SubAgent 委托失败（${err.error || '请求失败'}），请自行完成该子任务。`, rounds: 0,
    };
    handlers.onError?.(result);
    return result;
  }

  // 解析 SSE 流
  const reader = res.body?.getReader();
  if (!reader) {
    const result: DelegateResult = { status: 'error', summary: 'SubAgent 委托失败（无响应体），请自行完成该子任务。', rounds: 0 };
    handlers.onError?.(result);
    return result;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: DelegateResult = { status: 'error', summary: '流异常结束', rounds: 0 };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // 心跳或空行
      if (!trimmed.startsWith('data:')) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload) continue;

      try {
        const evt = JSON.parse(payload);
        const eventType = evt.event as string | undefined;

        if (eventType === 'token' && evt.t) {
          handlers.onToken?.(evt.t);
        } else if (eventType === 'tool_call') {
          handlers.onToolCall?.(evt.tool, evt.args);
        } else if (eventType === 'tool_result') {
          handlers.onToolResult?.(evt.tool, evt.result, evt.ok);
        } else if (eventType === 'done') {
          finalResult = { status: evt.status, summary: evt.summary, rounds: evt.rounds };
          handlers.onDone?.(finalResult);
        } else if (eventType === 'error') {
          finalResult = { status: evt.status, summary: evt.summary, rounds: evt.rounds, error: evt.error };
          handlers.onError?.(finalResult);
        }
      } catch {
        // 非 JSON 行忽略
      }
    }
  }

  return finalResult;
}
