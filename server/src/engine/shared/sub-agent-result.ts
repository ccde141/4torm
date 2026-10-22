import type { SubAgentResult } from './sub-agent-types.js';

/** Only known framework diagnostics cross the delegation boundary; provider bodies stay private. */
function publicFailure(error: string): string {
  const message = error.trim();
  if (/^done requires a non-empty summary\.?$/i.test(message)) return 'done requires a non-empty summary.';
  if (/^(?:请求|任务|执行|工作流|SubAgent).{0,24}(?:已中止|已取消|超时|轮次上限)[。.!！]?$/u.test(message)) return message;
  const status = message.match(/\b(?:HTTP|status(?:Code)?)\s*[:=]?\s*([45]\d\d)\b/i)?.[1];
  if (status) return `模型请求失败（HTTP ${status}）`;
  return '子任务执行失败；检查模型服务、权限或执行记录后再决定下一步';
}

export function subAgentReport(result: Pick<SubAgentResult, 'status' | 'summary' | 'error'>): string {
  let summary = result.summary.trim();
  if (result.status === 'success' || !result.error) return summary;
  if (summary.includes(result.error.trim()) || /^\[?(?:错误|error)\]?/i.test(summary)) summary = 'SubAgent 执行失败';
  const failure = publicFailure(result.error);
  return summary === failure ? summary : [summary, `原因：${failure}`].filter(Boolean).join('\n');
}
