import { frameworkError } from './framework-error.js';

/** EOF is not a model's confirmation that its answer or tool parameters are complete. */
export function assertProviderStreamComplete(complete: boolean): void {
  if (!complete) throw frameworkError({ code: 'MODEL_STREAM_INCOMPLETE', kind: 'protocol',
    message: '模型响应流在完整结束前中断，未执行未确认的工具调用', source: 'llm-bridge', retryable: false });
}
