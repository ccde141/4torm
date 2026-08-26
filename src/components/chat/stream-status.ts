export type StreamPhase = 'queued' | 'llm-waiting' | 'model-output' | 'tool-preparing' | 'tool-exec';

function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  return `${Math.floor(safe / 60)}m ${safe % 60}s`;
}

export function formatStreamStatus(
  phase: StreamPhase,
  elapsed = 0,
  tool?: string,
  argumentChars?: number,
  locale: Locale = 'zh-CN',
): string {
  const suffix = elapsed > 0 ? ` ${formatElapsed(elapsed)}` : '';
  if (locale === 'en-US') {
    if (phase === 'queued') return `Waiting for Agent availability${suffix}...`;
    if (phase === 'model-output') return `Model is responding${suffix}...`;
    if (phase === 'tool-preparing') {
      const size = argumentChars && argumentChars > 0
        ? ` · ${argumentChars >= 1024 ? `${(argumentChars / 1024).toFixed(1)}K` : argumentChars} chars`
        : '';
      return `Preparing${tool ? ` ${tool} ` : ' tool '}arguments${suffix}${size}...`;
    }
    if (phase === 'tool-exec') return `Running${tool ? ` ${tool}` : ' tool'}${suffix}...`;
    return `Waiting for model response${suffix}...`;
  }
  if (phase === 'queued') return `等待 Agent 空闲${suffix}...`;
  if (phase === 'model-output') return `模型正在生成${suffix}...`;
  if (phase === 'tool-preparing') {
    const size = argumentChars && argumentChars > 0
      ? ` · ${argumentChars >= 1024 ? `${(argumentChars / 1024).toFixed(1)}K` : argumentChars} 字符`
      : '';
    return `正在准备${tool ? ` ${tool} ` : '工具'}参数${suffix}${size}...`;
  }
  if (phase === 'tool-exec') return `正在执行${tool ? ` ${tool}` : '工具'}${suffix}...`;
  return `等待模型响应${suffix}...`;
}

export function getToolTarget(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const value = args.filePath ?? args.file_path ?? args.path ?? args.command ?? args.target;
  if (typeof value !== 'string') return undefined;
  const target = value.trim();
  return target || undefined;
}
import type { Locale } from '../../i18n/locale';
