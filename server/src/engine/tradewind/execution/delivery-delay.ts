/**
 * 可中断延时 —— 节点内投递延迟（前提①）
 *
 * 用途：agent 节点产出已生成、投递下游前盲等 N 秒，抗外部环境节拍
 * （如等外部系统处理）。走 AbortSignal 可被工作流停止立即打断。
 *
 * 纯函数、无副作用，便于单测。
 */

/**
 * 睡眠 seconds 秒，可被 signal 中断。
 *
 * @returns 'completed' 正常睡满 | 'aborted' 被 signal 打断
 * - seconds <= 0 或非有限数 → 立即 'completed'（等价无延迟）
 * - 进入时 signal 已 abort → 立即 'aborted'
 */
export function abortableSleep(
  seconds: number,
  signal: AbortSignal,
): Promise<'completed' | 'aborted'> {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return Promise.resolve('completed');
  }
  if (signal.aborted) {
    return Promise.resolve('aborted');
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve('completed');
    }, seconds * 1000);
    const onAbort = () => {
      clearTimeout(timer);
      resolve('aborted');
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 从节点 config 读取投递延迟秒数。
 * 缺省 / 非法（负数、非数字）一律归 0（无延迟），不抛错。
 */
export function readDeliveryDelaySec(config: Readonly<Record<string, unknown>>): number {
  const raw = (config as { deliveryDelaySec?: unknown }).deliveryDelaySec;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}
