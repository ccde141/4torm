import type { Locale } from '../i18n/locale';

export interface CurrentInputEstimate {
  runId?: string;
  active?: boolean;
  tokens: number;
  images: number;
  model: string;
  estimatedAt: string;
  basis?: 'compiled' | 'canonical';
  contextRevision?: string | number;
}

/** Current effective input is separate from historical provider usage and billing. */
export function formatCurrentInput(estimate: CurrentInputEstimate | undefined, locale: Locale,
  progress?: ModelUsageProgress): { label: string; title: string } | undefined {
  if (!estimate || !Number.isFinite(estimate.tokens) || estimate.tokens < 0) return undefined;
  const latest = progress?.latest;
  // Persisted in-flight states can survive a crash; a newer context read must supersede them.
  if (!estimate.active && latest && latest.updatedAt > estimate.estimatedAt) return formatModelUsage(progress, locale);
  const english = locale === 'en-US';
  const count = estimate.tokens >= 1_000 ? `${(estimate.tokens / 1_000).toFixed(1)}K` : String(estimate.tokens);
  const note = estimate.basis === 'canonical'
    ? english ? 'Estimated from active messages and available configuration; full request preparation is unavailable.'
      : '按有效消息与可用配置预估，尚未完整还原当前模型请求。'
    : english ? 'Estimated current input, including system instructions and tool definitions.'
      : '当前待发送上下文预估，包含系统提示词与工具定义。';
  const images = estimate.images ? (english ? ' Image cost is approximate.' : ' 图片成本按近似值计入。') : '';
  const usage = progress ? (english ? ` Known cumulative usage ${progress.total.totalTokens} tokens.`
    : ` 累计已知用量 ${progress.total.totalTokens} token。`) : '';
  return { label: count, title: `${note}${images}${usage}` };
}

export interface ModelRequestUsage {
  id: string;
  purpose: 'conversation' | 'compaction';
  state: 'prepared' | 'sent' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  updatedAt: string;
  estimatedInputTokens: number;
  imageCount: number;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  usageComplete: boolean;
  wasSent?: boolean;
}
export interface ModelUsageProgress {
  requests: Record<string, ModelRequestUsage>;
  calls: number;
  reportedCalls: number;
  total: { promptTokens: number; completionTokens: number; totalTokens: number };
  complete: boolean;
  latest?: ModelRequestUsage;
}

export function applyModelRequest(previous: ModelUsageProgress | undefined,
  request: ModelRequestUsage): ModelUsageProgress {
  const prior = previous?.requests[request.id];
  if (prior && prior.updatedAt > request.updatedAt) return previous!;
  const requests = { ...previous?.requests, [request.id]: request };
  return summarizeRequests(requests);
}

function summarizeRequests(requests: Record<string, ModelRequestUsage>): ModelUsageProgress {
  const entries = Object.values(requests);
  const sent = entries.filter(item => item.state !== 'prepared' && item.wasSent !== false);
  const known = sent.filter(item => item.usage);
  const total = known.reduce((sum, item) => ({
    promptTokens: sum.promptTokens + item.usage!.promptTokens,
    completionTokens: sum.completionTokens + item.usage!.completionTokens,
    totalTokens: sum.totalTokens + item.usage!.totalTokens,
  }), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  const latest = entries.filter(item => item.purpose === 'conversation')
    .reduce<ModelRequestUsage | undefined>((last, item) => !last || item.startedAt >= last.startedAt ? item : last, undefined);
  return { requests, calls: sent.length, reportedCalls: known.length, total,
    complete: sent.every(item => item.usageComplete), ...(latest ? { latest } : {}) };
}

export function mergeModelUsage(current: ModelUsageProgress | undefined,
  incoming: ModelUsageProgress | undefined): ModelUsageProgress | undefined {
  if (!incoming || current === incoming) return current;
  if (!current) return incoming;
  const requests = { ...current.requests };
  for (const [id, request] of Object.entries(incoming.requests)) {
    if (!requests[id] || requests[id].updatedAt <= request.updatedAt) requests[id] = request;
  }
  return summarizeRequests(requests);
}

export function formatModelUsage(progress: ModelUsageProgress | undefined, locale: Locale,
  fallback?: { promptTokens: number; completionTokens: number; totalTokens: number }): { label: string; title: string } | undefined {
  if (!progress) return undefined;
  const english = locale === 'en-US';
  const total = english ? `Known cumulative usage ${progress.total.totalTokens} tokens`
    : `累计已知用量 ${progress.total.totalTokens} token`;
  const complete = progress.complete ? '' : english ? ' · incomplete metering' : ' · 计量未完整';
  if (!progress.latest) {
    const count = fallback?.promptTokens;
    if (count === undefined) return undefined;
    return { label: count === undefined ? '--' : count >= 1_000 ? `${(count / 1_000).toFixed(1)}K` : String(count),
      title: `${english ? 'Main-conversation input has no new measurement.' : '主会话输入暂无新实测。'} ${total}${complete}` };
  }
  const latest = progress.latest;
  const estimate = !latest.usage;
  const input = latest.usage?.promptTokens ?? latest.estimatedInputTokens;
  const count = input >= 1_000 ? `${(input / 1_000).toFixed(1)}K` : String(input);
  const note = estimate
    ? english ? 'Estimated input including tool schemas; image cost is approximate.'
      : '预计请求输入，包含工具定义；图片按近似成本估算。'
    : english ? 'Input reported by provider.' : '提供商报告的请求输入。';
  const last = estimate && fallback ? english ? ` Last reported input ${fallback.promptTokens}.`
    : ` 上次实测输入 ${fallback.promptTokens}。` : '';
  return { label: count, title: `${note}${last} ${total}${complete}` };
}
